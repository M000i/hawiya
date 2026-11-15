'use strict';

/*
 * Fault injection for the Node server tests only (preloaded with --require). Reads HAWIYA_INJECT, a JSON object:
 *   { "renameFail": "tokens.css", "times": 1 }  renameSync onto design/<name> throws EIO (the first `times` times)
 *   { "writeFail": "tokens.json" }              writeFileSync of that file's temp writes half, then throws EFBIG
 * Simulates disk errors the operating system cannot be made to produce on demand.
 */
const fs = require('node:fs');
const path = require('node:path');

const spec = JSON.parse(process.env.HAWIYA_INJECT || '{}');
let left = spec.times == null ? Infinity : spec.times;

if (spec.renameFail) {
  const real = fs.renameSync;
  fs.renameSync = function (from, to) {
    if (left > 0 && path.basename(String(to)) === spec.renameFail && path.basename(path.dirname(String(to))) === 'design') {
      left--;
      throw Object.assign(new Error('injected EIO'), { code: 'EIO' });
    }
    return real.apply(this, arguments);
  };
}
if (spec.writeFail) {
  const real = fs.writeFileSync;
  fs.writeFileSync = function (file, data, opts) {
    if (left > 0 && typeof file === 'string' && path.basename(file).startsWith('.' + spec.writeFail + '.') && file.endsWith('.tmp')) {
      left--;
      real.call(this, file, String(data).slice(0, Math.floor(String(data).length / 2)), opts);
      throw Object.assign(new Error('injected EFBIG'), { code: 'EFBIG' });
    }
    return real.apply(this, arguments);
  };
}
if (spec.slowLstat) {
  // { "slowLstat": "identity.json", "ms": 800 }: lstat of design/<name> takes that long (a slow disk during a save)
  const real = fs.lstatSync;
  const pause = new Int32Array(new SharedArrayBuffer(4));
  fs.lstatSync = function (p) {
    if (path.basename(String(p)) === spec.slowLstat && path.basename(path.dirname(String(p))) === 'design') Atomics.wait(pause, 0, 0, spec.ms || 800);
    return real.apply(this, arguments);
  };
}
