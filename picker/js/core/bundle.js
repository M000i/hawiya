/*
 * Export bundle (task 1.11, R-077). Browser: window.Hawiya.bundle (load schemas.js, validate.js, contrast.js and
 * generate.js first); Node: require.
 *
 *   build(identity)  -> { format: 'hawiya-export', schemaVersion: 1, identity, files: { name: text }, sha256: { name: hex } }
 *                       the six files in a fixed order; identity is the checked identity in schema key order.
 *   verify(bundle)   -> [] when the bundle is whole: the format, all six files present with matching SHA-256, no
 *                       other file names, and identity equal to identity.json; else what is wrong (see verify).
 *   sha256(text)     -> hex SHA-256 of the UTF-8 bytes of text (lone surrogates as U+FFFD, like TextEncoder).
 *
 * SHA-256 is written out here (FIPS 180-4) because the browser's crypto.subtle is asynchronous and missing on some
 * file:// pages; it only uses 32-bit integer operations, which are exact in every JavaScript engine.
 * No clock and no randomness: the same identity always gives the same bundle.
 */
(function (root, factory) {
  if (typeof module === 'object' && module && module.exports && typeof require === 'function') {
    module.exports = factory(function () {
      return require('./generate.js');
    });
  } else {
    root.Hawiya = root.Hawiya || {};
    root.Hawiya.bundle = factory(function () {
      return root.Hawiya.generate;
    });
  }
})(typeof self !== 'undefined' ? self : this, function (getGenerate) {
  'use strict';

  var NAMES = ['identity.json', 'DESIGN.md', 'tokens.json', 'tokens.css', 'theme.css', 'style-guide.html'];
  var hasOwn = Function.prototype.call.bind(Object.prototype.hasOwnProperty);

  /* ---------- SHA-256 ---------- */

  // First 32 bits of the fractional parts of the cube roots of the first 64 primes (computed exactly, not typed in).
  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];
  // ... and of the square roots of the first 8 primes.
  var H0 = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
  ];

  function utf8(str) {
    var out = [];
    for (var i = 0; i < str.length; i++) {
      var cp = str.charCodeAt(i);
      if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < str.length) {
        var lo = str.charCodeAt(i + 1);
        if (lo >= 0xdc00 && lo <= 0xdfff) {
          cp = 0x10000 + ((cp - 0xd800) << 10) + (lo - 0xdc00);
          i++;
        } else {
          cp = 0xfffd;
        }
      } else if (cp >= 0xd800 && cp <= 0xdfff) {
        cp = 0xfffd;
      }
      if (cp < 0x80) out.push(cp);
      else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
      else if (cp < 0x10000) out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
      else out.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    }
    return out;
  }

  function sha256(text) {
    if (typeof text !== 'string') throw new Error('Hawiya.bundle: sha256 needs text');
    var bytes = utf8(text);
    var bitLenHi = Math.floor(bytes.length / 0x20000000); // length * 8, split into two 32-bit words
    var bitLenLo = (bytes.length * 8) >>> 0;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    bytes.push((bitLenHi >>> 24) & 255, (bitLenHi >>> 16) & 255, (bitLenHi >>> 8) & 255, bitLenHi & 255);
    bytes.push((bitLenLo >>> 24) & 255, (bitLenLo >>> 16) & 255, (bitLenLo >>> 8) & 255, bitLenLo & 255);

    var h = H0.slice();
    var w = new Array(64);
    for (var off = 0; off < bytes.length; off += 64) {
      for (var t = 0; t < 16; t++) {
        var j = off + t * 4;
        w[t] = ((bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3]) | 0;
      }
      for (t = 16; t < 64; t++) {
        var x = w[t - 15];
        var y = w[t - 2];
        var s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
        var s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
      }
      var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
      for (t = 0; t < 64; t++) {
        var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        var ch = (e & f) ^ (~e & g);
        var t1 = (hh + S1 + ch + K[t] + w[t]) | 0;
        var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + maj) | 0;
        hh = g;
        g = f;
        f = e;
        e = (d + t1) | 0;
        d = c;
        c = b;
        b = a;
        a = (t1 + t2) | 0;
      }
      h[0] = (h[0] + a) | 0;
      h[1] = (h[1] + b) | 0;
      h[2] = (h[2] + c) | 0;
      h[3] = (h[3] + d) | 0;
      h[4] = (h[4] + e) | 0;
      h[5] = (h[5] + f) | 0;
      h[6] = (h[6] + g) | 0;
      h[7] = (h[7] + hh) | 0;
    }
    return h
      .map(function (v) {
        return ('00000000' + (v >>> 0).toString(16)).slice(-8);
      })
      .join('');
  }

  /* ---------- bundle ---------- */

  function build(identity) {
    var g = getGenerate();
    if (!g || !g.valueFiles) throw new Error('Hawiya.bundle: load generate.js (and its dependencies) before bundle.js');
    var values = g.valueFiles(identity); // checks the identity first; throws with .errors when it is not valid
    var all = {
      'identity.json': values['identity.json'],
      'DESIGN.md': g.designMd(identity),
      'tokens.json': values['tokens.json'],
      'tokens.css': values['tokens.css'],
      'theme.css': values['theme.css'],
      'style-guide.html': g.styleGuide(identity)
    };
    var files = {};
    var sums = {};
    NAMES.forEach(function (n) {
      files[n] = all[n];
      sums[n] = sha256(all[n]);
    });
    return { format: 'hawiya-export', schemaVersion: 1, identity: JSON.parse(values['identity.json']), files: files, sha256: sums };
  }

  var IS_NAME = {};
  NAMES.forEach(function (n) {
    IS_NAME[n] = true;
  });

  // Lists what is wrong, in a fixed order: '(bundle)' or '(format)', then each of the six files that is missing or
  // whose content does not match its fingerprint, then unknown file names, then '(identity)' when the bundled
  // identity object and identity.json disagree. One pass over the keys (no quadratic work on large bodies).
  // The fingerprints catch damage in transit or copying; they are not a signature (anyone can recompute them).
  function verify(b) {
    if (!b || typeof b !== 'object' || !b.files || typeof b.files !== 'object' || !b.sha256 || typeof b.sha256 !== 'object') {
      return ['(bundle)'];
    }
    var bad = [];
    if (b.format !== 'hawiya-export' || b.schemaVersion !== 1) bad.push('(format)');
    NAMES.forEach(function (n) {
      var ok =
        hasOwn(b.files, n) &&
        hasOwn(b.sha256, n) &&
        typeof b.files[n] === 'string' &&
        typeof b.sha256[n] === 'string' &&
        sha256(b.files[n]) === b.sha256[n];
      if (!ok) bad.push(n);
    });
    var extra = Object.create(null);
    [b.files, b.sha256].forEach(function (o) {
      var keys = Object.keys(o);
      for (var i = 0; i < keys.length; i++) if (!hasOwn(IS_NAME, keys[i])) extra[keys[i]] = true;
    });
    bad = bad.concat(Object.keys(extra).sort());
    var text = typeof b.files['identity.json'] === 'string' && hasOwn(b.files, 'identity.json') ? b.files['identity.json'] : null;
    var same = false;
    try {
      same = text !== null && JSON.stringify(b.identity, null, 2) + '\n' === text;
    } catch (e) {
      same = false;
    }
    if (!same) bad.push('(identity)');
    return bad;
  }

  return { NAMES: NAMES, build: build, verify: verify, sha256: sha256 };
});
