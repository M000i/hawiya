'use strict';

/*
 * Task 1.7: the library-free checker (picker/js/core/validate.js) must agree with the schemas as Ajv reads them.
 * For every shared sample, and for many random variations of them, it must give the same verdict, and report its
 * errors at the same places with the same keywords as Ajv (allErrors mode).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const Ajv2020 = require('ajv/dist/2020');
const { applyCase } = require('./fixtures/mutate.js');
const validate = require('../picker/js/core/validate.js');
const buildSchemas = require('../scripts/build-schemas.js');

const ROOT = path.join(__dirname, '..');
const NAMES = ['identity', 'template', 'session'];

const loadJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const schemaOf = (n) => loadJson(path.join(ROOT, 'schema', `${n}.schema.json`));

const ajvFns = {};
for (const n of NAMES) {
  const ajv = new Ajv2020({ strict: true, strictRequired: false, allowUnionTypes: true, allErrors: true });
  ajvFns[n] = ajv.compile(schemaOf(n));
}

function ajvResult(n, doc) {
  const fn = ajvFns[n];
  const valid = fn(doc);
  return { valid, errors: valid ? [] : fn.errors };
}

// The comparable part of an error list: "place keyword", as a sorted multiset.
const sig = (errors) => errors.map((e) => `${e.instancePath} ${e.keyword}`).sort();

function assertSame(n, doc, label) {
  const a = ajvResult(n, doc);
  const m = validate.check(n, doc);
  assert.equal(m.valid, a.valid, `${label}: verdict differs (checker ${m.valid}, Ajv ${a.valid})\n${JSON.stringify(m.errors)}\n${JSON.stringify(a.errors)}`);
  assert.deepEqual(sig(m.errors), sig(a.errors), `${label}: error places differ`);
  return a.valid;
}

const samples = {};
for (const n of NAMES) {
  const dir = path.join(ROOT, 'tests', 'fixtures', n);
  const files = fs.readdirSync(path.join(dir, 'valid')).filter((f) => f.endsWith('.json')).sort();
  samples[n] = {
    bases: Object.fromEntries(files.map((f) => [f, loadJson(path.join(dir, 'valid', f))])),
    cases: loadJson(path.join(dir, 'invalid.json')).cases
  };
}

test('schemas.js is an up-to-date copy of schema/*.json', () => {
  assert.equal(fs.readFileSync(buildSchemas.OUT, 'utf8'), buildSchemas.render(), 'run: node scripts/build-schemas.js');
  const embedded = require('../picker/js/core/schemas.js');
  for (const n of NAMES) assert.deepEqual(embedded[n], schemaOf(n), n);
});

for (const n of NAMES) {
  test(`[${n}] shared samples: same verdict and same error places as Ajv`, (t) => {
    const { bases, cases } = samples[n];
    for (const [f, doc] of Object.entries(bases)) {
      assert.equal(assertSame(n, doc, f), true, `${f} should be accepted`);
    }
    for (const c of cases) {
      const doc = applyCase(bases[c.base], c);
      assert.equal(assertSame(n, doc, c.reason), false, `should be rejected: ${c.reason}`);
      const places = [...new Set(validate.check(n, doc).errors.filter((e) => e.keyword !== 'if').map((e) => e.instancePath))];
      assert.deepEqual(places, [c.at], `"${c.reason}" reported at ${JSON.stringify(places)}, expected ${c.at || '(root)'}`);
    }
    t.diagnostic(`${n}: ${Object.keys(bases).length} accepted + ${cases.length} rejected, all as Ajv`);
  });
}

test('[identity] raw-text cases through checkText: same verdicts as Ajv and as the fixture says', (t) => {
  const dir = path.join(ROOT, 'tests', 'fixtures', 'identity');
  const { cases } = loadJson(path.join(dir, 'raw.json'));
  for (const c of cases) {
    const raw = fs.readFileSync(path.join(dir, 'valid', c.base), 'utf8').replace(c.find, c.with);
    let ajvVerdict;
    try {
      ajvVerdict = ajvFns.identity(JSON.parse(raw));
    } catch {
      ajvVerdict = false;
    }
    const r = validate.checkText('identity', raw);
    assert.equal(r.valid, c.valid, c.reason);
    assert.equal(r.valid, ajvVerdict, `${c.reason}: Ajv says ${ajvVerdict}`);
    if (!r.valid) assert.ok(r.errors.length > 0 && r.errors[0].message, c.reason);
  }
  t.diagnostic(`${cases.length} raw cases`);
});

// Every object in every sample, with one extra key added. Open places (template tokens/extras: checked by task 3.1;
// override names: any safe name) may accept it — but only where Ajv does too.
const EXTRA_KEYS = ['zz-unknown', 'Extra', '', 'constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', 'prototype'];

function objectPaths(node, at = []) {
  const out = [];
  if (node && typeof node === 'object') {
    if (!Array.isArray(node)) out.push(at);
    for (const k of Object.keys(node)) out.push(...objectPaths(node[k], at.concat(Array.isArray(node) ? Number(k) : k)));
  }
  return out;
}

function getAt(doc, p) {
  return p.reduce((n, k) => n[k], doc);
}

function addOwnKey(obj, key, value) {
  Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
}

test('an unknown key is rejected at every place the schema closes (and "__proto__"/"constructor" are just unknown keys)', (t) => {
  let rejected = 0;
  let accepted = 0;
  for (const n of NAMES) {
    for (const [f, base] of Object.entries(samples[n].bases)) {
      for (const p of objectPaths(base)) {
        for (const key of EXTRA_KEYS) {
          if (Object.prototype.hasOwnProperty.call(getAt(base, p), key)) continue;
          const doc = structuredClone(base);
          addOwnKey(getAt(doc, p), key, 1);
          const ok = assertSame(n, doc, `${f} + "${key}" at /${p.join('/')}`);
          if (ok) {
            accepted++;
            const open =
              (n === 'template' && (p[0] === 'tokens' || p[0] === 'extras')) ||
              (n === 'identity' && p[0] === 'selections' && p[p.length - 1] === 'overrides');
            assert.ok(open, `${n}: "${key}" accepted at /${p.join('/')}, which is not an open place`);
          } else {
            rejected++;
          }
        }
      }
    }
  }
  assert.ok(rejected > 1000, String(rejected));
  t.diagnostic(`${rejected} unknown-key insertions rejected, ${accepted} accepted at open places (same as Ajv)`);
});

/* ---------- random variations, compared with Ajv ---------- */

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = s;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const EMOJI = '\u{1F3A8}';
const POOL = [
  null, true, false, 0, -0, 1, -1, 0.5, 1.5, 2, 2.5, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 16, 32, 33, 64, 65, 128, 129, 200, 201, 256, 257,
  9999, 10000, 10001, -10000, -10001, -64, -65, 1e21, 0.1, 0.9999,
  '', ' ', 'a', 'A', 'ar', 'en', 'ar+en', 'rtl', 'ltr', 'both', 'web', 'AA', 'AAA', 'n/a', 'web-app', 'landing', 'minimal', 'colors',
  'type-scale', 'buttons', 'draft', 'reviewed', 'numeric', 'composite', 'curated', 'setting', '2026-11-15', '2026-13-01', '2026-02-30',
  'https://example.com/x', 'http://example.com', 'https://a b', 'MIT', 'Apache-2.0', '-MIT', '#ffffff', '#FFFFFF', '#fff', '#12345g',
  'system-ui', 'serif', 'IBM Plex Sans Arabic', 'Cairo', '"Cairo"', 'a--b', 'a-', '-a', 'a1-b2', 'constructor', 'prototype', '__proto__',
  'x'.repeat(64), 'x'.repeat(65), 'x'.repeat(80), 'x'.repeat(81), EMOJI.repeat(80), EMOJI.repeat(81), 'a<b', 'a‮b', '​', ' a ',
  '\ud800', 'a\ud800b', '١٢', 'light', 'dark', 'outline', 'gregory', 'latn', 'arab', 'subtle', 'none', 'circle',
  [], [1], ['a'], ['a', 'a'], ['colors'], ['colors', 'colors'], ['minimal'], ['web'], ['system-ui'], [1, 2, 3], [[]], [{}],
  {}, { a: 1 }, { x: 0, y: 0, blur: 0, spread: 0, color: '#000000', alpha: 0.5 }, { template: 'x' }, { state: 'draft' },
  { state: 'reviewed', reviewedAt: '2026-01-01' }, { html: 'a', css: 'b' }, { arabic: 'Cairo', fallback: ['serif'] }
];
const UNKNOWN_KEYS = ['zz', 'Name', '', 'constructor', '__proto__', 'toString', 'reviewedAt', 'recipe', 'notes', 'inset', 'latin', 'colors', 'x-y', 'a'.repeat(65)];
const SUFFIXES = [' ', 'A', '-', '0', '<', EMOJI, '‮', '\ud800', 'x'.repeat(70), '-x', '--'];

