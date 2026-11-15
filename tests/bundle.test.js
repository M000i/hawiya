'use strict';

/*
 * Task 1.11: the export bundle. Same identity -> the same six files, byte for byte, in every run, in Node and in
 * the browser; no date or time in any file; each file's SHA-256 matches its content; and the files equal the copies
 * saved in tests/fixtures/expected/ (any change to a generated file, DESIGN.md included, shows up here: R-077).
 *
 * When a generator change is intended: UPDATE_EXPECTED=1 node --test tests/bundle.test.js  (then review the diff).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const bundle = require('../picker/js/core/bundle.js');
const chrome = require('./helpers/chrome.js');

const ROOT = path.join(__dirname, '..');
const ID_DIR = path.join(__dirname, 'fixtures', 'identity', 'valid');
const EXPECTED = path.join(__dirname, 'fixtures', 'expected');
const NAMES = ['identity.json', 'DESIGN.md', 'tokens.json', 'tokens.css', 'theme.css', 'style-guide.html'];
const IDENTITIES = fs
  .readdirSync(ID_DIR)
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => [f.replace(/\.json$/, ''), JSON.parse(fs.readFileSync(path.join(ID_DIR, f), 'utf8'))]);
const nodeSha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

test('sha256 matches Node crypto (empty, ASCII, Arabic, emoji, lone surrogates, block boundaries, large)', () => {
  const cases = ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(63), 'a'.repeat(64), 'a'.repeat(65), 'a'.repeat(1000),
    '\u0647\u0648\u064a\u0629', '\u{1F3A8}\u{1F3A8}', 'x\ud800y', '\udc00', '\ud800', '\u00e9\u20ac\u{10FFFF}', '\r\n\t\0'];
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  for (let i = 0; i < 300; i++) {
    let s = '';
    const n = Math.floor(rnd() * 200);
    for (let j = 0; j < n; j++) s += String.fromCharCode(Math.floor(rnd() * 0xffff));
    cases.push(s);
  }
  cases.push(fs.readFileSync(path.join(EXPECTED, '..', '..', '..', 'spec.md'), 'utf8'));
  for (const s of cases) assert.equal(bundle.sha256(s), nodeSha(s), JSON.stringify(s.slice(0, 40)));
  // the published test vectors
  assert.equal(bundle.sha256('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(bundle.sha256(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});

test('the bundle: format, the six files in a fixed order, the identity, and a SHA-256 per file', () => {
  for (const [name, id] of IDENTITIES) {
    const b = bundle.build(id);
    assert.deepEqual(Object.keys(b), ['format', 'schemaVersion', 'identity', 'files', 'sha256'], name);
    assert.equal(b.format, 'hawiya-export');
    assert.equal(b.schemaVersion, 1);
    assert.deepEqual(b.identity, id);
    assert.deepEqual(Object.keys(b.files), NAMES, `${name}: file order`);
    assert.deepEqual(Object.keys(b.sha256), NAMES);
    for (const f of NAMES) {
      assert.equal(typeof b.files[f], 'string');
      assert.equal(b.sha256[f], nodeSha(b.files[f]), `${name} ${f}: fingerprint matches the content`);
    }
    assert.equal(b.files['identity.json'], JSON.stringify(b.identity, null, 2) + '\n', 'identity.json is the bundled identity');
    assert.deepEqual(bundle.verify(b), [], `${name}: verify finds nothing`);
  }
});

test('verify names every file whose content no longer matches its fingerprint, and rejects broken bundles', () => {
  const b = bundle.build(IDENTITIES[0][1]);
  const changed = structuredClone(b);
  changed.files['tokens.css'] += ' ';
  changed.files['DESIGN.md'] = changed.files['DESIGN.md'].replace('\n', '\r\n');
  assert.deepEqual(bundle.verify(changed), ['DESIGN.md', 'tokens.css']);
  const missing = structuredClone(b);
  delete missing.sha256['theme.css'];
  assert.deepEqual(bundle.verify(missing), ['theme.css']);
  const extra = structuredClone(b);
  extra.files['evil.js'] = 'x';
  extra.sha256['evil.js'] = nodeSha('x');
  assert.deepEqual(bundle.verify(extra), ['evil.js']);
  for (const bad of [null, {}, { files: 'x', sha256: {} }, { files: {}, sha256: null }, { files: { 'DESIGN.md': 5 }, sha256: { 'DESIGN.md': 'x' } }]) {
    assert.ok(bundle.verify(bad).length > 0, JSON.stringify(bad));
  }
  // a file removed together with its fingerprint is still missing
  const partial = structuredClone(b);
  delete partial.files['tokens.css'];
  delete partial.sha256['tokens.css'];
  assert.deepEqual(bundle.verify(partial), ['tokens.css']);
  // the format, and the identity object against identity.json
  assert.deepEqual(bundle.verify({ ...structuredClone(b), schemaVersion: 99 }), ['(format)']);
  const swapped = structuredClone(b);
  swapped.identity.name = 'Someone else';
  assert.deepEqual(bundle.verify(swapped), ['(identity)']);
  const rewritten = structuredClone(b);
  rewritten.files['identity.json'] = '{}\n';
  rewritten.sha256['identity.json'] = nodeSha('{}\n');
  assert.deepEqual(bundle.verify(rewritten), ['(identity)'], 'a re-fingerprinted identity.json still has to equal the identity');
  // __proto__ from JSON.parse is just an unknown name; many keys are checked in one pass
  const proto = JSON.parse(JSON.stringify(b).replace('"sha256":{', '"sha256":{"__proto__":"x",'));
  assert.deepEqual(bundle.verify(proto), ['__proto__']);
  const many = structuredClone(b);
  for (let i = 0; i < 400000; i++) many.files['x' + i] = '';
  const t0 = process.hrtime.bigint();
  assert.equal(bundle.verify(many).length, 400000);
  assert.ok(Number(process.hrtime.bigint() - t0) / 1e6 < 3000, 'linear time');
});

test('same identity, same bytes: twice in a row, with keys in another order, and equal to the saved copies', () => {
  const update = process.env.UPDATE_EXPECTED === '1';
  for (const [name, id] of IDENTITIES) {
    const a = bundle.build(id);
    const reversed = JSON.parse(JSON.stringify(id), function (k, v) {
      return v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v;
    });
    const b = bundle.build(reversed);
    assert.deepEqual(b, a, `${name}: input key order changes nothing`);
    const dir = path.join(EXPECTED, name);
    if (update) {
      fs.mkdirSync(dir, { recursive: true });
      for (const f of NAMES) fs.writeFileSync(path.join(dir, f), a.files[f]);
      continue;
    }
    assert.deepEqual(fs.readdirSync(dir).sort(), [...NAMES].sort(), `${name}: saved copies`);
    for (const f of NAMES) {
      const saved = fs.readFileSync(path.join(dir, f));
      assert.ok(saved.equals(Buffer.from(a.files[f], 'utf8')), `${name}/${f} differs from tests/fixtures/expected (if intended: UPDATE_EXPECTED=1, then review the diff)`);
    }
  }
  // an update run never passes: it only writes, so a forgotten UPDATE_EXPECTED cannot hide a change
  assert.ok(!update, 'UPDATE_EXPECTED=1: expected files rewritten. Review `git diff tests/fixtures/expected`, then run the tests without it.');
});

test('no date or time in any file', () => {
  const patterns = [/\b(19|20)\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/, /\b\d\d:\d\d(:\d\d)?\b/, /\bGMT\b|\bUTC\b/, /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d/, /\b1[6-9]\d{8}\b|\b1[6-9]\d{11}\b/];
  for (const [name, id] of IDENTITIES) {
    const b = bundle.build(id);
    for (const f of NAMES) for (const p of patterns) assert.doesNotMatch(b.files[f], p, `${name} ${f}`);
  }
  // and the generator never reads the clock
  const src = ['generate.js', 'bundle.js', 'validate.js', 'contrast.js', 'schemas.js'].map((f) => fs.readFileSync(path.join(ROOT, 'picker', 'js', 'core', f), 'utf8')).join('\n');
  assert.doesNotMatch(src, /\bDate\b|performance\.now|Math\.random|crypto\.getRandomValues/);
});

test('loads as plain browser scripts in the documented order', () => {
  const dir = path.join(ROOT, 'picker', 'js', 'core');
  const sandbox = { self: {} };
  for (const f of ['schemas.js', 'validate.js', 'contrast.js', 'generate.js', 'bundle.js']) vm.runInNewContext(fs.readFileSync(path.join(dir, f), 'utf8'), sandbox);
  // the identity is parsed inside the page's own realm, as the page would do
  sandbox.text = JSON.stringify(IDENTITIES[0][1]);
  const out = vm.runInNewContext('JSON.stringify(self.Hawiya.bundle.build(JSON.parse(text)))', sandbox);
  assert.equal(out, JSON.stringify(bundle.build(IDENTITIES[0][1])));
});

test('the browser (Chrome) builds exactly the same files and fingerprints as Node', async (t) => {
  const c = await chrome.launch();
  if (!c) return t.skip('Chrome not found (set CHROME_PATH to run this check)');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hawiya-bundle-'));
  try {
    const core = path.join(ROOT, 'picker', 'js', 'core');
    const scripts = ['schemas.js', 'validate.js', 'contrast.js', 'generate.js', 'bundle.js'].map((f) => `<script src="${'file://' + path.join(core, f)}"></script>`).join('\n');
    fs.writeFileSync(path.join(dir, 'p.html'), `<!doctype html><meta charset="utf-8">\n${scripts}\n`);
    await c.open('file://' + path.join(dir, 'p.html'));
    for (const [name, id] of IDENTITIES) {
      const inBrowser = await c.eval(`JSON.stringify(Hawiya.bundle.build(${JSON.stringify(id)}))`);
      assert.equal(inBrowser, JSON.stringify(bundle.build(id)), `${name}: browser and Node differ`);
    }
    assert.deepEqual(c.errors(), []);
  } finally {
    c.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
