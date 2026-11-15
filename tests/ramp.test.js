'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const ramp = require('../picker/js/core/ramp.js');
const color = require('../picker/js/core/color.js');

// Twenty varied inputs: grays, black/white, pure saturated primaries, brand-like colors, near-white/black.
const INPUTS = [
  '#808080', '#767676', '#000000', '#ffffff', '#111827',
  '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff',
  '#3b82f6', '#7c3aed', '#0f766e', '#facc15', '#b91c1c', '#1f2937',
  '#fefefe', '#010101', '#feffff'
];

const hueDiff = (a, b) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

for (const hex of INPUTS) {
  test(`ramp properties: ${hex}`, () => {
    const r = ramp.generate(hex);
    const o = color.toOklch(hex);

    // 11 displayable colors in canonical form.
    assert.equal(r.steps.length, 11);
    for (const s of r.steps) {
      assert.match(s, /^#[0-9a-f]{6}$/);
      assert.ok(color.inGamut(color.toOklch(s)), `${s} not displayable`);
    }

    // The input appears unchanged, at the reported anchor, and that anchor is a plain integer 0..10.
    assert.ok(Number.isInteger(r.anchor) && r.anchor >= 0 && r.anchor <= 10 && !Object.is(r.anchor, -0));
    assert.equal(r.steps[r.anchor], color.normalizeHex(hex));

    // Lightness strictly decreases, and evenly: every gap between 0.03 and 0.13 (even step ≈ 0.08).
    const L = r.steps.map((s) => color.toOklch(s).L);
    for (let i = 1; i < 11; i++) {
      const gap = L[i - 1] - L[i];
      assert.ok(gap > 0.03 && gap < 0.13, `gap ${i}: ${gap.toFixed(4)} (${r.steps[i - 1]} → ${r.steps[i]})`);
    }

    // Grays stay gray; colored inputs keep their hue. The only drift is 8-bit rounding, which grows as chroma
    // shrinks (measured on 20,000 random inputs: < 0.9° above C 0.1, < 2.8° above 0.05, < 5.4° above 0.02).
    for (const s of r.steps) {
      const so = color.toOklch(s);
      if (color.isAchromatic(o)) {
        assert.ok(so.C < 1e-3, `${s} should be gray`);
        continue;
      }
      const limit = so.C > 0.1 ? 1 : so.C > 0.05 ? 3 : so.C > 0.02 ? 6 : Infinity;
      assert.ok(hueDiff(so.H, o.H) < limit, `${s} (C ${so.C.toFixed(3)}) hue ${so.H.toFixed(1)} vs ${o.H.toFixed(1)}`);
    }

    // Same input, same output.
    assert.deepEqual(ramp.generate(hex), r);
  });
}

test('uppercase and short inputs give the same ramp as the canonical form', () => {
  assert.deepEqual(ramp.generate('#3B82F6'), ramp.generate('#3b82f6'));
  assert.deepEqual(ramp.generate('#F00'), ramp.generate('#ff0000'));
});

test('the input sits at the step nearest its lightness on the even scale (plan.md §13), for all twenty inputs', () => {
  for (const hex of INPUTS) {
    const L = color.toOklch(hex).L;
    const x = ((ramp.LIGHTEST - L) / (ramp.LIGHTEST - ramp.DARKEST)) * 10;
    const nearest = Math.min(10, Math.max(0, Math.round(x)));
    assert.equal(ramp.generate(hex).anchor, nearest, `${hex}: L ${L.toFixed(3)}, x ${x.toFixed(2)}`);
  }
  // Hand-checked: #1f2937 has L ≈ 0.278 → x ≈ 8.55 → step 9 (not pushed to 10 by an off-by-one).
  assert.equal(ramp.generate('#1f2937').anchor, 9);
});

test('chroma follows the profile, scaled so the anchor keeps the input chroma (where the screen allows)', () => {
  for (const hex of ['#3b82f6', '#7c3aed', '#0f766e', '#b91c1c']) {
    const r = ramp.generate(hex);
    const o = color.toOklch(hex);
    let checked = 0;
    r.steps.forEach((s, i) => {
      if (i === r.anchor) return;
      const want = o.C * Math.min(ramp.CHROMA_PROFILE[i] / ramp.CHROMA_PROFILE[r.anchor], ramp.MAX_GAIN);
      const so = color.toOklch(s);
      if (!color.inGamut({ L: so.L, C: want, H: o.H })) return; // clamped by the screen: not comparable
      assert.ok(Math.abs(so.C - want) < 0.006, `${hex} step ${i}: C ${so.C.toFixed(4)} vs ${want.toFixed(4)}`);
      checked++;
    });
    assert.ok(checked >= 3, `${hex}: too few unclamped steps checked (${checked})`);
  }
});

test('near-white inputs stay muted; a real pale tint still gives a colored ramp', () => {
  const maxC = (hex) => Math.max(...ramp.generate(hex).steps.map((s) => color.toOklch(s).C));
  assert.ok(maxC('#feffff') < 0.01, `#feffff max C ${maxC('#feffff')}`);
  assert.ok(maxC('#fffdf8') < 0.06, `#fffdf8 max C ${maxC('#fffdf8')}`);
  assert.ok(maxC('#f0f9ff') > 0.08, `#f0f9ff max C ${maxC('#f0f9ff')}`);
  assert.equal(maxC('#fefefe'), 0);
});

test('anchor follows the input lightness: light inputs near the top, dark near the bottom', () => {
  assert.equal(ramp.generate('#ffffff').anchor, 0);
  assert.equal(ramp.generate('#000000').anchor, 10);
  assert.ok(ramp.generate('#3b82f6').anchor >= 3 && ramp.generate('#3b82f6').anchor <= 6);
  // Mid-gray sits in the middle.
  assert.equal(ramp.generate('#808080').anchor, 5);
});

test('refuses bad input', () => {
  for (const bad of ['blue', '#12345', '', null]) assert.throws(() => ramp.generate(bad), /Hawiya\.color/);
});

test('loads as a plain browser script after color.js, and refuses to load without it', () => {
  const dir = path.join(__dirname, '..', 'picker', 'js', 'core');
  const colorSrc = fs.readFileSync(path.join(dir, 'color.js'), 'utf8');
  const rampSrc = fs.readFileSync(path.join(dir, 'ramp.js'), 'utf8');
  const ok = { self: {} };
  vm.runInNewContext(colorSrc, ok);
  vm.runInNewContext(rampSrc, ok);
  assert.equal(ok.self.Hawiya.ramp.generate('#3b82f6').steps.length, 11);
  assert.throws(() => vm.runInNewContext(rampSrc, { self: {} }), /load color\.js before ramp\.js/);
});
