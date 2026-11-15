/*
 * ZIP writer for the download (task 1.15, R-013). Browser: window.Hawiya.zip (designZip also needs bundle.js);
 * Node: require. No libraries, no clock.
 *
 *   designZip(bundle)  -> Uint8Array of hawiya-design.zip: a "design/" folder with the six files of a bundle that
 *                         passes bundle.verify (a damaged bundle is refused, never zipped)
 *   build(entries)     -> Uint8Array; entries = [{ name: 'design/DESIGN.md', data: string | Uint8Array }]
 *                         (a name ending in "/" is a folder); text is written as UTF-8
 *   list(bytes)        -> [{ name, data, dosDate, ... }] read back from the central directory (used by the tests)
 *   crc32(bytes)       -> CRC-32 (the ZIP checksum)
 *
 * Plain ZIP 2.0: every file "stored" (no compression; every system opens it), UTF-8 names, Unix permissions 644 for
 * files and 755 for the folder, and a fixed date, so the same files always give the same archive, byte for byte.
 * The date is 1985-10-26 (as npm does), not 1980-01-01: ZIP dates are local time, and 1980-01-01 00:00 extracted
 * east of UTC becomes a 1979 time that later ZIP tools refuse.
 */
(function (root, factory) {
  if (typeof module === 'object' && module && module.exports && typeof require === 'function') {
    module.exports = factory(function () {
      return require('./bundle.js');
    });
  } else {
    root.Hawiya = root.Hawiya || {};
    root.Hawiya.zip = factory(function () {
      return root.Hawiya.bundle;
    });
  }
})(typeof self !== 'undefined' ? self : this, function (getBundle) {
  'use strict';

  var FILE_NAME = 'hawiya-design.zip';
  var FOLDER = 'design/';
  var DOS_DATE = (5 << 9) | (10 << 5) | 26; // 1985-10-26 (years since 1980, month, day)
  var DOS_TIME = 0;
  var VERSION = 20; // ZIP 2.0
  var MADE_BY = (3 << 8) | VERSION; // Unix, so the permission bits below are used
  var FLAG_UTF8 = 0x0800;
  var FILE_ATTR = 0x81a4 * 0x10000; // regular file, 0644 (in the high 16 bits)
  var DIR_ATTR = 0x41ed * 0x10000 + 0x10; // directory, 0755, plus the MS-DOS directory bit

  function fail(msg) {
    throw new Error('Hawiya.zip: ' + msg);
  }

  /* ---------- CRC-32 (IEEE 802.3, the one ZIP uses) ---------- */

  var TABLE = (function () {
    var t = new Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  /* ---------- helpers ---------- */

  function utf8(text) {
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(text); // lone surrogates -> U+FFFD
    fail('TextEncoder is not available');
  }

  var WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

  // Only plain relative names that extract to the same place on every system: no "..", ".", empty parts, absolute
  // paths, drives, control characters, characters Windows refuses, lone surrogates, or a trailing dot or space.
  function checkName(name) {
    if (typeof name !== 'string' || name.length === 0 || name.length > 200) fail('bad entry name');
    if (name.charAt(0) === '/' || /[\\:*?"<>|\u0000-\u001f\u007f]/.test(name)) fail('bad entry name: ' + name);
    if (/[\ud800-\udbff](?![\udc00-\udfff])|(^|[^\ud800-\udbff])[\udc00-\udfff]/.test(name)) fail('bad entry name: ' + name);
    var parts = name.replace(/\/$/, '').split('/');
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i];
      if (part === '' || part === '.' || part === '..' || /[. ]$/.test(part) || WINDOWS_RESERVED.test(part)) fail('bad entry name: ' + name);
    }
  }

  // The key under which two names land on the same path on macOS / Windows (case and Unicode form ignored).
  function diskKey(name) {
    var n = typeof name.normalize === 'function' ? name.normalize('NFC') : name;
    return n.replace(/\/$/, '').toLowerCase();
  }

  function Writer() {
    this.parts = [];
    this.length = 0;
  }
  Writer.prototype.u16 = function (v) {
    this.raw([v & 0xff, (v >>> 8) & 0xff]);
  };
  Writer.prototype.u32 = function (v) {
    this.raw([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]);
  };
  Writer.prototype.raw = function (bytes) {
    this.parts.push(bytes);
    this.length += bytes.length;
  };
  Writer.prototype.bytes = function () {
    var out = new Uint8Array(this.length);
    var at = 0;
    for (var i = 0; i < this.parts.length; i++) {
      out.set(this.parts[i], at);
      at += this.parts[i].length;
    }
    return out;
  };

  /* ---------- writing ---------- */

  function build(entries) {
    if (!Array.isArray(entries) || entries.length === 0) fail('nothing to zip');
    if (entries.length > 1000) fail('too many entries');
    var seen = Object.create(null); // disk key -> 'dir' | 'file'
    var total = 0;
    var items = entries.map(function (e) {
      if (!e || typeof e !== 'object') fail('bad entry');
      var name = e.name; // each property read once: what is checked is what is written
      var given = e.data;
      checkName(name);
      var isDir = name.charAt(name.length - 1) === '/';
      var key = diskKey(name);
      if (key in seen) fail('two entries land on the same path: ' + name);
      seen[key] = isDir ? 'dir' : 'file';
      var data;
      if (isDir) {
        if (given !== undefined) fail('a folder entry has no content: ' + name);
        data = new Uint8Array(0);
      } else if (typeof given === 'string') data = utf8(given);
      else if (given instanceof Uint8Array) data = new Uint8Array(given); // a copy: later changes cannot leak in
      else fail('content of ' + name + ' must be text or bytes');
      total += data.length;
      if (total > 0x7fffffff) fail('archive too large');
      return { key: key, name: utf8(name), isDir: isDir, data: data, crc: crc32(data) };
    });
    // A file must not sit where a folder is needed (a file "design" and an entry "design/x").
    items.forEach(function (it) {
      var parts = it.key.split('/');
      for (var i = 1; i < parts.length; i++) {
        if (seen[parts.slice(0, i).join('/')] === 'file') fail('a file is in the way of folder ' + parts.slice(0, i).join('/'));
      }
    });

    var w = new Writer();
    items.forEach(function (it) {
      it.offset = w.length;
      w.u32(0x04034b50); // local file header
      w.u16(VERSION);
      w.u16(FLAG_UTF8);
      w.u16(0); // stored
      w.u16(DOS_TIME);
      w.u16(DOS_DATE);
      w.u32(it.crc);
      w.u32(it.data.length); // compressed size = size (stored)
      w.u32(it.data.length);
      w.u16(it.name.length);
      w.u16(0); // no extra field
      w.raw(it.name);
      w.raw(it.data);
    });
    var cdStart = w.length;
    items.forEach(function (it) {
      w.u32(0x02014b50); // central directory header
      w.u16(MADE_BY);
      w.u16(VERSION);
      w.u16(FLAG_UTF8);
      w.u16(0);
      w.u16(DOS_TIME);
      w.u16(DOS_DATE);
      w.u32(it.crc);
      w.u32(it.data.length);
      w.u32(it.data.length);
      w.u16(it.name.length);
      w.u16(0); // extra
      w.u16(0); // comment
      w.u16(0); // disk number
      w.u16(0); // internal attributes
      w.u32(it.isDir ? DIR_ATTR : FILE_ATTR);
      w.u32(it.offset);
      w.raw(it.name);
    });
    var cdSize = w.length - cdStart;
    w.u32(0x06054b50); // end of central directory
    w.u16(0);
    w.u16(0);
    w.u16(items.length);
    w.u16(items.length);
    w.u32(cdSize);
    w.u32(cdStart);
    w.u16(0); // no comment
    return w.bytes();
  }

  function designZip(bundle) {
    var b = getBundle();
    if (!b || typeof b.verify !== 'function') fail('load bundle.js before zip.js');
    if (!bundle || typeof bundle !== 'object' || !bundle.files || !bundle.sha256) fail('not an export bundle');
    // One plain copy, read once: the copy is what gets verified and what gets zipped.
    var copy = { format: bundle.format, schemaVersion: bundle.schemaVersion, identity: bundle.identity, files: {}, sha256: {} };
    Object.keys(bundle.files).forEach(function (n) {
      copy.files[n] = bundle.files[n];
    });
    Object.keys(bundle.sha256).forEach(function (n) {
      copy.sha256[n] = bundle.sha256[n];
    });
    var problems = b.verify(copy);
    if (problems.length) fail('the bundle is incomplete or damaged: ' + problems.join(', '));
    var entries = [{ name: FOLDER }];
    b.NAMES.forEach(function (n) {
      entries.push({ name: FOLDER + n, data: copy.files[n] });
    });
    return build(entries);
  }

  /* ---------- reading back (for checks) ---------- */

  function list(bytes) {
    function u16(at) {
      return bytes[at] | (bytes[at + 1] << 8);
    }
    function u32(at) {
      return (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0;
    }
    if (!(bytes instanceof Uint8Array)) fail('expected bytes');
    var end = bytes.length - 22;
    if (end < 0 || u32(end) !== 0x06054b50) fail('not a zip written by this module (no end record)');
    var count = u16(end + 10);
    var at = u32(end + 16);
    var need = function (from, len) {
      if (from + len > bytes.length) fail('entry out of bounds');
    };
    var nextLocal = 0; // entries must follow each other: no two central entries share data
    var out = [];
    for (var i = 0; i < count; i++) {
      need(at, 46);
      if (u32(at) !== 0x02014b50) fail('bad central directory');
      var nameLen = u16(at + 28);
      var extraLen = u16(at + 30);
      var commentLen = u16(at + 32);
      var size = u32(at + 20);
      var local = u32(at + 42);
      need(at + 46, nameLen);
      var name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLen));
      if (local !== nextLocal) fail('entries out of order or overlapping');
      need(local, 30);
      if (u32(local) !== 0x04034b50) fail('bad local header');
      var dataAt = local + 30 + u16(local + 26) + u16(local + 28);
      need(dataAt, size);
      nextLocal = dataAt + size;
      var data = bytes.subarray(dataAt, dataAt + size);
      if (crc32(data) !== u32(at + 16)) fail('checksum mismatch in ' + name);
      out.push({ name: name, data: data, size: size, method: u16(at + 10), dosDate: u16(at + 14), dosTime: u16(at + 12), attributes: u32(at + 38) });
      at += 46 + nameLen + extraLen + commentLen;
    }
    return out;
  }

  return { FILE_NAME: FILE_NAME, build: build, designZip: designZip, list: list, crc32: crc32 };
});