function allPaths(node, at = []) {
  const out = [at];
  if (node && typeof node === 'object') {
    for (const k of Object.keys(node)) out.push(...allPaths(node[k], at.concat(Array.isArray(node) ? Number(k) : k)));
  }
  return out;
}

const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const clone = (v) => (v === undefined ? v : structuredClone(v));

function setAt(doc, p, value) {
  if (p.length === 0) return value;
  const parent = getAt(doc, p.slice(0, -1));
  const k = p[p.length - 1];
  if (k === '__proto__' && !Array.isArray(parent)) addOwnKey(parent, k, value);
  else parent[k] = value;
  return doc;
}

function mutate(r, doc) {
  const paths = allPaths(doc);
  const p = pick(r, paths);
  const cur = getAt(doc, p);
  const op = Math.floor(r() * 9);
  if (op === 0 && p.length > 0) {
    const parent = getAt(doc, p.slice(0, -1));
    if (Array.isArray(parent)) parent.splice(p[p.length - 1], 1);
    else delete parent[p[p.length - 1]];
    return doc;
  }
  if (op === 1) return setAt(doc, p, clone(pick(r, POOL)));
  if (op === 2 && cur && typeof cur === 'object' && !Array.isArray(cur)) {
    addOwnKey(cur, pick(r, UNKNOWN_KEYS), clone(r() < 0.5 ? pick(r, POOL) : getAt(doc, pick(r, paths))));
    return doc;
  }
  if (op === 3 && Array.isArray(cur) && cur.length) {
    cur.push(clone(pick(r, cur)));
    return doc;
  }
  if (op === 4) return setAt(doc, p, clone(getAt(doc, pick(r, paths)))); // a value from elsewhere in the document
  if (op === 5 && typeof cur === 'string') return setAt(doc, p, r() < 0.5 ? cur + pick(r, SUFFIXES) : pick(r, SUFFIXES) + cur);
  if (op === 6 && typeof cur === 'number') return setAt(doc, p, pick(r, [cur + 1, cur - 1, cur * 10, cur + 0.5, -cur, 0, cur / 3]));
  if (op === 7 && Array.isArray(cur)) return setAt(doc, p, r() < 0.5 ? [] : cur.slice(0, 1));
  if (op === 8 && cur && typeof cur === 'object' && !Array.isArray(cur)) {
    // rename a key (often to a known key of another object)
    const keys = Object.keys(cur);
    if (keys.length) {
      const k = pick(r, keys);
      const v = cur[k];
      delete cur[k];
      addOwnKey(cur, pick(r, UNKNOWN_KEYS.concat(keys)), v);
    }
    return doc;
  }
  return setAt(doc, p, clone(pick(r, POOL)));
}

