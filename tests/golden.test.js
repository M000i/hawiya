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
