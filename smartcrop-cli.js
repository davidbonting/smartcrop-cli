#!/usr/bin/env node
/** smartcrop-cli.js
 *
 * Command line interface for smartcrop.js
 *
 * Copyright (C) 2014 Jonas Wagner
 *
 * Permission is hereby granted, free of charge, to any person obtaining
 * a copy of this software and associated documentation files (the
 * "Software"), to deal in the Software without restriction, including
 * without limitation the rights to use, copy, modify, merge, publish,
 * distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so, subject to
 * the following conditions:
 *
 * The above copyright notice and this permission notice shall be
 * included in all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 * EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
 * LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
 * OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
 * WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */
var argv = require('yargs')
    .usage('Usage: $0 [OPTION] FILE [OUTPUT]')
    .example(
      '$0 --width 100 --height 100 photo.jpg square-thumbnail.jpg',
      'generate a 100x100 thumbnail from photo.jpg'
    )
    .config('config')
    .defaults('quality', 90)
    .defaults('outputFormat', 'jpg')
    .boolean('faceDetection')
    .describe({
      config: 'path to a config.json',
      width: 'width of the crop',
      height: 'height of the crop',
      faceDetection: 'perform faceDetection using opencv',
      outputFormat: 'image magick output format string',
      quality: 'jpeg quality of the output image',
      '*': 'forwarded as options to smartcrop.js'
    })
    //.demand(['input', 'width','height'])
    .demand(1).argv,
  input = argv._[0],
  output = argv._[1];

var concat = require('concat-stream');
var gm = require('gm').subClass({ imageMagick: true });
var smartcrop = require('smartcrop-gm');
var _ = require('underscore');
var faceapi;

if (argv.faceDetection) {
  try {
    var tf = require('@tensorflow/tfjs-node');
    faceapi = require('face-api.js');
    var { Canvas, Image, ImageData } = require('canvas');
    faceapi.env.monkeyPatch({ Canvas, Image, ImageData });
    var path = require('path');
    var fs = require('fs');
  } catch (e) {
    console.error(e);
    console.error('skipping faceDetection');
    argv.faceDetection = false;
  }
}

var options = _.extend({}, argv.config, _.omit(argv, 'config', 'quality', 'faceDetection'));

function resize(result) {
  var crop = result.topCrop;
  var cmd = gm(input)
    .crop(crop.width, crop.height, crop.x, crop.y)
    .resize(options.width, options.height)
    .unsharp('2x0.5+1+0.008')
    .colorspace('sRGB')
    .autoOrient()
    .strip();

  if (argv.quality) {
    cmd = cmd.quality(argv.quality);
  }

  if (output === '-') {
    cmd.stream(argv.outputFormat).pipe(process.stdout);
  } else {
    cmd.write(output, function(err) {
      if (err) console.error(err);
    });
  }
}

async function faceDetect(input, options) {
  if (!argv.faceDetection) return false;
  try {
    // Load face-api.js models
    await faceapi.nets.tinyFaceDetector.loadFromDisk(path.join(__dirname, 'models'));

    // Read the image file
    const imgBuffer = await fs.promises.readFile(input);
    const image = new Image();

    // Wait for the image to load
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = imgBuffer;
    });

    // Detect faces using TinyFaceDetector
    const detections = await faceapi.detectAllFaces(image, new faceapi.TinyFaceDetectorOptions());

    // Map results to expected format
    options.boost = detections.map(det => ({
      x: det.box.x,
      y: det.box.y,
      width: det.box.width,
      height: det.box.height,
      weight: 1.0
    }));

    return true;
  } catch (err) {
    console.error('Face detection failed:', err);
    return false;
  }
}

function analyse() {
  faceDetect(input, options)
    .then(function() {
      return smartcrop.crop(input, options);
    })
    .then(
      function(result) {
        if (output !== '-') {
          console.log(JSON.stringify(result, null, '  '));
        }
        if (output && options.width && options.height) {
          resize(result);
        }
      },
      function(err) {
        console.error(err.stack);
      }
    );
}

if (input === '-') {
  process.stdin.pipe(
    concat(function(inputBuffer) {
      input = inputBuffer;
      analyse();
    })
  );
} else {
  analyse();
}
