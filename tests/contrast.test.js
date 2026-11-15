'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const c = require('../picker/js/core/contrast.js');

// Reference built differently from the module on purpose: the WCAG 2.0 threshold (0.03928, which selects
// the same branch for every 8-bit value), a precomputed 256-entry table, and luminance summed in another order.
const LIN = Array.from({ length: 256 }, (_, v) => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : Math.exp(2.4 * Math.log((s + 0.055) / 1.055));
});
function refRatio(a, b) {
  const lum = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return LIN[n & 255] * 0.0722 + LIN[(n >> 8) & 255] * 0.7152 + LIN[n >> 16] * 0.2126;
  };
  const x = lum(a) + 0.05;
  const y = lum(b) + 0.05;
  return x > y ? x / y : y / x;
}
const hex2 = (n) => n.toString(16).padStart(2, '0');

test('hand-checked values for very dark colors (computed at 50 digits outside this code)', () => {
  // Python decimal, WCAG 2.0 formula, prec 50 — covers the linear (c/12.92) part of the curve.
  const cases = [
    ['#0a0a0a', '#ffffff', 19.7981457105248],
    ['#010203', '#ffffff', 20.7655820051191],
    ['#050000', '#000000', 1.00645298367024],
    ['#0a0a0a', '#000000', 1.06070539670976],
    ['#006bfb', '#000000', 4.4960849619412]
  ];
  for (const [a, b, want] of cases) assert.ok(Math.abs(c.ratio(a, b) - want) < 1e-12, `${a} on ${b}: ${c.ratio(a, b)}`);
});

test('matches the reference on a sweep that includes every dark channel value 0..10', () => {
  const steps = [];
  for (let v = 0; v <= 10; v++) steps.push(v);
  for (let v = 16; v <= 255; v += 16) steps.push(v);
  steps.push(255);
  let n = 0;
  for (const r of steps) for (const g of steps) for (const b of steps) {
    const hex = `#${hex2(r)}${hex2(g)}${hex2(b)}`;
    for (const bg of ['#ffffff', '#000000', '#050505']) {
      assert.ok(Math.abs(c.ratio(hex, bg) - refRatio(hex, bg)) < 1e-12, `${hex} on ${bg}`);
      n++;
    }
  }
  assert.equal(n, 3 * steps.length ** 3);
});

test('display never shows a threshold the exact ratio misses (verdict and number agree)', () => {
  // #006bfb on black is 4.4961: plain rounding would show 4.50 while AA fails.
  const r = c.evaluate('#006bfb', '#000000');
  assert.equal(r.AA, false);
  assert.equal(r.rounded, 4.49);
  assert.equal(c.display(6.9958), 6.99);
  assert.equal(c.display(2.996), 2.99);
  assert.equal(c.display(4.5), 4.5);
  assert.equal(c.display(4.5422), 4.54);
  assert.equal(c.display(4.4781), 4.48);
  // Sweep: whenever a verdict fails, the shown number is below that threshold.
  for (let v = 0; v < 256; v += 1) for (const bg of ['#ffffff', '#000000']) for (const blue of [0, 0x80, 0xfb]) {
    const hex = `#${hex2(0)}${hex2(v)}${hex2(blue)}`;
    const e = c.evaluate(hex, bg);
    if (!e.AA) assert.ok(e.rounded < 4.5, `${hex} on ${bg}: shows ${e.rounded}`);
    if (!e.AAA) assert.ok(e.rounded < 7, `${hex} on ${bg}: shows ${e.rounded}`);
    if (!e.AALarge) assert.ok(e.rounded < 3, `${hex} on ${bg}: shows ${e.rounded}`);
  }
});

test('ratio is symmetric, between 1 and 21, and 1 for identical colors', () => {
  assert.equal(c.ratio('#123456', '#abcdef'), c.ratio('#abcdef', '#123456'));
  assert.equal(c.ratio('#7c3aed', '#7c3aed'), 1);
  assert.equal(c.ratio('#ffffff', '#000000'), 21);
  for (const [a, b] of [['#2563eb', '#ffffff'], ['#facc15', '#111827'], ['#000000', '#000001']]) {
    const r = c.ratio(a, b);
    assert.ok(r >= 1 && r <= 21);
  }
});

test('verdicts use the exact ratio, never the rounded one', () => {
  // Find real colors just below and at/above 4.5 on white.
  let below = null;
  let above = null;
  for (let v = 0x70; v <= 0x80; v++) {
    const hex = `#${hex2(v)}${hex2(v)}${hex2(v)}`;
    const r = c.ratio(hex, '#ffffff');
    if (r < 4.5 && (!below || r > below.r)) below = { hex, r };
    if (r >= 4.5 && (!above || r < above.r)) above = { hex, r };
  }
  assert.equal(c.evaluate(below.hex, '#ffffff').AA, false);
  assert.equal(c.evaluate(above.hex, '#ffffff').AA, true);
  // Synthetic: a ratio that rounds up to 4.50 must still fail.
  assert.equal(c.round2(4.4951), 4.5);
  assert.equal(c.meets(4.4951, 'AA'), false);
  assert.equal(c.meets(4.5, 'AA'), true);
  assert.equal(c.meets(6.999, 'AAA'), false);
  assert.equal(c.meets(7, 'AAA'), true);
});

test('large-text thresholds: AA 3, AAA 4.5', () => {
  assert.equal(c.meets(2.99, 'AA', true), false);
  assert.equal(c.meets(3, 'AA', true), true);
  assert.equal(c.meets(4.49, 'AAA', true), false);
  assert.equal(c.meets(4.5, 'AAA', true), true);
  const r = c.evaluate('#949494', '#ffffff'); // about 3.03
  assert.equal(r.AA, false);
  assert.equal(r.AALarge, true);
});

test('accepts #rgb and any letter case; refuses anything else', () => {
  assert.equal(c.ratio('#fff', '#000'), 21);
  assert.equal(c.ratio('#FfFfFf', '#000000'), 21);
  for (const bad of ['fff', '#ffff', '#gggggg', '#2563eb\n', ' #2563eb', 'rgb(0,0,0)', '', null, undefined, 123]) {
    assert.throws(() => c.ratio(bad, '#ffffff'), /Hawiya\.contrast/, String(bad));
  }
  assert.throws(() => c.meets(5, 'A'), /level/);
  assert.throws(() => c.meets(5, 'constructor'), /level/);
  assert.throws(() => c.meets(5, '__proto__'), /level/);
  assert.throws(() => c.meets(NaN, 'AA'), /ratio/);
  assert.throws(() => c.meets('4.6', 'AA'), /ratio/);
  assert.throws(() => c.meets(0.5, 'AA'), /ratio/);
});

test('loads as a plain browser script (window.Hawiya.contrast) without module support', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'picker', 'js', 'core', 'contrast.js'), 'utf8');
  const sandbox = { self: {} };
  vm.runInNewContext(src, sandbox);
  assert.equal(sandbox.self.Hawiya.contrast.evaluate('#767676', '#ffffff').rounded, 4.54);
});
