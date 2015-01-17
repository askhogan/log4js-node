"use strict";
var layouts = require('../layouts')
    , async = require('async')
    , path = require('path')
    , fs = require('fs')
    , streams = require('../streams')
    , os = require('os')
    , eol = os.EOL || '\n'
    , openFiles = []
    , mkdirp = require('mkdirp');


//close open files on process exit.
process.on('exit', function() {
  openFiles.forEach(function (file) {
    file.end();
  });
});

/**
 * File Appender writing the logs to a text file. Supports rolling of logs by size.
 *
 * @param file file log messages will be written to
 * @param layout a function that takes a logevent and returns a string
 *   (defaults to basicLayout).
 * @param logSize - the maximum size (in bytes) for a log file,
 *   if not provided then logs won't be rotated.
 * @param numBackups - the number of log files to keep after logSize
 *   has been reached (default 5)
 */
function fileAppender (file, layout, logSize, numBackups) {
  var bytesWritten = 0;
  file = path.normalize(file);
  layout = layout || layouts.basicLayout;
  numBackups = numBackups === undefined ? 5 : numBackups;
  //there has to be at least one backup if logSize has been specified
  numBackups = numBackups === 0 ? 1 : numBackups;

  function openTheStream(file, fileSize, numFiles) {
    var stream;
    if (fileSize) {
      stream = new streams.RollingFileStream(
          file,
          fileSize,
          numFiles
      );
    } else {
      stream = fs.createWriteStream(
          file,
          { encoding: "utf8",
            mode: parseInt('0644', 8),
            flags: 'a' }
      );
    }
    stream.on("error", function (err) {
      //when a parent directory does not exist create the directory
      if(err && err.code === 'ENOENT') {
          createDirectory(openTheStream, file, fileSize, numFiles);
      }
      console.error("log4js.fileAppender - Writing to file %s, error happened ", file, err);
    });
    return stream;
  }

  var logFile = openTheStream(file, logSize, numBackups);

  // push file to the stack of open handlers
  openFiles.push(logFile);

  return function(loggingEvent) {
    logFile.write(layout(loggingEvent) + eol, "utf8");
  };
}

function configure(config, options) {
  var layout;
  if (config.layout) {
    layout = layouts.layout(config.layout.type, config.layout);
  }

  if (options && options.cwd && !config.absolute) {
    config.filename = path.join(options.cwd, config.filename);
  }

  return fileAppender(config.filename, layout, config.maxLogSize, config.backups);
}

function shutdown(cb) {
  async.each(openFiles, function(file, done) {
    if (!file.write(eol, "utf-8")) {
      file.once('drain', function() {
        file.end(done);
      });
    } else {
      file.end(done);
    }
  }, cb);
}

function createDirectory(openTheStream, file, fileSize, numFiles){
  var split = file.split('/');
  //remove log file portion to get to the parent directory
  var dir = split.splice(split, split.length -1);
  dir = dir.join('/');

  mkdirp(dir, function (err) {
    if(err) {
      console.error('log4js.fileAppender - Creating directory %s, error happened ', file, err);
      return; //do not retry to open stream on failed create directory
    }
    //restart stream
    openTheStream(file, fileSize, numFiles);
  });
}

exports.appender = fileAppender;
exports.configure = configure;
exports.shutdown = shutdown;
