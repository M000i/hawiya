'use strict';

/*
 * «Fill the rest for me» (task 2.18, R-024 / AC-16): every element the user did not choose is filled with the
 * template that best suits the choices made so far, among those that keep every blocking rule; the filled ones are
 * listed in autoFilled; the same choices always give the same result.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const autofill = require('../picker/js/core/autofill.js');
const resolve = require('../picker/js/core/resolve.js');
const rules = require('../picker/js/core/rules.js');
const validate = require('../picker/js/core/validate.js');
const build = require('../tools/build.js');

const data = build.select(build.load(path.join(__dirname, '..', 'library'))).data;
const find = (element, id) => (data.templates[element] || []).find((t) => t.id === id) || null;
const ELEMENTS = resolve.ELEMENTS;
const SETTINGS = ['modes', 'direction'];

// The page's starting point: the first ready identity.
function starter() {
  const ready = data.identities.find((i) => i.id === 'calm-corporate');
  const selections = {};
  for (const e of ELEMENTS) selections[e] = { template: ready.templates[e] };
  return { name: 'Test', selections };
}

// A small seeded generator, so the hundred combinations are the same on every run.
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Checks every result must pass, whatever the combination.
function assertComplete(before, chosen, out, label) {
  assert.equal(out.allowed, true, `${label}: allowed`);
  const identity = resolve.resolve(out.choices, data); // builds, so every element has a template
  assert.equal(validate.check('identity', identity).valid, true, `${label}: identity checker`);
  const r = rules.identity(identity, find);
  assert.deepEqual(r.problems, [], `${label}: no blocking rule broken`);
  assert.deepEqual(r.unchecked, [], `${label}: every element checked`);
  const missing = ELEMENTS.filter((e) => !chosen.includes(e));
  assert.deepEqual(out.filled, missing, `${label}: every missing element filled, in element order`);
  assert.deepEqual(identity.autoFilled, missing, `${label}: marked as filled automatically`);
  for (const e of chosen) assert.deepEqual(out.choices.selections[e], before.selections[e], `${label}: ${e} kept`);
  for (const e of ELEMENTS) assert.ok(find(e, out.choices.selections[e].template), `${label}: ${e} from the library`);
  // Settings (mode, direction) are the project's decisions: a missing one keeps its current value.
  for (const e of SETTINGS.filter((x) => missing.includes(x))) {
    assert.deepEqual(out.choices.selections[e], before.selections[e], `${label}: setting ${e} unchanged`);
  }
  assert.deepEqual(out.choices.project, before.project, `${label}: project unchanged`);
}

test('a hundred combinations of two or three choices: each result complete, checked and within every rule', () => {
  const rand = seeded(2018);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  let made = 0;
  let skipped = 0;
  const seen = { aaa: 0, aaaColorsFilled: 0, ltr: 0, both: 0, fontsFilled: 0, three: 0 };
  while (made < 100) {
    const before = starter();
    const count = rand() < 0.5 ? 2 : 3;
    const chosen = [];
    while (chosen.length < count) {
      const e = pick(ELEMENTS);
      if (!chosen.includes(e)) chosen.push(e);
    }
    chosen.sort((a, b) => ELEMENTS.indexOf(a) - ELEMENTS.indexOf(b));
    for (const e of chosen) before.selections[e] = { template: pick(data.templates[e]).id };
    if (rand() < 0.3) before.project = { contrast: 'AAA' };
    // Only states the page can be in: every blocking rule passes before the button is pressed. When the colors
    // miss the contrast level, the page applies the suggested color (as the user would).
    let r = rules.identity(resolve.resolve(before, data), find);
    if (!r.allowed && r.suggestion) {
      before.selections.colors.overrides = { ...r.suggestion.overrides };
      r = rules.identity(resolve.resolve(before, data), find);
    }
    if (!r.allowed) {
      skipped++;
      continue;
    }
    const frozen = JSON.parse(JSON.stringify(before));
    const out = autofill.fill(before, chosen, data);
    assert.deepEqual(before, frozen, 'the input is not changed');
    assertComplete(before, chosen, out, `#${made} ${chosen.join('+')}`);
    // Same choices, same result: again, and with the keys in another order.
    assert.deepEqual(autofill.fill(before, chosen, data), out, `#${made} repeat`);
    const reordered = { ...before, selections: Object.fromEntries(Object.entries(before.selections).reverse()) };
    assert.deepEqual(autofill.fill(reordered, [...chosen].reverse(), data).choices.selections, out.choices.selections);
    made++;
    const dir = before.selections.direction.template;
    if (before.project) seen.aaa++;
    if (before.project && !chosen.includes('colors')) seen.aaaColorsFilled++;
    if (dir === 'direction-ltr') seen.ltr++;
    if (dir === 'direction-both') seen.both++;
    if (!chosen.includes('fonts')) seen.fontsFilled++;
    if (count === 3) seen.three++;
  }
  // The hundred cover the hard cases: AAA with the palette to fill, English-only and bilingual projects.
  for (const [k, v] of Object.entries(seen)) assert.ok(v > 0, `covered: ${k}`);
  assert.ok(skipped < 100, `skipped ${skipped}`);
});

test('known result, computed by hand: a soft, playful color and font give a round, soft identity', () => {
  // Chosen: palette-teal [soft, playful; r .5 d .5 i .5] and pair-cairo [playful, soft; r .7 d .5 i .6].
  // type-scale (no shared tag; roundness not applicable): minor .4×(1−(.2+.25)/2)=.31, major .4×(1−(0+.05)/2)=.39,
  //   fourth .31 → scale-major-third.
  // radius (tags soft 2, playful 2, corporate 1, minimal 1; r .6 d .5 i .5333): sharp .302222, medium .642222,
  //   round .6×1 + .4×(1−(.2+0+.2333)/3) = .942222 → radius-round.
  // shadows (soft 3, playful 3, corporate 1, minimal 1; r .6667 d .5 i .475): flat .401111, soft .781111,
  //   deep .334444 → shadow-soft.
  const before = starter();
  before.selections.colors = { template: 'palette-teal' };
  before.selections.fonts = { template: 'pair-cairo' };
  const out = autofill.fill(before, ['colors', 'fonts'], data);
  assertComplete(before, ['colors', 'fonts'], out, 'teal + cairo');
  assert.equal(out.choices.selections['type-scale'].template, 'scale-major-third');
  assert.equal(out.choices.selections.radius.template, 'radius-round');
  assert.equal(out.choices.selections.shadows.template, 'shadow-soft');

  // Elements are filled in the fixed element order, each scored against the chosen ones and those already filled.
  // Chosen: palette-teal [soft, playful; r .5 d .5 i .5] and a mode (a setting: it says nothing about style).
  // fonts come first: plex .346667, noto-sans .36, cairo .6×1 + .4×(1−(.2+0+.1)/3) = .96, kufi .333333,
  //   inter .36 → pair-cairo. (Filled last, after eight other elements, the fonts would be different.)
  const teal = starter();
  teal.selections.colors = { template: 'palette-teal' };
  teal.selections.modes = { template: 'modes-dark-first' };
  const tealOut = autofill.fill(teal, ['colors', 'modes'], data);
  assertComplete(teal, ['colors', 'modes'], tealOut, 'teal + mode');
  assert.equal(tealOut.choices.selections.fonts.template, 'pair-cairo');
});

test('AAA with the colors left to fill: the nearest passing colors are used instead of a blocked palette', () => {
  const before = starter();
  before.project = { contrast: 'AAA' };
  before.selections.fonts = { template: 'pair-cairo' };
  before.selections.radius = { template: 'radius-round' };
  // The page's state: the starter palette with the suggested colors (B-041: every palette misses 7:1).
  const r = rules.identity(resolve.resolve(before, data), find);
  assert.equal(r.allowed, false);
  before.selections.colors.overrides = { ...r.suggestion.overrides };
  const out = autofill.fill(before, ['fonts', 'radius'], data);
  assertComplete(before, ['fonts', 'radius'], out, 'AAA');
  // The palette that suits a soft, playful font and round corners (teal .96; blue .346667, rose .32 by hand) is
  // used with the nearest colors that pass 7:1, instead of keeping the starter's blue.
  assert.equal(out.choices.selections.colors.template, 'palette-teal');
  assert.ok(out.choices.selections.colors.overrides, 'colors adjusted to pass 7:1');
  assert.equal(resolve.resolve(out.choices, data).project.contrast, 'AAA');
});

test('an English-only project never gets an Arabic-only font; an Arabic one never gets a Latin-only font', () => {
  for (const [direction, banned] of [
    ['direction-ltr', 'font-noto-kufi-arabic'],
    ['direction-rtl', 'font-inter'],
    ['direction-both', 'font-inter']
  ]) {
    // The session asks for exactly the banned font's style, so it would rank first without the rules.
    const tags = find('fonts', banned).tags;
    const before = starter();
    before.selections.direction = { template: direction };
    before.selections.radius = { template: 'radius-sharp' };
    const out = autofill.fill(before, ['radius', 'direction'], data, { tags });
    assertComplete(before, ['radius', 'direction'], out, direction);
    assert.notEqual(out.choices.selections.fonts.template, banned, direction);
  }
});

test('the session tags steer the filling (R-033)', () => {
  const before = starter();
  before.selections.colors = { template: 'palette-blue' };
  before.selections.spacing = { template: 'spacing-comfortable' };
  const plain = autofill.fill(before, ['colors', 'spacing'], data);
  const playful = autofill.fill(before, ['colors', 'spacing'], data, { tags: ['playful', 'soft'] });
  assertComplete(before, ['colors', 'spacing'], playful, 'session');
  assert.notEqual(playful.choices.selections.radius.template, plain.choices.selections.radius.template);
  assert.equal(playful.choices.selections.radius.template, 'radius-round');
});

test('filling again keeps the chosen elements and gives the same result; adjustments of a filled one go', () => {
  const before = starter();
  before.selections.colors = { template: 'palette-rose', overrides: { primary: '#9f1239' } };
  before.selections.icons = { template: 'icons-phosphor-bold' };
  before.selections.radius = { template: 'radius-sharp', overrides: { md: 30 } }; // not chosen
  const once = autofill.fill(before, ['colors', 'icons'], data);
  assertComplete(before, ['colors', 'icons'], once, 'rose + bold');
  assert.equal(once.choices.selections.radius.overrides, undefined, 'a filled element is the plain template');
  const twice = autofill.fill(once.choices, ['colors', 'icons'], data);
  assert.deepEqual(twice, once);
});

test('a state that already breaks a blocking rule is reported, never passed off as allowed', () => {
  const before = starter();
  before.selections.fonts = { template: 'font-inter' }; // Latin only, in an Arabic project
  const out = autofill.fill(before, ['fonts', 'direction'], data);
  assert.equal(out.allowed, false);
  assert.ok(out.problems.some((p) => p.rule === 'font-language'));
});

test('wrong input is refused with a clear error', () => {
  assert.throws(() => autofill.fill(starter(), ['colors', 'nope'], data), /unknown element "nope"/);
  assert.throws(() => autofill.fill(starter(), 'colors', data), /chosen must be a list/);
  assert.throws(() => autofill.fill(starter(), ['colors'], { templates: {} }), /no templates for "colors"/);
});

test('loads as a plain browser script after its dependencies', () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const sandbox = { self: {} };
  vm.createContext(sandbox);
  const core = path.join(__dirname, '..', 'picker', 'js', 'core');
  for (const f of [
    'color.js',
    'contrast.js',
    'ramp.js',
    'modes.js',
    'recipe.js',
    'rules.js',
    'match.js',
    'scale.js',
    'schemas.js',
    'validate.js',
    'resolve.js',
    'autofill.js'
  ]) {
    vm.runInContext(fs.readFileSync(path.join(core, f), 'utf8'), sandbox);
  }
  assert.equal(typeof sandbox.self.Hawiya.autofill.fill, 'function');
  const out = sandbox.self.Hawiya.autofill.fill(starter(), ['colors', 'fonts'], data);
  assert.deepEqual(JSON.parse(JSON.stringify(out)), autofill.fill(starter(), ['colors', 'fonts'], data));
});
