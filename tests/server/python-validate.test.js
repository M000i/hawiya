'use strict';

/*
 * Task 1.13: the Python identity checker (scripts/serve.py, check_document_text) must accept and reject exactly what
 * the JavaScript checker (picker/js/core/validate.js, task 1.7) does, and report errors at the same places.
 * Every document is sent as JSON text through tests/server/python_validate_test.py and compared one by one.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const validate = require('../../picker/js/core/validate.js');
const { applyCase } = require('../fixtures/mutate.js');
const { rng, mutate } = require('../fixtures/fuzz.js');

const PYTHON = process.env.HAWIYA_PYTHON || 'python3';
const HARNESS = path.join(__dirname, 'python_validate_test.py');
const FIX = path.join(__dirname, '..', 'fixtures');
const NAMES = ['identity', 'template', 'session'];
const probe = spawnSync(PYTHON, ['-c', 'import sys; print("%d.%d" % sys.version_info[:2])'], { encoding: 'utf8' });

function runPython(cases) {
  const input = cases.map((c) => JSON.stringify({ schema: c.schema, text: c.text })).join('\n') + '\n';
  const r = spawnSync(PYTHON, ['-I', HARNESS], { input, encoding: 'utf8', maxBuffer: 1 << 30 });
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split('\n');
  assert.equal(lines.length, cases.length, 'one answer per document');
  return lines.map((l) => JSON.parse(l));
}

const sig = (errors) => errors.map(([p, k]) => `${p} ${k}`).sort();

function compare(cases, label) {
  const py = runPython(cases);
  let accepted = 0;
  cases.forEach((c, i) => {
    const js = validate.checkText(c.schema, c.text);
    const where = `${label} #${i} (${c.why || c.schema}): ${c.text.slice(0, 160)}`;
    assert.equal(py[i].valid, js.valid, `verdict differs (Python ${py[i].valid}, JS ${js.valid}) ${where}\nJS: ${JSON.stringify(js.errors.slice(0, 5))}\nPY: ${JSON.stringify(py[i].errors.slice(0, 5))}`);
    const jsSig = sig(js.errors.map((e) => [e.instancePath, e.keyword]));
    // Only allowed difference: text nested so deep that Python's parser gives up (RecursionError) is refused as a whole
    // ('' place), while JavaScript parses it and refuses it at the 200th level. Same verdict, different place.
    const deepParseLimit = py[i].errors.length === 1 && py[i].errors[0][0] === '' && py[i].errors[0][1] === 'json' && js.errors.length === 1 && js.errors[0].keyword === 'json' && /deeper than/.test(js.errors[0].message);
    if (!deepParseLimit) assert.deepEqual(sig(py[i].errors), jsSig, `error places differ ${where}`);
    if (js.valid) accepted++;
  });
  return accepted;
}

const read = (p) => fs.readFileSync(p, 'utf8');
const pretty = (doc) => JSON.stringify(doc, null, 2) + '\n';

function sharedSamples() {
  const out = [];
  for (const schema of NAMES) {
    const dir = path.join(FIX, schema);
    const files = fs.readdirSync(path.join(dir, 'valid')).filter((f) => f.endsWith('.json')).sort();
    const bases = {};
    for (const f of files) {
      const text = read(path.join(dir, 'valid', f));
      bases[f] = JSON.parse(text);
      out.push({ schema, text, why: f });
    }
    for (const c of JSON.parse(read(path.join(dir, 'invalid.json'))).cases) out.push({ schema, text: pretty(applyCase(bases[c.base], c)), why: c.reason });
    if (schema === 'identity') {
      for (const c of JSON.parse(read(path.join(dir, 'raw.json'))).cases) out.push({ schema, text: read(path.join(dir, 'valid', c.base)).replace(c.find, c.with), why: c.reason });
    }
  }
  return out;
}

// Places where Python and JavaScript differ unless the port is careful.
function edgeCases() {
  const id = read(path.join(FIX, 'identity', 'valid', 'identity-ar-web-app.json'));
  const tpl = read(path.join(FIX, 'template', 'valid', 'button-solid.json'));
  const tplDoc = JSON.parse(tpl);
  const ses = (body) => JSON.stringify({ type: 'landing', language: 'ar', tags: ['minimal'], ...body });
  const idName = (raw) => id.replace(/"name": "[^"]*"/, '"name": ' + raw);
  const tplWith = (patch) => pretty({ ...tplDoc, ...patch });
  const out = [];
  const add = (schema, text, why) => out.push({ schema, text, why });
  // "$" and a final newline
  add('identity', idName('"Calm\\n"'), 'name ending in a newline');
  add('identity', id.replace('"library": "', '"library": "x\\n'), 'id ending in a newline (escaped)');
  add('session', ses({ brandColors: ['#123456\n'] }), 'hex ending in a newline');
  add('template', tplWith({ id: 'button-solid\n' }), 'template id + newline');
  // \d and \s
  add('template', tplWith({ status: { state: 'reviewed', reviewedAt: '٢٠٢٦-01-01' } }), 'Arabic-Indic digits in a date');
  add('template', tplWith({ status: { state: 'reviewed', reviewedAt: '2026-01-01' } }), 'ASCII date');
  for (const sp of [' ', '﻿', '\u001c', '\u0085', '᠎', ' ', '　', '​']) {
    add('template', tplWith({ source: { ...tplDoc.source, url: 'https://a' + sp + 'b' } }), `url with U+${sp.charCodeAt(0).toString(16)}`);
  }
  // booleans versus numbers, numbers as doubles
  for (const v of ['true', 'false', '1.0', '"1"', '1e0', '-0', '0.99999999999999999', '1.0000000000000001', '1e400', '-1e400', '1' + '0'.repeat(400)]) {
    add('identity', id.replace('"schemaVersion": 1', '"schemaVersion": ' + v), 'schemaVersion ' + v);
  }
  add('identity', id.replace('"unit": 4', '"unit": 4.0000000000000001'), 'integer within double rounding');
  add('identity', id.replace('"unit": 4', '"unit": 9007199254740993'), 'integer above 2^53');
  add('session', ses({ tags: ['minimal', 'minimal'] }), 'duplicate tags');
  add('session', '{"type":"landing","language":"ar","tags":["minimal"],"brandColors":[1,1.0,true]}', 'mixed types, simple item type');
  add('session', '{"type":"landing","language":"ar","tags":[1,1.0]}', 'numbers 1 and 1.0 are equal');
  add('session', '{"type":"landing","language":"ar","tags":[true,1]}', 'true and 1 are different');
  add('session', '{"type":"landing","language":"ar","tags":[0,-0]}', '0 and -0 are equal');
  add('session', '{"type":"landing","language":"ar","tags":[0,-0.0]}', '0 and -0.0 are equal');
  add('session', '{"type":"landing","language":"ar","tags":[9007199254740993,9007199254740992]}', 'integers that round to the same double are equal');
  add('session', '{"type":"landing","language":"ar","tags":["minimal"],"brandColors":[9007199254740993,9007199254740992]}', 'same, with a simple item type');
  add('session', '{"type":"landing","language":"ar","tags":[{"a":1,"b":2},{"b":2,"a":1}]}', 'key order does not matter');
  add('template', tplWith({ tokens: { a: 1e300, b: [9007199254740993, 9007199254740992] } }), 'open place with big numbers');
  add('template', tpl.replace('"tokens": {', '"tokens": {"x": 1e400,'), 'infinity in an open place');
  // length in characters, lone surrogates, control characters
  add('identity', idName(JSON.stringify('\u{1F3A8}'.repeat(80))), '80 emoji');
  add('identity', idName(JSON.stringify('\u{1F3A8}'.repeat(81))), '81 emoji');
  add('identity', idName('"a\\ud800b"'), 'lone high surrogate');
  add('identity', idName('"\\udc00\\ud800"'), 'reversed pair');
  add('identity', idName('"\\ud83c\\udfa8"'), 'escaped pair');
  add('identity', idName('"\\u0661\\u0662"'), 'Arabic digits name');
  add('identity', idName('" a "'), 'spaces around');
  add('identity', idName('"\\u3000\\u00a0x"'), 'wide spaces then a letter');
  add('identity', idName('"\\u3000"'), 'only a wide space');
  // keys
  add('identity', id.replace('"selections": {', '"selections": {"10": {"template":"x"}, "2": {"template":"y"}, "colors-x": {"template":"z"},'), 'integer-like keys');
  add('identity', id.replace('"schemaVersion": 1,', '"schemaVersion": 1, "__proto__": 1,'), '__proto__ key');
  add('identity', id.replace('"schemaVersion": 1,', '"schemaVersion": 1, "constructor": {},'), 'constructor key');
  add('identity', id.replace('"schemaVersion": 1,', '"schemaVersion": 1, "schemaVersion": 2,'), 'duplicate key at the top');
  add('identity', id.replace('"primary": "', '"primary": "#000000", "primary": "'), 'duplicate key nested');
  add('template', '{"a":[1,{"b":2},{"c":3,"c":4}]}', 'duplicate key inside an array');
  // depth and text that is not JSON
  add('template', tpl.replace('"tokens": {', '"tokens": {"deep": ' + '['.repeat(250) + ']'.repeat(250) + ','), 'nested 250 deep');
  add('template', tpl.replace('"tokens": {', '"tokens": {"deep": ' + '['.repeat(5000) + ']'.repeat(5000) + ','), 'nested 5000 deep');
  // very long digit strings: keys and numbers (Python's int() is slow or refuses them; float() is used instead)
  add('session', '{"' + '1'.repeat(4301) + '":1}', 'key of 4301 digits');
  add('template', tpl.replace('"tokens": {', '"tokens": {"' + '7'.repeat(5000) + '": 1,'), 'open place, key of 5000 digits');
  add('identity', id.replace('"schemaVersion": 1', '"schemaVersion": 1' + '0'.repeat(5000)), 'integer of 5001 digits');
  add('identity', id.replace('"schemaVersion": 1', '"schemaVersion": 1' + '0'.repeat(300)), 'integer of 301 digits (finite)');
  add('session', '{"' + '4294967294' + '":1,"' + '4294967295' + '":2,"01":3,"0":4}', 'index-like key limits');
  // raw lone surrogates next to escaped ones (JavaScript joins them into one character)
  add('identity', idName('"a\ud83c\\udfa8"'.replace('\\ud83c', '\ud83c')), 'raw high + escaped low surrogate');
  add('session', '{"type":"landing","language":"ar","tags":["minimal"],"\ud83c\\udfa8":1,"\u{1F3A8}":2}'.replace('\\ud83c', '\ud83c').replace('\\u{1F3A8}', '\u{1F3A8}'), 'duplicate key: half-escaped pair vs raw emoji');
  for (const t of ['', '{', '{"a":1,}', 'NaN', "{'a':1}", '﻿{}', '[]', 'null', '0', '"x"', '{"type":"landing" "language":"ar"}', '{"a":01}', '{"a":.5}', '{"a":1.}', '{"a":"\t"}']) add('session', t, 'text: ' + JSON.stringify(t));
  return out;
}

function variations(seed, perBase) {
  const r = rng(seed);
  const out = [];
  for (const schema of NAMES) {
    const dir = path.join(FIX, schema, 'valid');
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
      const base = JSON.parse(read(path.join(dir, f)));
      for (let i = 0; i < perBase; i++) {
        let doc = structuredClone(base);
        const times = 1 + Math.floor(r() * 3);
        for (let j = 0; j < times; j++) doc = mutate(r, doc);
        out.push({ schema, text: JSON.stringify(doc), why: `${f} variation ${i}` });
      }
    }
  }
  return out;
}

if (probe.status !== 0) {
  test('[python checker] python3 not found: parity checks skipped', { skip: true }, () => {});
} else {
  const v = probe.stdout.trim();

  test(`[python ${v} checker] self-test`, () => {
    const r = spawnSync(PYTHON, ['-I', HARNESS, '--self-test'], { encoding: 'utf8' });
    assert.equal(r.stdout.trim(), 'ok', r.stderr);
  });

  test(`[python ${v} checker] shared samples: same verdict and same error places as the JavaScript checker`, (t) => {
    const cases = sharedSamples();
    const accepted = compare(cases, 'shared');
    t.diagnostic(`${cases.length} shared samples (${accepted} accepted), Python and JavaScript agree on every one`);
  });

  test(`[python ${v} checker] edge cases where the two languages differ by default`, (t) => {
    const cases = edgeCases();
    const accepted = compare(cases, 'edge');
    t.diagnostic(`${cases.length} edge cases (${accepted} accepted), Python and JavaScript agree on every one`);
  });

  test(`[python ${v} checker] long digit strings take linear time and never crash`, () => {
    const big = '9'.repeat(1500000);
    const cases = [
      { schema: 'session', text: '{"' + big + '":1}', why: '1.5M-digit key' },
      { schema: 'session', text: '{"type":"landing","language":"ar","tags":[' + big + ']}', why: '1.5M-digit number' }
    ];
    const t0 = Date.now();
    compare(cases, 'long digits');
    assert.ok(Date.now() - t0 < 5000, `took ${Date.now() - t0} ms`);
  });

  test(`[python ${v} checker] random variations (seeded): same verdict and same error places`, (t) => {
    const cases = variations(1913, 1000);
    const accepted = compare(cases, 'variation');
    assert.ok(accepted > 100 && cases.length - accepted > 5000, `${accepted} of ${cases.length}`);
    t.diagnostic(`${cases.length} variations (${accepted} accepted), Python and JavaScript agree on every one`);
  });
}
