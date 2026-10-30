// The browser scripts use classic globals, even under the parent ESM package.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = { module: { exports: {} }, setTimeout, clearTimeout, console, Float32Array, Uint32Array, Uint8Array, Uint8ClampedArray, Int8Array, Int32Array, Uint16Array };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'knit-renderer.js'), 'utf8'), context);
module.exports = context.module.exports;