test('random variations of every sample: checker and Ajv agree on verdict and error places (seeded)', (t) => {
  const r = rng(17);
  const PER_BASE = 2500;
  let n = 0;
  let valid = 0;
  for (const name of NAMES) {
    for (const [f, base] of Object.entries(samples[name].bases)) {
      for (let i = 0; i < PER_BASE; i++) {
        let doc = structuredClone(base);
        const times = 1 + Math.floor(r() * 3);
        for (let j = 0; j < times; j++) doc = mutate(r, doc);
        if (assertSame(name, doc, `${f} variation ${i}`)) valid++;
        n++;
      }
    }
  }
  assert.ok(valid > 500 && n - valid > 10000, `${valid} accepted of ${n}`);
  t.diagnostic(`${n} variations: ${valid} accepted and ${n - valid} rejected, every one exactly as Ajv`);
});

/* ---------- direct checks ---------- */

test('values JSON cannot hold are rejected (a broken calculation is never saved as null)', () => {
  const base = samples.identity.bases['identity-ar-web-app.json'];
  for (const bad of [NaN, Infinity, -Infinity, undefined, () => 1, new Date(0), 10n]) {
    const doc = structuredClone(base);
    doc.tokens.typeScale.base = bad;
    const r = validate.check('identity', doc);
    assert.equal(r.valid, false, String(bad));
    assert.deepEqual([...new Set(r.errors.map((e) => e.instancePath))], ['/tokens/typeScale/base'], String(bad));
  }
  class Box {}
  const doc = structuredClone(base);
  doc.project = Object.assign(new Box(), doc.project);
  assert.equal(validate.check('identity', doc).valid, false, 'class instance is not a JSON object');
  assert.equal(validate.check('identity', Object.assign(Object.create(null), base)).valid, true, 'null-prototype object is fine');
});

