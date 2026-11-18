'use strict';

/*
 * Golden tests: the approved examples in spec.md section 12, listed in golden.md.
 * Each test name starts with its id (G-01 ...) so `npm run test:golden` prints them one by one.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const contrast = require('../picker/js/core/contrast.js');
const color = require('../picker/js/core/color.js');
const ramp = require('../picker/js/core/ramp.js');
const modes = require('../picker/js/core/modes.js');
const scale = require('../picker/js/core/scale.js');

test('G-04 type scale: base 16, ratio 1.25, five steps → 16, 20, 25, 31.25, 39.06', () => {
  assert.deepEqual(scale.generate({ base: 16, ratio: 1.25, steps: 5 }), [16, 20, 25, 31.25, 39.06]);
});

// Task-level golden (tasks.md 1.5).
test('T-1.5 modes: #3B82F6 → main text on background ≥ 4.5:1 in light and dark; primary button text ≥ 4.5:1', () => {
  const m = modes.derive('#3B82F6');
  for (const mode of ['light', 'dark']) {
    const s = m[mode];
    assert.ok(contrast.ratio(s.onSurface, s.background) >= 4.5, `${mode}: text ${s.onSurface} on ${s.background}`);
    assert.ok(contrast.ratio(s.onPrimary, s.primary) >= 4.5, `${mode}: button text ${s.onPrimary} on ${s.primary}`);
  }
});

// Task-level golden (tasks.md 1.4), not a spec.md G-id.
test('T-1.4 ramp: #3B82F6 → 11 steps, one of them #3B82F6, lightness descending, same twice', () => {
  const a = ramp.generate('#3B82F6');
  const b = ramp.generate('#3B82F6');
  assert.equal(a.steps.length, 11);
  assert.ok(a.steps.map((h) => h.toLowerCase()).includes('#3b82f6'), JSON.stringify(a.steps));
  const L = a.steps.map((h) => color.toOklch(h).L);
  for (let i = 1; i < L.length; i++) assert.ok(L[i] < L[i - 1], `step ${i} not darker than step ${i - 1}`);
  assert.deepEqual(b, a);
});

// Golden values are given to 3 decimals (L, C) and 1 decimal (H).
const r3 = (x) => Math.round(x * 1000) / 1000;
const r1 = (x) => Math.round(x * 10) / 10;

test('G-05 OKLCH: #FFFFFF → lightness 1, chroma 0', () => {
  const o = color.toOklch('#FFFFFF');
  assert.equal(r3(o.L), 1);
  assert.equal(r3(o.C), 0);
});

test('G-06 OKLCH: #FF0000 → lightness 0.628, chroma 0.258, hue 29.2', () => {
  const o = color.toOklch('#FF0000');
  assert.equal(r3(o.L), 0.628);
  assert.equal(r3(o.C), 0.258);
  assert.equal(r1(o.H), 29.2);
});

test('G-01 contrast: #000000 on #FFFFFF = 21:1', () => {
  const r = contrast.evaluate('#000000', '#FFFFFF');
  assert.equal(r.rounded, 21);
  assert.equal(r.ratio, 21);
  assert.equal(r.AA, true);
  assert.equal(r.AAA, true);
});

test('G-02 contrast: #767676 on #FFFFFF = 4.54:1, passes AA', () => {
  const r = contrast.evaluate('#767676', '#FFFFFF');
  assert.equal(r.rounded, 4.54);
  assert.equal(r.AA, true);
  assert.equal(r.AAA, false);
});

test('G-03 contrast: #777777 on #FFFFFF = 4.48:1, fails AA', () => {
  const r = contrast.evaluate('#777777', '#FFFFFF');
  assert.equal(r.rounded, 4.48);
  assert.equal(r.AA, false);
  assert.equal(r.AAA, false);
});

test('T-2.4 identity: primary #3B82F6 with a type scale of base 16 and ratio 1.25 → #3B82F6 in the primary ramp; sizes 16, 20, 25, 31.25, 39.06', () => {
  const resolve = require('../picker/js/core/resolve.js');
  const validate = require('../picker/js/core/validate.js');
  const build = require('../tools/build.js');
  const path = require('node:path');
  const data = build.select(build.load(path.join(__dirname, '..', 'library'))).data;
  const calm = data.identities.find((i) => i.id === 'calm-corporate');
  const selections = {};
  for (const [element, template] of Object.entries(calm.templates)) selections[element] = { template };
  selections.colors.overrides = { primary: '#3B82F6' };
  const identity = resolve.resolve({ name: 'Golden', selections }, data);

  assert.equal(validate.check('identity', identity).valid, true);
  assert.ok(identity.tokens.color.ramps.primary.map((h) => h.toUpperCase()).includes('#3B82F6'));
  assert.equal(identity.tokens.color.light.primary.toUpperCase(), '#3B82F6');
  assert.equal(identity.tokens.typeScale.base, 16);
  assert.equal(identity.tokens.typeScale.ratio, 1.25);
  // The template has one size below the base (captions); the golden sizes are the base and the four above it.
  assert.deepEqual(identity.tokens.typeScale.steps, [12.8, 16, 20, 25, 31.25, 39.06]);
});

// Task-level golden (tasks.md 2.14): the contrast blocking rule and its suggestion.
test('T-2.14 rules: #767676 on white at AA → allowed', () => {
  const rules = require('../picker/js/core/rules.js');
  const r = rules.contrast('#767676', '#FFFFFF', 'AA');
  assert.equal(r.allowed, true);
  assert.equal(r.suggestion, null);
});

test('T-2.14 rules: #777777 on white at AA → blocked; the suggested color reaches 4.5:1 or more', () => {
  const rules = require('../picker/js/core/rules.js');
  const r = rules.contrast('#777777', '#FFFFFF', 'AA');
  assert.equal(r.allowed, false);
  assert.match(r.suggestion, /^#[0-9a-f]{6}$/);
  assert.ok(contrast.ratio(r.suggestion, '#FFFFFF') >= 4.5, `${r.suggestion} on white`);
  // It comes from the color's own ramp.
  assert.ok(ramp.generate('#777777').steps.includes(r.suggestion));
});

test('T-2.14 rules: #767676 on white at AAA → blocked', () => {
  const rules = require('../picker/js/core/rules.js');
  const r = rules.contrast('#767676', '#FFFFFF', 'AAA');
  assert.equal(r.allowed, false);
  assert.ok(contrast.ratio(r.suggestion, '#FFFFFF') >= 7);
});

// G-07 to G-10 (CHG-4, task 6.2, R-103): the Latin size adjustment is written into the exported CSS as @font-face
// rules of the Latin family with size-adjust, under a name of its own that the font stacks start with.
function fontExport(fontsTemplate, overrides) {
  const resolve = require('../picker/js/core/resolve.js');
  const bundle = require('../picker/js/core/bundle.js');
  const build = require('../tools/build.js');
  const path = require('node:path');
  const data = build.select(build.load(path.join(__dirname, '..', 'library'))).data;
  const calm = data.identities.find((i) => i.id === 'calm-corporate');
  const selections = {};
  for (const [element, template] of Object.entries(calm.templates)) selections[element] = { template };
  selections.fonts = { template: fontsTemplate };
  if (overrides) selections.fonts.overrides = overrides;
  return bundle.build(resolve.resolve({ name: 'Golden', selections }, data)).files;
}
// Every @font-face block of a CSS text: { family, sizeAdjust }.
const fontFaces = (css) =>
  [...css.matchAll(/@font-face \{([^}]*)\}/g)].map((m) => ({
    family: (/font-family: "([^"]+)";/.exec(m[1]) || [])[1],
    sizeAdjust: (/size-adjust: ([^;]+);/.exec(m[1]) || [])[1]
  }));
function assertAdjusted(files, latin, arabic, percent) {
  const name = `${latin} Hawiya ${percent.replace('%', '')}`;
  for (const f of ['tokens.css', 'theme.css', 'style-guide.html']) {
    const faces = fontFaces(files[f]);
    assert.ok(faces.length >= 2, `${f}: @font-face rules`);
    for (const face of faces) assert.deepEqual(face, { family: name, sizeAdjust: percent }, f);
  }
  assert.match(files['tokens.css'], new RegExp(`--font-body: "${name}", "${latin}", "${arabic}", `));
}

test('G-07 size adjustment: «الأميري مع إي بي غاراموند» (1.35) → size-adjust: 135%', () => {
  assertAdjusted(fontExport('pair-amiri-eb-garamond'), 'EB Garamond', 'Amiri', '135%');
});

test('G-08 size adjustment: «نوتو نسخ مع فراونسيز» (0.9) → size-adjust: 90%', () => {
  assertAdjusted(fontExport('pair-noto-naskh-arabic-fraunces'), 'Fraunces', 'Noto Naskh Arabic', '90%');
});

test('G-09 size adjustment: «القاهرة» (1) → no @font-face rule', () => {
  const files = fontExport('pair-cairo');
  for (const f of ['tokens.css', 'theme.css', 'style-guide.html']) {
    assert.deepEqual(fontFaces(files[f]), [], f);
    assert.ok(!files[f].includes(' Hawiya 1'), `${f}: no adjusted family name`);
  }
});

test('G-10 size adjustment: «الأميري مع إي بي غاراموند» with its own value 1.1 → size-adjust: 110%', () => {
  assertAdjusted(fontExport('pair-amiri-eb-garamond', { 'latin-size-adjust': 1.1 }), 'EB Garamond', 'Amiri', '110%');
});

// G-11 (CHG-5, task 6.8, R-105): tokens.css loads every font of the identity itself, so linking it alone is enough:
// right after the header comment, two Google Fonts @import lines per family (regular, then bold), before any rule.
test('G-11 font imports: «الأميري مع إي بي غاراموند» → tokens.css starts with the Amiri and EB Garamond @import lines', () => {
  const files = fontExport('pair-amiri-eb-garamond');
  const lines = files['tokens.css'].split('\n');
  const afterHeader = lines.indexOf(' */') + 1;
  assert.ok(afterHeader > 0, 'tokens.css: header comment');
  assert.deepEqual(lines.slice(afterHeader, afterHeader + 4), [
    '@import url("https://fonts.googleapis.com/css2?family=Amiri&display=swap");',
    '@import url("https://fonts.googleapis.com/css2?family=Amiri:wght@700&display=swap");',
    '@import url("https://fonts.googleapis.com/css2?family=EB+Garamond&display=swap");',
    '@import url("https://fonts.googleapis.com/css2?family=EB+Garamond:wght@700&display=swap");'
  ]);
  // Nothing but comments and blank lines before the last @import (CSS ignores an @import placed after a rule).
  const lastImport = lines.map((l) => l.startsWith('@import ')).lastIndexOf(true);
  const before = lines
    .slice(0, lastImport)
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  assert.deepEqual(
    before.split('\n').filter((l) => l.trim() && !l.startsWith('@import ')),
    []
  );
  assert.ok(!files['theme.css'].includes('@import url('), 'theme.css: no @import (Tailwind places it after its rules)');
});
