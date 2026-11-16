'use strict';
// Task 2.3 (R-032): both interface languages have the same keys, and no visible text is written in the page code.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ar = require('../picker/i18n/ar.js');
const en = require('../picker/i18n/en.js');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const placeholders = (s) => (s.match(/\{[a-zA-Z]+\}/g) || []).sort();

const HTML = read('picker/index.html');
// Interface code that shows text. preview.js is left out on purpose: its scene is sample content of the
// identity being previewed, whose language gets its own key in task 2.6 (picker/scenes/).
const UI = [
  'picker/js/ui/i18n.js',
  'picker/js/ui/app.js',
  'picker/js/ui/export.js',
  'picker/js/ui/state.js',
  'picker/js/ui/storage.js',
  'picker/js/ui/identities.js',
  'picker/js/ui/library.js',
  'picker/js/ui/gallery.js',
  'picker/js/ui/elements/numeric.js',
  'picker/js/ui/elements/colors.js',
  'picker/js/ui/elements/fonts.js',
  'picker/js/ui/elements/icons.js'
];

test('Arabic and English have the same keys, non-empty texts and the same placeholders', () => {
  assert.deepEqual(Object.keys(en), Object.keys(ar), 'same keys in the same order');
  for (const key of Object.keys(ar)) {
    assert.equal(typeof ar[key], 'string', key);
    assert.equal(typeof en[key], 'string', key);
    assert.ok(ar[key].trim().length > 0 && en[key].trim().length > 0, `${key} is empty`);
    assert.deepEqual(placeholders(en[key]), placeholders(ar[key]), `${key} placeholders`);
  }
});

test('each language reads as itself', () => {
  const brandOnly = new Set(['lang.switchTo', 'radius.value', 'export.listSeparator', 'gallery.px', 'gallery.number']);
  // Font specimens are the same in both interfaces: an Arabic and a Latin sample of each font.
  for (const k of ['fonts.specimen.ar', 'fonts.specimen.latin']) assert.equal(ar[k], en[k], k);
  brandOnly.add('fonts.specimen.ar');
  brandOnly.add('fonts.specimen.latin');
  for (const key of Object.keys(ar)) {
    if (brandOnly.has(key)) continue;
    assert.match(ar[key], /[؀-ۿ]/, `ar ${key} has no Arabic`);
    assert.doesNotMatch(en[key], /[؀-ۿ]/, `en ${key} has Arabic`);
  }
  // The language key names the other language in that language.
  assert.equal(ar['lang.switchTo'], 'English');
  assert.equal(en['lang.switchTo'], 'العربية');
  assert.match(ar['notice.fonts'], /Google Fonts/);
  assert.match(en['notice.fonts'], /Google Fonts/);
});

test('every key the page uses exists, and every key is used', () => {
  const used = new Set();
  for (const m of HTML.matchAll(/data-i18n="([^"]+)"/g)) used.add(m[1]);
  for (const m of HTML.matchAll(/data-i18n-attr="([^"]+)"/g))
    m[1].split(';').forEach((p) => used.add(p.split(':')[1].trim()));
  for (const file of UI) {
    const src = read(file);
    for (const m of src.matchAll(/\bt\('([a-zA-Z.]*[a-zA-Z])'(?! \+)/g)) used.add(m[1]);
    for (const m of src.matchAll(/key: '([a-zA-Z.]+)'/g)) used.add(m[1]);
    for (const m of src.matchAll(/data-i18n', '([a-zA-Z.]+)'/g)) used.add(m[1]);
    // state.js shows panel messages through note('key', params).
    for (const m of src.matchAll(/\bnote\('([a-zA-Z.]+)'/g)) used.add(m[1]);
    // export.js keeps messages as ['name', params] parts, read as 'export.' + name.
    if (file.endsWith('export.js'))
      for (const m of src.matchAll(/\[\['?([a-zA-Z]+)'|\['([a-zA-Z]+)'(?:,|\])/g)) used.add('export.' + (m[1] || m[2]));
  }
  used.add('app.title'); // set as the document title by i18n.js
  const missing = [...used].filter((k) => !(k in ar));
  assert.deepEqual(missing, [], 'keys used but not defined');
  const unused = Object.keys(ar).filter((k) => !used.has(k));
  assert.deepEqual(unused, [], 'keys defined but never used');
});

test('no visible text is written in the page code', () => {
  // index.html: once scripts, styles and comments are gone, no text is left between tags.
  const body = HTML.slice(HTML.indexOf('<body'))
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  const text = body.replace(/<[^>]+>/g, ' ').trim();
  assert.equal(text, '', `text in index.html: ${text.slice(0, 80)}`);
  assert.doesNotMatch(HTML, /\s(aria-label|title|placeholder|alt)="[^"]/, 'attributes with text in index.html');
  assert.match(HTML, /<title><\/title>/);
  // The interface scripts hold no Arabic at all and never assign literal text.
  for (const file of UI) {
    const src = read(file);
    assert.doesNotMatch(src, /[؀-ۿ]/, `${file} contains Arabic text`);
    // Every text the scripts write comes from t() / text() (the dictionaries), is cleared, or is a proper
    // name (font family) or data (the export JSON) that is the same in both languages.
    const allowed =
      /^(t\(|text\(|''$|parts \? text\(parts\) : ''$|key \? t\(key, params\) : ''$|families\(f\)\.join\(' \+ '\)$|item\.name \|\| t\(|item\.status === 'ok' \? formatTime\(item\.updatedAt\) : statusText\(item\.status\)$|ctx\.t\(|text$|summary\(entry\)$|def\.unit === 'px' \? t\(|JSON\.stringify\(bundle\))/;
    // A small el(tag, class, text) helper writes library content; it must never get literal text.
    assert.doesNotMatch(src, /\bel\('[a-z0-9]+', [^,)]+, ['"][^'"]/, `${file} passes literal text to el()`);
    for (const m of src.matchAll(/textContent\s*=\s*([^;]+);/g)) {
      assert.match(m[1].trim(), allowed, `${file} writes text that is not from the dictionaries: ${m[1].trim()}`);
    }
    assert.doesNotMatch(src, /innerHTML/, `${file} writes HTML`);
  }
});