test('characters are counted as characters, keys as own keys', () => {
  assert.equal(validate.charLength(EMOJI.repeat(80)), 80);
  assert.equal(validate.charLength('a\ud800b'), 3);
  assert.equal(validate.charLength('\udc00\ud800'), 2);
  const base = samples.identity.bases['identity-ar-web-app.json'];
  for (const [name, ok] of [[EMOJI.repeat(80), true], [EMOJI.repeat(81), false], ['x'.repeat(80), true], ['x'.repeat(81), false]]) {
    assert.equal(validate.check('identity', { ...base, name }).valid, ok, `${name.length} UTF-16 units`);
  }
  // a required key that every object inherits (toString, constructor) is still missing unless the document has it
  const needs = validate.compile({ type: 'object', required: ['toString', 'constructor'] });
  assert.deepEqual(needs({}).errors.map((e) => e.params.missingProperty), ['toString', 'constructor']);
  assert.equal(needs({ toString: 1, constructor: 2 }).valid, true);
});

test('checkText rejects text that is not JSON or not text', () => {
  for (const t of ['', '{', '{"a":1,}', 'NaN', "{'a':1}", undefined, null, 42, {}]) {
    const r = validate.checkText('identity', t);
    assert.equal(r.valid, false, String(t));
    assert.equal(r.errors[0].keyword, 'json');
  }
});

test('a schema using a keyword the checker does not know is refused, never silently skipped', () => {
  for (const s of [{ format: 'email' }, { type: 'string', multipleOf: 2 }, { prefixItems: [] }, { properties: { a: { dependentRequired: {} } } }, { $ref: '#/$defs/missing' }, { $ref: 'other.json' }, { type: 'float' }, { pattern: '(' }]) {
    assert.throws(() => validate.compile(s), /Hawiya\.validate/, JSON.stringify(s));
  }
  assert.throws(() => validate.check('people', {}), /unknown schema/);
  // and the three real schemas use only known keywords
  for (const n of NAMES) assert.doesNotThrow(() => validate.compile(schemaOf(n)));
});

test('loads as plain browser scripts (schemas.js then validate.js → window.Hawiya.validate)', () => {
  const dir = path.join(ROOT, 'picker', 'js', 'core');
  const sandbox = { self: { Hawiya: { kept: 1 } } };
  vm.runInNewContext(fs.readFileSync(path.join(dir, 'schemas.js'), 'utf8'), sandbox);
  vm.runInNewContext(fs.readFileSync(path.join(dir, 'validate.js'), 'utf8'), sandbox);
  const v = sandbox.self.Hawiya.validate;
  assert.equal(sandbox.self.Hawiya.kept, 1);
  const text = fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'identity', 'valid', 'identity-ar-web-app.json'), 'utf8');
  assert.equal(v.checkText('identity', text).valid, true);
  const bad = v.checkText('identity', text.replace('"schemaVersion": 1', '"schemaVersion": 2'));
  assert.equal(bad.valid, false);
  assert.equal(bad.errors[0].instancePath, '/schemaVersion');
});

/* ---------- safety (independent review of task 1.7) ---------- */

test('the identity name pattern matches exactly the same strings as the original form, in linear time', () => {
  const now = schemaOf('identity').properties.name.pattern;
  const SP = now.slice(2, now.indexOf(']*[^'));
  const X = now.slice(now.indexOf(']*[^') + 4, now.indexOf(SP + '][^'));
  const before = new RegExp('^[^' + X + ']*[^' + X + SP + '][^' + X + ']*$', 'u'); // the form used until task 1.7
  const after = new RegExp(now, 'u');
  // one character from each side of every class boundary, plus ordinary letters, emoji and lone surrogates
  const cps = [0x0, 0x1f, 0x20, 0x21, 0x3c, 0x3e, 0x41, 0x7e, 0x7f, 0x9f, 0xa0, 0xa1, 0x61b, 0x61c, 0x61d, 0x627, 0x1680, 0x1fff, 0x2000,
    0x200a, 0x200b, 0x200c, 0x200e, 0x200f, 0x2010, 0x2027, 0x2028, 0x2029, 0x202a, 0x202e, 0x202f, 0x2030, 0x205f, 0x2065, 0x2066,
    0x2069, 0x206a, 0x3000, 0x3001, 0xd7ff, 0xd800, 0xdbff, 0xdc00, 0xdfff, 0xe000, 0xfefe, 0xfeff, 0xff00, 0x1f3a8];
  const chars = cps.map((c) => String.fromCodePoint(c));
  let n = 0;
  const visit = (s, depth) => {
    assert.equal(after.test(s), before.test(s), JSON.stringify(s));
    n++;
    if (depth < 3) for (const c of chars) visit(s + c, depth + 1);
  };
  visit('', 0);
  assert.ok(n > 100000, String(n));
  const base = samples.identity.bases['identity-ar-web-app.json'];
  for (const name of ['a'.repeat(1e6) + '<', 'a '.repeat(5e5) + '\u0001', ' '.repeat(1e6), ' '.repeat(1e6) + 'a<']) {
    const t0 = process.hrtime.bigint();
    assert.equal(validate.check('identity', { ...base, name }).valid, false);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.ok(ms < 1000, `${name.length} characters took ${ms.toFixed(0)} ms`);
  }
});

