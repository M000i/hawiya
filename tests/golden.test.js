'use strict';

/*
 * Golden tests: the approved examples in spec.md section 12, listed in golden.md.
 * Each test name starts with its id (G-01 ...) so `npm run test:golden` prints them one by one.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const contrast = require('../picker/js/core/contrast.js');
const color = require('../picker/js/core/color.js');

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
