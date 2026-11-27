// qrcheck.js <png> : decode the QR code in a frame of the end card
const fs = require('fs'), path = require('path');
const { PNG } = require('pngjs');
const jsQR = require('jsqr');
const png = PNG.sync.read(fs.readFileSync(process.argv[2]));
const res = jsQR(new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.length), png.width, png.height);
console.log(res ? 'QR decodes to: ' + res.data : 'no QR found');