test('very deep, cyclic or huge documents are rejected quickly and never crash the caller', () => {
  const deep = (d) => '['.repeat(d) + ']'.repeat(d);
  for (const [name, text] of [
    ['session', `{"type":"landing","language":"ar","tags":[${deep(10000)},${deep(10000)}]}`],
    ['template', fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'template', 'valid', 'button-solid.json'), 'utf8').replace('"tokens": {', `"tokens": {"deep": ${'{"a":'.repeat(20000)}1${'}'.repeat(20000)},`)]
  ]) {
    const r = validate.checkText(name, text);
    assert.equal(r.valid, false, name);
    assert.match(r.errors[0].message, /deeper than/);
  }
  const cyclic = structuredClone(samples.template.bases['button-solid.json']);
  cyclic.tokens.self = cyclic.tokens;
  assert.equal(validate.check('template', cyclic).valid, false);
  // just below the limit is still checked normally
  const ok = structuredClone(samples.template.bases['button-solid.json']);
  let node = ok.tokens;
  for (let i = 0; i < validate.MAX_DEPTH - 3; i++) node = node.a = {};
  assert.equal(validate.check('template', ok).valid, true);
  // long lists: the duplicate check is one pass, not every pair
  for (const [name, doc] of [
    ['session', { type: 'landing', language: 'ar', tags: Array.from({ length: 300000 }, (_, i) => i) }],
    ['identity', { ...samples.identity.bases['identity-ar-web-app.json'], leaveToAI: Array.from({ length: 300000 }, (_, i) => 'a' + i) }]
  ]) {
    const t0 = process.hrtime.bigint();
    assert.equal(validate.check(name, doc).valid, false);
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.ok(ms < 3000, `${name}: ${ms.toFixed(0)} ms`);
  }
});

test('checkText rejects a key written twice (the file on disk must hold only checked values)', () => {
  const text = fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'identity', 'valid', 'identity-ar-web-app.json'), 'utf8');
  const top = text.replace('"name":', '"name": "<img src=x onerror=alert(1)>", "name":');
  let r = validate.checkText('identity', top);
  assert.equal(r.valid, false);
  assert.deepEqual([r.errors[0].keyword, r.errors[0].instancePath, r.errors[0].params.key], ['duplicateKey', '', 'name']);
  // nested, and written differently ("primary" is "primary")
  r = validate.checkText('identity', text.replace('"primary":', '"\\u0070rimary": "#000000", "primary":'));
  assert.equal(r.valid, false);
  assert.equal(r.errors[0].instancePath, '/tokens/color/light');
  // inside arrays: the path counts items
  r = validate.checkText('template', '{"a":[1,{"b":2},{"c":3,"c":4}]}');
  assert.deepEqual([r.errors[0].keyword, r.errors[0].instancePath], ['duplicateKey', '/a/2']);
  // strings full of brackets, commas, quotes and backslashes do not confuse the scan
  const tricky = validate.checkText('identity', text.replace(/"name": "[^"]*"/, '"name": "a{\\"b\\":[1,2]}, \\\\\\"c\\\\"'));
  assert.equal(tricky.errors.some((e) => e.keyword === 'duplicateKey'), false, JSON.stringify(tricky.errors));
  // the same key in two different objects is fine
  assert.equal(validate.checkText('session', '{"type":"landing","language":"ar","tags":["minimal"]}').valid, true);
});

