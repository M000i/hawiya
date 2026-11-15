'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const Ajv2020 = require('ajv/dist/2020');

const modes = require('../picker/js/core/modes.js');
const contrast = require('../picker/js/core/contrast.js');
const color = require('../picker/js/core/color.js');

const INPUTS = [
  '#808080', '#767676', '#000000', '#ffffff', '#111827',
  '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff',
  '#3b82f6', '#7c3aed', '#0f766e', '#facc15', '#b91c1c', '#1f2937',
  '#fefefe', '#010101', '#feffff'
];

// The tokens.color part of the identity schema (task 1.1) — the shape this module must produce.
const ajv = new Ajv2020({ strict: true, strictRequired: false, allowUnionTypes: true, allErrors: true });
ajv.addSchema(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'schema', 'identity.schema.json'), 'utf8')));
const validateColor = ajv.getSchema('urn:hawiya:schema:identity:1#/properties/tokens/properties/color');

const TEXT_ROLES = ['onSurface', 'mutedText', 'accentText', 'success', 'warning', 'danger', 'info'];

for (const hex of INPUTS) {
  test(`modes properties: ${hex}`, () => {
    const m = modes.derive(hex);

    // Exactly the identity schema shape (all 14 roles, lowercase hex, 11-step ramps).
    assert.ok(validateColor(m), JSON.stringify(validateColor.errors));
    assert.deepEqual(Object.keys(m.light), modes.KEYS);
    assert.deepEqual(Object.keys(m.dark), modes.KEYS);

    // Light mode keeps the input as the primary.
    assert.equal(m.light.primary, color.normalizeHex(hex));

    for (const mode of ['light', 'dark']) {
      const s = m[mode];
      // Every text role is readable (AA) on BOTH the background and the surface.
      for (const role of TEXT_ROLES) {
        for (const bg of ['background', 'surface']) {
          const r = contrast.ratio(s[role], s[bg]);
          assert.ok(r >= 4.5, `${mode} ${role} ${s[role]} on ${bg} ${s[bg]}: ${r.toFixed(2)}`);
        }
      }
      // Text on the filled buttons.
      assert.ok(contrast.ratio(s.onPrimary, s.primary) >= 4.5, `${mode} onPrimary`);
      assert.ok(contrast.ratio(s.onSecondary, s.secondary) >= 4.5, `${mode} onSecondary`);
      // Background and surface are different but close; muted text is softer than main text.
      assert.notEqual(s.background, s.surface, `${mode} background equals surface`);
      assert.ok(contrast.ratio(s.background, s.surface) < 1.5, `${mode} surface too far from background`);
      assert.ok(contrast.ratio(s.mutedText, s.background) < contrast.ratio(s.onSurface, s.background), `${mode} muted not softer`);
      // The border is visible against the surface it sits on, without being text-strong.
      const b = contrast.ratio(s.border, s.surface);
      assert.ok(b > 1.15 && b < 4.5, `${mode} border contrast ${b.toFixed(2)}`);
      // Muted text is clearly softer than main text (not just marginally).
      assert.ok(contrast.ratio(s.mutedText, s.background) <= 0.6 * contrast.ratio(s.onSurface, s.background), `${mode} muted too close to main text`);
      // Links come from the brand's own ramp (never the fallback text color).
      assert.ok(m.ramps.primary.includes(s.accentText), `${mode} accentText ${s.accentText} not in the primary ramp`);
    }

    // Surfaces: in light mode the surface is a touch darker than the page, in dark mode a touch lighter.
    const L = (h) => color.toOklch(h).L;
    assert.ok(L(m.light.surface) < L(m.light.background), 'light surface should be darker than the page');
    assert.ok(L(m.dark.surface) > L(m.dark.background), 'dark surface should be lighter than the page');

    // Dark-mode fills: visible on the dark page and surface (3:1), and never darker than the input's own step.
    for (const role of ['primary', 'secondary']) {
      for (const bg of ['background', 'surface']) {
        const r = contrast.ratio(m.dark[role], m.dark[bg]);
        assert.ok(r >= 3, `dark ${role} ${m.dark[role]} on ${bg} ${m.dark[bg]}: ${r.toFixed(2)}`);
      }
    }
    // (Very pale inputs at steps 0–1 are deliberately toned down to step 2: a near-white fill glares in dark mode.)
    const notDarker = (r, darkHex, lightHex) => r.indexOf(darkHex) <= Math.max(r.indexOf(lightHex), 2);
    assert.ok(notDarker(m.ramps.primary, m.dark.primary, m.light.primary), 'dark primary darker than the input');
    assert.ok(notDarker(m.ramps.secondary, m.dark.secondary, m.light.secondary), 'dark secondary darker than light');

    // The automatic secondary is a muted version of the primary's hue (gray for a gray primary).
    const sc = color.toOklch(m.light.secondary).C;
    if (color.isAchromatic(color.toOklch(hex))) assert.ok(sc < 1e-3, `secondary ${m.light.secondary} should be gray`);
    else assert.ok(sc <= 0.055, `secondary ${m.light.secondary} too colorful (${sc.toFixed(3)})`);

    // Light is light and dark is dark.
    assert.ok(color.toOklch(m.light.background).L > 0.9);
    assert.ok(color.toOklch(m.dark.background).L < 0.25);
    assert.ok(color.toOklch(m.dark.onSurface).L > 0.9);

    // Neutrals: pure gray for a gray primary, otherwise only a faint tint.
    const po = color.toOklch(hex);
    for (const n of m.ramps.neutral) {
      const no = color.toOklch(n);
      if (color.isAchromatic(po)) assert.ok(no.C < 1e-3, `neutral ${n} should be gray`);
      else assert.ok(no.C < 0.03, `neutral ${n} too colorful (${no.C.toFixed(3)})`);
    }

    // Same input, same output.
    assert.deepEqual(modes.derive(hex), m);
  });
}

