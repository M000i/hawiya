'use strict';

/*
 * Golden tests: the approved examples in spec.md section 12, listed in golden.md.
 * Each test name starts with its id (G-01 ...) so `npm run test:golden` prints them one by one.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const contrast = require('../picker/js/core/contrast.js');

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