test('values JSON cannot hold are rejected in open places too (template tokens / extras)', () => {
  const base = samples.template.bases['button-solid.json'];
  const cases = [
    (d) => (d.tokens.a = NaN),
    (d) => (d.tokens.a = undefined),
    (d) => (d.extras = { list: [1, , 3] }), // eslint-disable-line no-sparse-arrays
    (d) => (d.extras = { list: Object.assign([1], { extra: 2 }) }),
    (d) => Object.defineProperty(d.tokens, 'g', { get: () => '<x>', enumerable: true }),
    (d) => (d.tokens.when = new Date(0))
  ];
  for (const [i, f] of cases.entries()) {
    const doc = structuredClone(base);
    f(doc);
    const r = validate.check('template', doc);
    assert.equal(r.valid, false, `case ${i}`);
    assert.equal(r.errors[0].keyword, 'json', `case ${i}`);
  }
});

test('the embedded schemas are read-only', () => {
  const embedded = require('../picker/js/core/schemas.js');
  assert.ok(Object.isFrozen(embedded.identity) && Object.isFrozen(embedded.identity.properties.name));
  assert.throws(() => {
    'use strict';
    embedded.identity.additionalProperties = true;
  }, TypeError);
  const base = samples.identity.bases['identity-ar-web-app.json'];
  assert.equal(validate.check('identity', { ...base, evil: 1 }).valid, false);
});

test('schema values the checker would misread are refused too', () => {
  for (const s of [{ uniqueItems: 1 }, { maxLength: '2' }, { maxLength: -1 }, { type: [] }, { required: [1] }, { enum: [] }, { if: {} }, { minimum: '1' }, { properties: { a: { $id: 'x' } } }]) {
    assert.throws(() => validate.compile(s), /Hawiya\.validate/, JSON.stringify(s));
  }
});

test('browser loading: a page-level "module" global is not mistaken for Node; a missing schemas.js fails at load', () => {
  const dir = path.join(ROOT, 'picker', 'js', 'core');
  const schemasSrc = fs.readFileSync(path.join(dir, 'schemas.js'), 'utf8');
  const validateSrc = fs.readFileSync(path.join(dir, 'validate.js'), 'utf8');
  const sandbox = { self: {}, module: { exports: {} } };
  vm.runInNewContext(schemasSrc, sandbox);
  vm.runInNewContext(validateSrc, sandbox);
  assert.equal(typeof sandbox.self.Hawiya.validate.check, 'function');
  assert.throws(() => vm.runInNewContext(validateSrc, { self: {} }), /load schemas\.js before validate\.js/);
});

test('duplicate items are compared as JSON values: key order does not matter, types do', () => {
  const unique = validate.compile({ type: 'array', uniqueItems: true });
  for (const [list, ok] of [
    [[{ a: 1, b: [1, { c: 2, d: 3 }] }, { b: [1, { d: 3, c: 2 }], a: 1 }], false],
    [[{ a: 1 }, { a: '1' }], true],
    [[1, '1'], true],
    [[0, -0], false],
    [[[1, 2], [2, 1]], true],
    [[null, 'null'], true],
    [[{}, []], true]
  ]) {
    assert.equal(unique(list).valid, ok, JSON.stringify(list));
  }
  // and Ajv sees the same in a real schema
  assertSame('session', { type: 'landing', language: 'ar', tags: [{ a: 1, b: 2 }, { b: 2, a: 1 }] }, 'object tags in a different key order');
});

test('numbers too large for JSON numbers (1e400 → Infinity) are rejected, also in open places', () => {
  const text = fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'template', 'valid', 'button-solid.json'), 'utf8');
  for (const big of ['1e400', '-1e400']) {
    const r = validate.checkText('template', text.replace('"tokens": {', `"tokens": {"zz": ${big},`));
    assert.equal(r.valid, false, big);
    assert.deepEqual([r.errors[0].keyword, r.errors[0].instancePath], ['json', '/tokens/zz']);
  }
});

test('a huge rejected document lists at most MAX_ERRORS errors', () => {
  const base = samples.identity.bases['identity-ar-web-app.json'];
  const r = validate.check('identity', { ...base, leaveToAI: Array.from({ length: 100000 }, (_, i) => i) });
  assert.equal(r.valid, false);
  assert.equal(r.errors.length, validate.MAX_ERRORS);
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  assert.equal(validate.check('template', { ...samples.template.bases['button-solid.json'], tokens: revoked.proxy }).valid, false, 'revoked Proxy does not throw');
});
