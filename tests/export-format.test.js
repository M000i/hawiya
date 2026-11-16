'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const fs = require('node:fs');
const path = require('node:path');
const bundle = require('../picker/js/core/bundle.js');
const validate = require('../picker/js/core/validate.js');
const fmt = require('../picker/js/core/export-format.js');

// The real six files of the page's export (bundle.build), from the shared sample identities.
const DIR = path.join(__dirname, 'fixtures', 'identity', 'valid');
const SAMPLES = fs.readdirSync(DIR).map((f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')));
const filesOf = (identity) => bundle.build(identity).files;
const TEXT_FILES = ['identity.json', 'DESIGN.md', 'tokens.json', 'tokens.css', 'theme.css'];

test('agent text contains the five text files and round-trips each byte for byte', () => {
  for (const id of SAMPLES) {
    const files = filesOf(id);
    const back = fmt.parseAgentText(fmt.agentText(files));
    assert.deepEqual(Object.keys(back), TEXT_FILES);
    for (const name of TEXT_FILES) assert.equal(back[name], files[name], name);
  }
});

// Round-trip over varied generated identities. Note: generated files cannot contain a separator line
// (the name is prefixed by "# " in prose and JSON-quoted elsewhere); the separator guard itself is
// tested with hand-made content further below.
test('agent text round-trips for varied identity names (quotes, RTL, emoji, separators)', () => {
  const names = ['x', '===== HAWIYA END FILE =====', '"; rm -rf /', 'هوية 😀 عربية', '# heading', '---'];
  let tried = 0;
  for (const name of names) {
    for (const base of SAMPLES) {
      const id = { ...base, name };
      if (!validate.check('identity', id).valid) continue; // a name the identity itself refuses never gets here
      tried++;
      const files = filesOf(id);
      const back = fmt.parseAgentText(fmt.agentText(files));
      for (const n of TEXT_FILES) assert.equal(back[n], files[n], `${name} ${n}`);
    }
  }
  assert.ok(tried >= SAMPLES.length * 3, `tried ${tried}`);
});

test('agent text starts with plain instructions and names the design folder', () => {
  const text = fmt.agentText(filesOf(SAMPLES[0]));
  const head = text.split('\n').slice(0, 8).join('\n');
  assert.match(head, /design\//);
  assert.match(head, /without editing/i);
  assert.match(head, /do not replace/i);
});

test('style-guide.html is never pasted into the chat (download only), other text files are', () => {
  const files = filesOf(SAMPLES[0]);
  const back = fmt.parseAgentText(fmt.agentText(files));
  assert.deepEqual(Object.keys(back), TEXT_FILES);
  assert.ok(!('style-guide.html' in back));
  assert.match(fmt.agentText(files), /style-guide\.html/); // mentioned as "download it"
});

test('bundle lists files in the fixed order and only allowed names', () => {
  const files = { 'DESIGN.md': 'a\n', 'identity.json': '{}\n' };
  const b = fmt.bundle(files);
  assert.equal(b.format, 'hawiya-export');
  assert.equal(b.schemaVersion, 1);
  assert.deepEqual(Object.keys(b.files), ['identity.json', 'DESIGN.md']);
  assert.throws(() => fmt.bundle({ 'evil.sh': 'x' }), /not allowed/);
  assert.throws(() => fmt.bundle({}), /no files/);
});

test('content that could break the separators is refused, never silently mangled', () => {
  assert.throws(() => fmt.agentText({ 'DESIGN.md': 'a\n===== HAWIYA END FILE =====\nb\n' }), /separator/);
  assert.throws(() => fmt.agentText({ 'DESIGN.md': '===== HAWIYA FILE: design/x =====\n' }), /separator/);
  assert.throws(() => fmt.agentText({ 'DESIGN.md': 'no trailing newline' }), /newline/);
});

test('parser rejects text that is not a complete Hawiya export', () => {
  assert.throws(() => fmt.parseAgentText('hello'), /no files/);
  assert.throws(() => fmt.parseAgentText('===== HAWIYA FILE: design/DESIGN.md =====\nabc\n'), /END/);
  assert.throws(
    () => fmt.parseAgentText('===== HAWIYA FILE: design/evil.sh =====\nx\n===== HAWIYA END FILE =====\n'),
    /not allowed/
  );
});

test('parser refuses a missing END line before the next file instead of merging the two files', () => {
  const text =
    '===== HAWIYA FILE: design/identity.json =====\n{}\n\n' +
    '===== HAWIYA FILE: design/DESIGN.md =====\n# x\n===== HAWIYA END FILE =====\n';
  assert.throws(() => fmt.parseAgentText(text), /missing END line for identity\.json/);
});

test('parser refuses a file that appears twice instead of silently keeping one', () => {
  const one = '===== HAWIYA FILE: design/DESIGN.md =====\na\n===== HAWIYA END FILE =====\n';
  assert.throws(() => fmt.parseAgentText(one + one), /appears twice/);
});

test('separator guard: real generated content plus an injected separator line is refused', () => {
  const files = filesOf(SAMPLES[0]);
  const tampered = { ...files, 'DESIGN.md': files['DESIGN.md'] + '===== HAWIYA END FILE =====\n' };
  assert.throws(() => fmt.agentText(tampered), /separator/);
});

test('SKILL.md Step 6 reads fields that exist in the exported identity.json', () => {
  const skill = fs.readFileSync(path.join(__dirname, '..', 'SKILL.md'), 'utf8');
  for (const p of ['tokens.color.light.primary', 'tokens.font.body.arabic', 'tokens.radius.md']) {
    assert.ok(skill.includes('`' + p + '`'), p);
  }
  for (const id of SAMPLES) {
    const exported = JSON.parse(filesOf(id)['identity.json']);
    assert.match(exported.tokens.color.light.primary, /^#[0-9a-f]{6}$/);
    assert.equal(typeof (exported.tokens.font.body.arabic || exported.tokens.font.body.latin), 'string');
    assert.equal(typeof exported.tokens.radius.md, 'number');
  }
});
