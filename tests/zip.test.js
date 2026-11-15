'use strict';

/*
 * Task 1.15: hawiya-design.zip. A "design" folder with the six files; the system opens it without a warning; every
 * file comes out byte for byte (checked against its SHA-256 from the bundle). Built with picker/js/core/zip.js.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync, spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');

const zip = require('../picker/js/core/zip.js');
const bundle = require('../picker/js/core/bundle.js');

const ROOT = path.join(__dirname, '..');
const ID_DIR = path.join(__dirname, 'fixtures', 'identity', 'valid');
const NAMES = ['identity.json', 'DESIGN.md', 'tokens.json', 'tokens.css', 'theme.css', 'style-guide.html'];
const BUNDLES = fs
  .readdirSync(ID_DIR)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => [f, bundle.build(JSON.parse(fs.readFileSync(path.join(ID_DIR, f), 'utf8')))]);
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function tmpZip(bytes) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hawiya-zip-'));
  const file = path.join(dir, zip.FILE_NAME);
  fs.writeFileSync(file, bytes);
  return { dir, file };
}

const have = (cmd) => spawnSync('/bin/sh', ['-c', 'command -v ' + cmd]).status === 0;

test('crc32 matches zlib on empty, small, random and large inputs', () => {
  const inputs = [new Uint8Array(0), new TextEncoder().encode('abc'), new TextEncoder().encode('هوية \u{1F3A8}')];
  let seed = 3;
  for (let n of [1, 2, 3, 4, 7, 8, 255, 256, 1000, 65537, 5 * 1024 * 1024]) {
    const b = new Uint8Array(n);
    for (let i = 0; i < n; i++) b[i] = (seed = (seed * 1103515245 + 12345) >>> 0) >>> 24;
    inputs.push(b);
  }
  for (const b of inputs) assert.equal(zip.crc32(b), zlib.crc32(b), `length ${b.length}`);
  assert.equal(zip.crc32(new TextEncoder().encode('123456789')), 0xcbf43926, 'the standard check value');
});

test('the archive: a design folder with the six files, in order, stored as sent', () => {
  for (const [f, b] of BUNDLES) {
    const bytes = zip.designZip(b);
    assert.ok(bytes instanceof Uint8Array);
    const entries = zip.list(bytes);
    assert.deepEqual(entries.map((e) => e.name), ['design/'].concat(NAMES.map((n) => 'design/' + n)), f);
    for (const e of entries.slice(1)) {
      const name = e.name.slice('design/'.length);
      assert.equal(sha(Buffer.from(e.data)), b.sha256[name], `${f} ${name}: content matches its fingerprint`);
    }
  }
});

test('same bundle, same bytes; no clock in the archive', () => {
  for (const [f, b] of BUNDLES) {
    const a1 = zip.designZip(b);
    const a2 = zip.designZip(structuredClone(b));
    assert.equal(Buffer.compare(Buffer.from(a1), Buffer.from(a2)), 0, f);
    // 1985-10-26 00:00 local: after 1980 in every time zone once extracted (1980-01-01 becomes 1979 east of UTC)
    for (const e of zip.list(a1)) assert.deepEqual([e.dosDate, e.dosTime], [(5 << 9) | (10 << 5) | 26, 0], `${e.name}: fixed date, not today`);
  }
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'picker', 'js', 'core', 'zip.js'), 'utf8'), /\bDate\b|Math\.random/);
});

test('unzip tests the archive with no warning, and the extracted files equal their fingerprints', (t) => {
  if (!have('unzip')) return t.skip('unzip not found');
  for (const [f, b] of BUNDLES) {
    const { dir, file } = tmpZip(zip.designZip(b));
    try {
      const check = spawnSync('unzip', ['-t', file], { encoding: 'utf8' });
      assert.equal(check.status, 0, check.stdout + check.stderr);
      assert.match(check.stdout, /No errors detected/);
      assert.doesNotMatch(check.stdout + check.stderr, /warning|error:/i);
      const out = path.join(dir, 'out');
      execFileSync('unzip', ['-q', file, '-d', out]);
      assert.deepEqual(fs.readdirSync(out), ['design']);
      assert.deepEqual(fs.readdirSync(path.join(out, 'design')).sort(), [...NAMES].sort());
      for (const n of NAMES) {
        const p = path.join(out, 'design', n);
        assert.equal(sha(fs.readFileSync(p)), b.sha256[n], `${f} ${n}`);
        assert.equal(fs.statSync(p).mode & 0o777 & ~0o022, 0o644 & ~0o022, `${n}: readable file permissions`);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

test('the macOS Finder engine (ditto) and Python zipfile open it the same way', (t) => {
  const [, b] = BUNDLES[0];
  const { dir, file } = tmpZip(zip.designZip(b));
  try {
    if (have('ditto')) {
      const out = path.join(dir, 'ditto');
      const r = spawnSync('ditto', ['-x', '-k', file, out], { encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      assert.equal(r.stderr, '', 'no warning');
      for (const n of NAMES) assert.equal(sha(fs.readFileSync(path.join(out, 'design', n))), b.sha256[n], `ditto ${n}`);
    } else {
      t.diagnostic('ditto not found (not macOS): skipped');
    }
    if (have('python3')) {
      const py = 'import sys, zipfile, hashlib, json\nz = zipfile.ZipFile(sys.argv[1])\nassert z.testzip() is None\nprint(json.dumps({i.filename: hashlib.sha256(z.read(i)).hexdigest() for i in z.infolist() if not i.is_dir()}))';
      const r = spawnSync('python3', ['-I', '-c', py, file], { encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      const got = JSON.parse(r.stdout);
      for (const n of NAMES) assert.equal(got['design/' + n], b.sha256[n], `python ${n}`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('refuses names that could land outside the folder, collide on disk, or fail on some system', () => {
  for (const bad of ['../x', '/etc/x', 'a/../../x', 'a\\b', '', 'design//x', 'C:x', 'a/./b', 'a*b', 'a?b', 'a"b', 'a<b', 'a|b', 'CON', 'aux.txt', 'x/nul', 'trail.', 'trail ', 'a\ud800', 'a\udc00b']) {
    assert.throws(() => zip.build([{ name: bad, data: 'x' }]), /Hawiya\.zip/, JSON.stringify(bad));
  }
  assert.throws(() => zip.build([{ name: 'a', data: 1 }]), /Hawiya\.zip/);
  assert.throws(() => zip.build([{ name: 'a', data: 'x' }, { name: 'a', data: 'y' }]), /Hawiya\.zip/, 'duplicate name');
  assert.throws(() => zip.build([{ name: 'A.txt', data: 'x' }, { name: 'a.txt', data: 'y' }]), /same path/, 'differ only in case');
  assert.throws(() => zip.build([{ name: '\u00e9', data: 'x' }, { name: 'e\u0301', data: 'y' }]), /same path/, 'NFC and NFD forms');
  assert.throws(() => zip.build([{ name: 'design', data: 'x' }, { name: 'design/a.txt', data: 'y' }]), /in the way/, 'file where a folder is needed');
  assert.throws(() => zip.build([{ name: 'd/', data: 'x' }]), /folder entry has no content/);
  // each property is read once: a getter cannot pass the check with one name and write another
  let n = 0;
  const sneaky = { get name() { return ++n >= 2 ? '../../escape.txt' : 'ok.txt'; }, data: 'x' };
  assert.deepEqual(zip.list(zip.build([sneaky])).map((e) => e.name), ['ok.txt']);
  const b = structuredClone(BUNDLES[0][1]);
  b.files['tokens.css'] += ' ';
  assert.throws(() => zip.designZip(b), /Hawiya\.zip: .*tokens\.css/, 'a bundle that fails verify is never zipped');
  // a value that changes between the check and the copy cannot reach the archive
  const good = BUNDLES[0][1];
  let reads = 0;
  const tricky = structuredClone(good);
  Object.defineProperty(tricky.files, 'tokens.css', { enumerable: true, get() { return ++reads > 1 ? '/* tampered */\n' : good.files['tokens.css']; } });
  const out = zip.list(zip.designZip(tricky)).find((e) => e.name === 'design/tokens.css');
  assert.equal(sha(Buffer.from(out.data)), good.sha256['tokens.css']);
});