test('near-gray primaries (hue = rounding noise) give near-gray neutrals and secondary', () => {
  for (const hex of ['#808081', '#7f8080', '#feffff', '#fffdf8', '#010101', '#fefefe']) {
    const m = modes.derive(hex);
    const pc = color.toOklch(hex).C;
    const sc = color.toOklch(m.light.secondary).C;
    assert.ok(sc < 0.01, `${hex}: secondary ${m.light.secondary} C ${sc.toFixed(4)}`);
    for (const n of m.ramps.neutral) {
      const nc = color.toOklch(n).C;
      assert.ok(nc < Math.max(0.004, pc), `${hex}: neutral ${n} C ${nc.toFixed(4)} vs primary C ${pc.toFixed(4)}`);
    }
  }
  // A real brand color still gets the full tint.
  assert.ok(color.toOklch(modes.derive('#3b82f6').light.secondary).C > 0.04);
});

test('a given secondary color is used as-is in light mode', () => {
  const m = modes.derive('#3b82f6', { secondary: '#F97316' });
  assert.equal(m.light.secondary, '#f97316');
  assert.ok(m.ramps.secondary.includes('#f97316'));
  assert.ok(contrast.ratio(m.dark.onSecondary, m.dark.secondary) >= 4.5);
});

test('status colors keep their meaning (hue family) in both modes', () => {
  const hueOf = (h) => color.toOklch(h).H;
  const m = modes.derive('#7c3aed');
  for (const mode of ['light', 'dark']) {
    const s = m[mode];
    assert.ok(hueOf(s.success) > 120 && hueOf(s.success) < 170, `${mode} success hue ${hueOf(s.success)}`);
    assert.ok(hueOf(s.warning) > 40 && hueOf(s.warning) < 90, `${mode} warning hue ${hueOf(s.warning)}`);
    assert.ok(hueOf(s.danger) < 40 || hueOf(s.danger) > 350, `${mode} danger hue ${hueOf(s.danger)}`);
    assert.ok(hueOf(s.info) > 230 && hueOf(s.info) < 280, `${mode} info hue ${hueOf(s.info)}`);
  }
});

test('refuses bad input', () => {
  for (const bad of ['blue', '#12345', '', null]) assert.throws(() => modes.derive(bad), /Hawiya\.color/);
  assert.throws(() => modes.derive('#3b82f6', { secondary: 'orange' }), /Hawiya\.color/);
});

test('loads as a plain browser script after color, contrast and ramp; refuses to load without them', () => {
  const dir = path.join(__dirname, '..', 'picker', 'js', 'core');
  const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
  const ok = { self: {} };
  for (const f of ['color.js', 'contrast.js', 'ramp.js', 'modes.js']) vm.runInNewContext(read(f), ok);
  assert.deepEqual(JSON.parse(JSON.stringify(ok.self.Hawiya.modes.derive('#3b82f6'))), modes.derive('#3b82f6'));
  const partial = { self: {} };
  vm.runInNewContext(read('color.js'), partial);
  assert.throws(() => vm.runInNewContext(read('modes.js'), partial), /load color\.js, contrast\.js and ramp\.js first/);
});
