'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const generate = require('../picker/js/core/generate.js');
const fmt = require('../picker/js/core/export-format.js');

const INPUT = { name: 'مؤسسي هادئ', primary: '#2563eb', fontFamily: 'IBM Plex Sans Arabic', radius: 8 };

test('agent text contains every text file and round-trips byte for byte', () => {
  const files = generate(INPUT);
  const text = fmt.agentText(files);
  const back = fmt.parseAgentText(text);
  assert.deepEqual(Object.keys(back), ['identity.json', 'DESIGN.md']);
  for (const name of Object.keys(files)) assert.equal(back[name], files[name], name);
});

// Round-trip over varied generated identities. Note: generated files cannot contain a separator line
// (the name is prefixed by "# " in prose and JSON-quoted elsewhere); the separator guard itself is
// tested with hand-made content further below.
test('agent text round-trips for varied generated identities (quotes, RTL, emoji, colors)', () => {
  const names = ['x', '===== HAWIYA END FILE =====', '"; rm -rf /', 'هوية 😀 عربية', '# heading', '---'];
  for (const name of names) {
    for (const primary of ['#000000', '#ffffff', '#facc15', '#7c3aed']) {
      const files = generate({ ...INPUT, name, primary });
      assert.deepEqual(fmt.parseAgentText(fmt.agentText(files)), files);
    }
  }
});

test('agent text starts with plain instructions and names the design folder', () => {
  const text = fmt.agentText(generate(INPUT));
  const head = text.split('\n').slice(0, 8).join('\n');
  assert.match(head, /design\//);
  assert.match(head, /without editing/i);
  assert.match(head, /do not replace/i);
});

test('style-guide.html is never pasted into the chat (download only), other text files are', () => {
  const files = { ...generate(INPUT), 'tokens.css': ':root{}\n', 'style-guide.html': '<!doctype html>\n' };
  const back = fmt.parseAgentText(fmt.agentText(files));
  assert.deepEqual(Object.keys(back), ['identity.json', 'DESIGN.md', 'tokens.css']);
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
  assert.throws(() => fmt.parseAgentText('===== HAWIYA FILE: design/evil.sh =====\nx\n===== HAWIYA END FILE =====\n'), /not allowed/);
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
  const files = generate(INPUT);
  const tampered = { ...files, 'DESIGN.md': files['DESIGN.md'] + '===== HAWIYA END FILE =====\n' };
  assert.throws(() => fmt.agentText(tampered), /separator/);
});