test('list() refuses hostile archives instead of reading out of bounds or reusing data', () => {
  const ok = zip.build([{ name: 'a', data: 'x' }, { name: 'b', data: 'y' }]);
  const bad1 = Uint8Array.from(ok);
  bad1[0] = 0; // local header signature
  assert.throws(() => zip.list(bad1), /local header/);
  const bad2 = Uint8Array.from(ok);
  const cd = Buffer.from(bad2).readUInt32LE(bad2.length - 22 + 16);
  Buffer.from(bad2.buffer).writeUInt32LE(0, cd + 46 + 1 + 42); // second entry points at the first one's data
  assert.throws(() => zip.list(bad2), /out of order|overlapping/);
  assert.throws(() => zip.list(new Uint8Array(10)), /end record/);
});

test('large and empty files go through unchanged', (t) => {
  if (!have('unzip')) return t.skip('unzip not found');
  const big = 'هوية \u{1F3A8} '.repeat(400000);
  const { dir, file } = tmpZip(zip.build([{ name: 'design/' }, { name: 'design/big.html', data: big }, { name: 'design/empty.css', data: '' }]));
  try {
    const out = path.join(dir, 'out');
    execFileSync('unzip', ['-q', file, '-d', out]);
    assert.equal(fs.readFileSync(path.join(out, 'design', 'big.html'), 'utf8'), big);
    assert.equal(fs.statSync(path.join(out, 'design', 'empty.css')).size, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a real browser (Chrome) builds exactly the same archive bytes as Node', async (t) => {
  const chrome = require('./helpers/chrome.js');
  const c = await chrome.launch();
  if (!c) return t.skip('Chrome not found (set CHROME_PATH to run this check)');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hawiya-zipb-'));
  try {
    const core = path.join(ROOT, 'picker', 'js', 'core');
    const scripts = ['schemas.js', 'validate.js', 'contrast.js', 'generate.js', 'bundle.js', 'zip.js'].map((f) => `<script src="file://${path.join(core, f)}"></script>`).join('\n');
    fs.writeFileSync(path.join(dir, 'p.html'), `<!doctype html><meta charset="utf-8">\n${scripts}\n`);
    await c.open('file://' + path.join(dir, 'p.html'));
    for (const [f, b] of BUNDLES) {
      const hex = await c.eval(`Array.from(Hawiya.zip.designZip(${JSON.stringify(b)}), (x) => x.toString(16).padStart(2, '0')).join('')`);
      assert.equal(hex, Buffer.from(zip.designZip(b)).toString('hex'), f);
    }
    assert.deepEqual(c.errors(), []);
  } finally {
    c.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('text is written as UTF-8 (Arabic, emoji; a lone surrogate becomes U+FFFD as in the bundle fingerprint)', () => {
  const text = 'هوية \u{1F3A8} x\ud800y\n';
  const bytes = zip.build([{ name: 'a.txt', data: text }]);
  const [e] = zip.list(bytes);
  assert.equal(Buffer.from(e.data).toString('utf8'), 'هوية \u{1F3A8} x�y\n');
  assert.equal(sha(Buffer.from(e.data)), bundle.sha256(text));
});

test('loads as a plain browser script (window.Hawiya.zip)', () => {
  const sandbox = { self: {}, TextEncoder };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'picker', 'js', 'core', 'zip.js'), 'utf8'), sandbox);
  const bytes = sandbox.self.Hawiya.zip.build([{ name: 'design/a.txt', data: 'x\n' }]);
  assert.equal(Buffer.compare(Buffer.from(bytes), Buffer.from(zip.build([{ name: 'design/a.txt', data: 'x\n' }]))), 0);
});
