'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Ajv2020 = require('ajv/dist/2020');
const { applyCase } = require('./fixtures/mutate.js');

const ROOT = path.join(__dirname, '..');
const SCHEMAS = ['template', 'identity', 'session'];

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function compile(name) {
  // strict mode on, except: strictRequired (the if/then rules "composite needs recipe" / "reviewed needs a date"
  // require properties defined at the parent level) and union types (override values: number|boolean|string).
  const ajv = new Ajv2020({ strict: true, strictRequired: false, allowUnionTypes: true, allErrors: true });
  return ajv.compile(loadJson(path.join(ROOT, 'schema', `${name}.schema.json`)));
}

for (const name of SCHEMAS) {
  const validate = compile(name);
  const dir = path.join(ROOT, 'tests', 'fixtures', name);
  const validFiles = fs.readdirSync(path.join(dir, 'valid')).filter((f) => f.endsWith('.json')).sort();
  const bases = Object.fromEntries(validFiles.map((f) => [f, loadJson(path.join(dir, 'valid', f))]));
  const { cases } = loadJson(path.join(dir, 'invalid.json'));

  test(`[${name}] every valid sample is accepted (${validFiles.length})`, (t) => {
    assert.ok(validFiles.length >= 1);
    for (const f of validFiles) {
      const ok = validate(bases[f]);
      assert.ok(ok, `${f} rejected: ${JSON.stringify(validate.errors)}`);
    }
    t.diagnostic(`${name}: ${validFiles.length} valid samples accepted`);
  });

  test(`[${name}] every invalid sample is rejected with a reason (${cases.length})`, (t) => {
    assert.ok(cases.length >= 10, 'too few invalid cases');
    const reasons = new Set();
    for (const c of cases) {
      assert.ok(c.reason && typeof c.reason === 'string', 'every case needs a reason');
      assert.ok(!reasons.has(c.reason), `duplicate reason: ${c.reason}`);
      reasons.add(c.reason);
      assert.ok(bases[c.base], `unknown base ${c.base} for "${c.reason}"`);
      const doc = applyCase(bases[c.base], c);
      assert.notDeepEqual(doc, bases[c.base], `case does not change its base: ${c.reason}`);
      const ok = validate(doc);
      assert.equal(ok, false, `accepted but should be rejected: ${c.reason}`);
      assert.ok(validate.errors && validate.errors.length > 0, `no error reported: ${c.reason}`);
      // Single fault: every error is reported at the case's stated place ('if' only wraps then/else errors).
      assert.equal(typeof c.at, 'string', `case has no 'at': ${c.reason}`);
      const places = [...new Set(validate.errors.filter((e) => e.keyword !== 'if').map((e) => e.instancePath))];
      assert.deepEqual(places, [c.at], `"${c.reason}" rejected at ${JSON.stringify(places)}, expected ${c.at || '(root)'}`);
    }
    t.diagnostic(`${name}: ${cases.length} invalid samples rejected, each at its stated place`);
  });
}

test('[identity] raw-text cases (NaN, Infinity, 4.0, __proto__, duplicate keys, 80 emoji)', (t) => {
  const validate = compile('identity');
  const dir = path.join(ROOT, 'tests', 'fixtures', 'identity');
  const { cases } = loadJson(path.join(dir, 'raw.json'));
  for (const c of cases) {
    const text = fs.readFileSync(path.join(dir, 'valid', c.base), 'utf8');
    assert.equal(text.split(c.find).length, 2, `"find" must occur exactly once: ${c.reason}`);
    const raw = text.replace(c.find, c.with);
    let verdict;
    try {
      verdict = validate(JSON.parse(raw));
    } catch {
      verdict = false; // not JSON at all
    }
    assert.equal(verdict, c.valid, `${c.reason}: expected ${c.valid ? 'accepted' : 'rejected'}`);
  }
  t.diagnostic(`identity raw: ${cases.length} cases match their expected verdict`);
});

test('[template] every R-060 record field exists in the schema', () => {
  const s = loadJson(path.join(ROOT, 'schema', 'template.schema.json'));
  const p = s.properties;
  // R-060: id, element, kind, name ar+en, tags, platforms, Design Tokens values, non-numeric extras,
  // render recipe (HTML+CSS), contrast requirement + reduced-motion alternative, RTL support,
  // source + license, status (draft | reviewed).
  for (const k of ['id', 'element', 'kind', 'name', 'tags', 'platforms', 'tokens', 'extras', 'recipe', 'a11y', 'rtl', 'source', 'status']) {
    assert.ok(p[k], `missing field ${k}`);
  }
  assert.deepEqual(p.name.required.sort(), ['ar', 'en']);
  assert.deepEqual(p.recipe.required.sort(), ['css', 'html']);
  assert.deepEqual(p.a11y.required.sort(), ['contrast', 'reducedMotion']);
  assert.deepEqual(p.source.required.sort(), ['license', 'name', 'url']);
  assert.deepEqual(p.status.properties.state.enum.sort(), ['draft', 'reviewed']);
  assert.deepEqual(p.metrics.required.sort(), ['density', 'intensity', 'roundness']);
});

test('[template] the 16 fixed tags and 11 template elements are the agreed lists', () => {
  const s = loadJson(path.join(ROOT, 'schema', 'template.schema.json'));
  assert.deepEqual(s.$defs.tag.enum, [
    'minimal', 'corporate', 'editorial', 'playful', 'luxury', 'glass', 'brutalist', 'neumorphic',
    'retro', 'material', 'cupertino', 'fluent', 'technical', 'data-dense', 'vivid', 'soft'
  ]);
  assert.deepEqual(s.$defs.element.enum, [
    'colors', 'modes', 'fonts', 'type-scale', 'radius', 'shadows', 'icons', 'buttons', 'cards', 'spacing', 'direction'
  ]);
});

test('[cross-schema] tags and element lists are identical in all schemas, and SKILL.md uses the same tags', () => {
  const t = loadJson(path.join(ROOT, 'schema', 'template.schema.json')).$defs;
  const i = loadJson(path.join(ROOT, 'schema', 'identity.schema.json')).$defs;
  const s = loadJson(path.join(ROOT, 'schema', 'session.schema.json')).$defs;
  assert.deepEqual(i.element.enum, t.element.enum);
  assert.deepEqual(s.element.enum, t.element.enum);
  assert.deepEqual(s.tag.enum, t.tag.enum);
  const skill = fs.readFileSync(path.join(ROOT, 'SKILL.md'), 'utf8');
  const listed = skill.match(/from: ([a-z,\s-]+)\./)[1].split(',').map((x) => x.trim());
  assert.deepEqual(listed, t.tag.enum);
});

test('[session] the example in SKILL.md Step 3 is a valid session file', () => {
  const skill = fs.readFileSync(path.join(ROOT, 'SKILL.md'), 'utf8');
  const block = skill.split('## Step 3')[1].match(/```json\n([\s\S]*?)\n```/)[1];
  const validate = compile('session');
  assert.ok(validate(JSON.parse(block)), JSON.stringify(validate.errors));
});

test('[mutate] the fixture mutation helper refuses paths that do not exist', () => {
  assert.throws(() => applyCase({ a: { b: 1 } }, { set: { 'a.x.y': 1 } }), /path not found/);
  assert.throws(() => applyCase({ a: { b: 1 } }, { delete: ['a.c'] }), /path not found/);
  assert.deepEqual(applyCase({ a: [1, 2, 3] }, { delete: ['a.1'] }), { a: [1, 3] });
});
