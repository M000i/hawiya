'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

const c = require('../picker/js/core/color.js');

const hex2 = (n) => n.toString(16).padStart(2, '0');

/* Small deterministic PRNG so the "1000 random colors" are the same on every run. */
function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hueDiff(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

test('matches culori (independent library) on 1000 random colors', async () => {
  const { oklch } = await import('culori');
  const rnd = prng(20261115);
  let worst = { L: 0, C: 0, H: 0 };
  for (let i = 0; i < 1000; i++) {
    const hex = '#' + [0, 0, 0].map(() => hex2(Math.floor(rnd() * 256))).join('');
    const ours = c.toOklch(hex);
    const ref = oklch(hex);
    const dL = Math.abs(ours.L - ref.l);
    const dC = Math.abs(ours.C - (ref.c || 0));
    assert.ok(dL < 1e-6, `${hex} L ${ours.L} vs ${ref.l}`);
    assert.ok(dC < 1e-6, `${hex} C ${ours.C} vs ${ref.c}`);
    if (ours.C > 1e-3) {
      const dH = hueDiff(ours.H, ref.h);
      assert.ok(dH < 1e-3, `${hex} H ${ours.H} vs ${ref.h}`);
      worst.H = Math.max(worst.H, dH);
    }
    worst.L = Math.max(worst.L, dL);
    worst.C = Math.max(worst.C, dC);
  }
  assert.ok(worst.L < 1e-6 && worst.C < 1e-6, JSON.stringify(worst));
});

test('round trip returns the same color (every 3rd value per channel + all extremes)', () => {
  const vals = [];
  for (let v = 0; v < 256; v += 3) vals.push(v);
  for (const v of [1, 2, 4, 5, 127, 128, 253, 254, 255]) if (!vals.includes(v)) vals.push(v);
  let n = 0;
  for (const r of vals) for (const g of vals) for (const b of vals) {
    const hex = `#${hex2(r)}${hex2(g)}${hex2(b)}`;
    assert.equal(c.toHex(c.toOklch(hex)), hex);
    n++;
  }
  assert.ok(n > 600000, String(n));
});

test('grays have chroma 0 and hue 0; the least colorful non-gray is not treated as gray', () => {
  for (let v = 0; v < 256; v++) {
    const o = c.toOklch(`#${hex2(v).repeat(3)}`);
    assert.equal(o.C, 0, `gray ${v}`);
    assert.equal(o.H, 0, `gray ${v}`);
  }
  // Smallest chroma among all 16.7M non-grays is #feffff (about 0.00106), ten times the threshold.
  assert.ok(c.toOklch('#feffff').C > c.ACHROMATIC * 5);
  assert.ok(c.toOklch('#000001').C > c.ACHROMATIC);
  // Lightness runs from 0 (black) to 1 (white).
  assert.ok(Math.abs(c.toOklch('#000000').L) < 1e-9);
  assert.ok(Math.abs(c.toOklch('#ffffff').L - 1) < 1e-6);
});

test('out-of-gamut colors are brought in by reducing chroma only (lightness and hue kept)', async () => {
  const { clampChroma } = await import('culori');
  const cases = [
    { L: 0.7, C: 0.4, H: 150 },
    { L: 0.5, C: 0.37, H: 264 },
    { L: 0.9, C: 0.3, H: 100 },
    { L: 0.2, C: 0.2, H: 20 },
    { L: 0.628, C: 0.3, H: 29.2 }
  ];
  for (const o of cases) {
    assert.equal(c.inGamut(o), false, JSON.stringify(o));
    const g = c.clampChroma(o);
    assert.equal(g.L, o.L);
    assert.equal(g.H, o.H);
    assert.ok(g.C < o.C && g.C > 0);
    assert.ok(c.inGamut(g), 'clamped color must be in gamut');
    assert.equal(c.inGamut({ ...g, C: g.C + 0.002 }), false, 'chroma should be (near) the largest that fits');
    const ref = clampChroma({ mode: 'oklch', l: o.L, c: o.C, h: o.H }, 'oklch');
    assert.ok(Math.abs(ref.c - g.C) < 2e-3, `chroma ${g.C} vs culori ${ref.c}`);
    assert.match(c.toHex(o), /^#[0-9a-f]{6}$/);
  }
  // Already in gamut: unchanged.
  const red = c.toOklch('#ff0000');
  assert.deepEqual(c.clampChroma(red), red);
});

test('every real sRGB color counts as in gamut and is left untouched by clampChroma', () => {
  // Includes the worst float cases found in review (pure green/yellow, blue = 0).
  for (const hex of ['#00ff00', '#ffff00', '#07ff00', '#7bff00', '#bcf100', '#ff0000', '#0000ff', '#ffffff', '#000000']) {
    const o = c.toOklch(hex);
    assert.equal(c.inGamut(o), true, hex);
    assert.deepEqual(c.clampChroma(o), o, hex);
  }
  let n = 0;
  for (let r = 0; r < 256; r += 5) for (let g = 0; g < 256; g += 5) for (const b of [0, 1, 128, 254, 255]) {
    const o = c.toOklch(`#${hex2(r)}${hex2(g)}${hex2(b)}`);
    assert.ok(c.inGamut(o), `#${hex2(r)}${hex2(g)}${hex2(b)}`);
    n++;
  }
  assert.ok(n > 13000);
});

test('absurd chroma never yields an invalid color', () => {
  for (const C of [1e110, 1e12, 1e11, 5]) {
    const o = { L: 0.6, C, H: 30 };
    assert.equal(c.inGamut(o), false, String(C));
    assert.match(c.toHex(o), /^#[0-9a-f]{6}$/, String(C));
    // Same result as a sane over-the-limit chroma: the largest displayable one, not gray.
    assert.equal(c.toHex(o), c.toHex({ L: 0.6, C: 0.4, H: 30 }), String(C));
  }
});

test('normalizeHex gives the canonical lowercase #rrggbb used for comparisons', () => {
  assert.equal(c.normalizeHex('#3B82F6'), '#3b82f6');
  assert.equal(c.normalizeHex('#ABC'), '#aabbcc');
  assert.equal(c.toHex(c.toOklch('#3B82F6')), c.normalizeHex('#3B82F6'));
  assert.throws(() => c.normalizeHex('3b82f6'), /Hawiya\.color/);
});

test('isAchromatic tells a placeholder hue (gray) from a real one', () => {
  assert.equal(c.isAchromatic(c.toOklch('#808080')), true);
  assert.equal(c.isAchromatic(c.toOklch('#feffff')), false);
  assert.equal(c.isAchromatic(c.toOklch('#ff0000')), false);
});

test('edge values: lightness outside 0..1, negative chroma, hue wrap-around', () => {
  assert.equal(c.toHex({ L: 1.2, C: 0.1, H: 40 }), '#ffffff');
  assert.equal(c.toHex({ L: -0.1, C: 0.1, H: 40 }), '#000000');
  assert.equal(c.toHex({ L: 0.6, C: -0.05, H: 40 }), c.toHex({ L: 0.6, C: 0, H: 40 }));
  assert.equal(c.toHex({ L: 0.6, C: 0.1, H: 400 }), c.toHex({ L: 0.6, C: 0.1, H: 40 }));
  assert.equal(c.toHex({ L: 0.6, C: 0.1, H: -320 }), c.toHex({ L: 0.6, C: 0.1, H: 40 }));
});

test('refuses bad input instead of producing a wrong color', () => {
  for (const bad of ['red', '#12345', '#2563eb\n', null, 7]) assert.throws(() => c.toOklch(bad), /Hawiya\.color/);
  for (const bad of [null, {}, { L: NaN, C: 0, H: 0 }, { L: 0.5, C: Infinity, H: 0 }, { L: '0.5', C: 0, H: 0 }]) {
    assert.throws(() => c.toHex(bad), /Hawiya\.color/);
  }
  assert.equal(c.toOklch('#F00').H, c.toOklch('#ff0000').H);
});

test('loads as a plain browser script (window.Hawiya.color) next to other modules', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'picker', 'js', 'core', 'color.js'), 'utf8');
  const sandbox = { self: { Hawiya: { existing: true } } };
  vm.runInNewContext(src, sandbox);
  assert.equal(sandbox.self.Hawiya.existing, true);
  assert.equal(sandbox.self.Hawiya.color.toHex(sandbox.self.Hawiya.color.toOklch('#7c3aed')), '#7c3aed');
});
