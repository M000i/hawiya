'use strict';

/*
 * Blocking rules (task 2.14, R-026): one case that passes and one that is blocked for each rule, the contrast
 * suggestion, the whole identity, and color derivation at AAA (modes.derive level, B-034).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const rules = require('../picker/js/core/rules.js');
const modes = require('../picker/js/core/modes.js');
const contrast = require('../picker/js/core/contrast.js');
const ramp = require('../picker/js/core/ramp.js');
const resolve = require('../picker/js/core/resolve.js');
const build = require('../tools/build.js');

const data = build.select(build.load(path.join(__dirname, '..', 'library'))).data;
const find = (element, id) => (data.templates[element] || []).find((t) => t.id === id) || null;
const AR = { language: 'ar', direction: 'rtl', platform: 'web', type: 'web-app', contrast: 'AA' };
const EN = { ...AR, language: 'en', direction: 'ltr' };
const BOTH = { ...AR, language: 'ar+en', direction: 'both' };
const rulesOf = (problems) => problems.map((p) => p.rule);

function identityOf(id, { primary, secondary, contrast: level, direction } = {}) {
  const ready = data.identities.find((i) => i.id === id);
  const selections = {};
  for (const [element, template] of Object.entries(ready.templates)) selections[element] = { template };
  if (primary || secondary) selections.colors.overrides = {};
  if (primary) selections.colors.overrides.primary = primary;
  if (secondary) selections.colors.overrides.secondary = secondary;
  if (direction) selections.direction = { template: direction };
  return resolve.resolve({ name: 'Rules', selections, project: { contrast: level || 'AA' } }, data);
}

/* ---------- rule 1: the font supports the project language ---------- */

test('font-language: a bilingual pair passes in every project; an Arabic-only font is blocked in English', () => {
  const pair = find('fonts', 'pair-plex-arabic-plex-sans');
  const kufi = find('fonts', 'font-noto-kufi-arabic');
  const inter = find('fonts', 'font-inter');
  for (const p of [AR, EN, BOTH]) assert.deepEqual(rules.template(pair, p), [], p.language);
  assert.deepEqual(rules.template(kufi, AR), []);
  assert.deepEqual(rules.template(kufi, EN), [
    { rule: 'font-language', element: 'fonts', template: 'font-noto-kufi-arabic', language: 'en', missing: ['en'] }
  ]);
  assert.deepEqual(rulesOf(rules.template(kufi, BOTH)), ['font-language']);
  assert.deepEqual(rules.template(inter, EN), []);
  assert.deepEqual(rules.template(inter, AR)[0].missing, ['ar']);
  assert.equal(rules.allowed(inter, AR), false);
  assert.equal(rules.allowed(inter, EN), true);
  // A font with no recorded languages cannot be shown to fit.
  assert.deepEqual(rulesOf(rules.template({ ...pair, extras: {} }, AR)), ['font-language']);
});

test('font-language on the identity: heading and body need the scripts of the project language', () => {
  const ok = identityOf('calm-corporate');
  assert.deepEqual(
    rules.identity(ok, find).problems.filter((p) => p.rule.startsWith('font')),
    []
  );
  // An English-only font in an Arabic project (built by hand: resolve does not stop it).
  const bad = structuredClone(ok);
  bad.tokens.font.heading = { latin: 'Inter', fallback: ['sans-serif'] };
  bad.selections.fonts = { template: 'font-inter' };
  const r = rules.identity(bad, find);
  assert.equal(r.allowed, false);
  assert.deepEqual(
    r.problems.filter((p) => p.rule === 'font-language').map((p) => p.role || p.template),
    ['font-inter', 'heading']
  );
  // Eastern Arabic numerals need a numerals font that draws them.
  const digits = structuredClone(ok);
  digits.extensions.numerals = 'arab';
  digits.tokens.font.numerals.easternArabicDigits = true;
  assert.deepEqual(rulesOf(rules.identity(digits, find).problems), []);
  digits.tokens.font.numerals.easternArabicDigits = false;
  assert.deepEqual(rulesOf(rules.identity(digits, find).problems), ['font-numerals']);
});

/* ---------- rule 2: contrast at the chosen level, both modes ---------- */

test('contrast: the verdict uses the exact ratio and the level; large text has its own thresholds', () => {
  assert.equal(rules.contrast('#767676', '#ffffff', 'AA').allowed, true);
  const r = rules.contrast('#777777', '#ffffff', 'AA');
  assert.deepEqual([r.allowed, r.shown, r.required], [false, 4.48, 4.5]);
  assert.ok(r.ratio > 4.47 && r.ratio < 4.5);
  assert.equal(rules.contrast('#777777', '#ffffff', 'AA', true).allowed, true); // 3:1 for large text
  assert.equal(rules.contrast('#767676', '#ffffff', 'AAA', true).allowed, true); // 4.5:1 for large text
  assert.equal(rules.contrast('#000000', '#ffffff', 'AAA').allowed, true);
  assert.throws(() => rules.contrast('#000000', '#ffffff', 'A'), /level/);
});

test('contrast suggestion: the nearest step of the same ramp that passes, on any background', () => {
  for (const [text, bg, level] of [
    ['#777777', '#ffffff', 'AA'],
    ['#3b82f6', '#ffffff', 'AA'],
    ['#3b82f6', '#ffffff', 'AAA'],
    ['#94a3b8', '#0f172a', 'AAA'],
    ['#f59e0b', '#ffffff', 'AA']
  ]) {
    const r = rules.contrast(text, bg, level);
    assert.equal(r.allowed, false, text);
    const steps = ramp.generate(text).steps;
    assert.ok(steps.includes(r.suggestion), `${text}: ${r.suggestion} is in its ramp`);
    assert.ok(contrast.ratio(r.suggestion, bg) >= r.required, `${text} → ${r.suggestion}`);
    // No passing step is nearer to the input than the suggestion.
    const L = (h) => require('../picker/js/core/color.js').toOklch(h).L;
    const d = Math.abs(L(r.suggestion) - L(text));
    for (const s of steps) {
      if (s !== text.toLowerCase() && contrast.ratio(s, bg) >= r.required) {
        assert.ok(Math.abs(L(s) - L(text)) >= d - 1e-12, `${text}: ${s} is nearer than ${r.suggestion}`);
      }
    }
  }
  // Nothing in the ramp can reach 7:1 on a mid gray: no suggestion rather than a wrong one.
  assert.equal(rules.contrast('#777777', '#808080', 'AAA').suggestion, null);
});

test('contrast on the identity: AA identities pass; a weak pair in either mode is blocked', () => {
  for (const id of ['calm-corporate', 'warm-friendly']) {
    const r = rules.identity(identityOf(id), find);
    assert.deepEqual([id, r.problems, r.unchecked], [id, [], []]);
    assert.equal(r.suggestion, null);
  }
  const weak = identityOf('calm-corporate');
  weak.tokens.color.dark.mutedText = weak.tokens.color.dark.surface; // invisible text in dark mode only
  const r = rules.identity(weak, find);
  assert.equal(r.allowed, false);
  assert.deepEqual(
    r.problems.map((p) => [p.rule, p.mode, p.text, p.on]),
    [
      ['contrast', 'dark', 'mutedText', 'background'],
      ['contrast', 'dark', 'mutedText', 'surface']
    ]
  );
});

test('contrast at AAA: a primary whose button text misses 7:1 is blocked, and the suggested primary passes', () => {
  const blocked = identityOf('calm-corporate', { primary: '#3B82F6', contrast: 'AAA' });
  const r = rules.identity(blocked, find);
  assert.equal(r.allowed, false);
  assert.ok(r.problems.every((p) => p.rule === 'contrast' && p.required === 7));
  assert.ok(r.problems.some((p) => p.mode === 'light' && p.text === 'onPrimary'));
  // The palette's own secondary (#7c3aed) misses 7:1 too, so both colors are suggested.
  assert.ok(r.problems.some((p) => p.mode === 'light' && p.text === 'onSecondary'));
  assert.deepEqual(Object.keys(r.suggestion.overrides), ['primary', 'secondary']);
  assert.ok(ramp.generate('#3b82f6').steps.includes(r.suggestion.overrides.primary));
  assert.ok(ramp.generate('#7c3aed').steps.includes(r.suggestion.overrides.secondary));
  // Applying the suggestion gives an identity that passes every rule.
  const fixed = identityOf('calm-corporate', { ...r.suggestion.overrides, contrast: 'AAA' });
  assert.deepEqual(rules.identity(fixed, find).problems, []);
  // The same color is fine at AA.
  assert.deepEqual(rules.identity(identityOf('calm-corporate', { primary: '#3B82F6' }), find).problems, []);
});

test('contrast at AAA: a chosen secondary that fails is fixed through the secondary; both when both fail', () => {
  const id = identityOf('calm-corporate', { primary: '#1e3a8a', secondary: '#3b82f6', contrast: 'AAA' });
  const r = rules.identity(id, find);
  assert.equal(r.allowed, false);
  assert.deepEqual(
    r.problems.map((p) => [p.mode, p.text]),
    [['light', 'onSecondary']]
  );
  assert.deepEqual(Object.keys(r.suggestion.overrides), ['secondary']);
  assert.ok(ramp.generate('#3b82f6').steps.includes(r.suggestion.overrides.secondary));
  const fixed = identityOf('calm-corporate', { primary: '#1e3a8a', ...r.suggestion.overrides, contrast: 'AAA' });
  assert.deepEqual(rules.identity(fixed, find).problems, []);

  const both = rules.identity(
    identityOf('calm-corporate', { primary: '#3b82f6', secondary: '#0065ed', contrast: 'AAA' }),
    find
  );
  assert.deepEqual(Object.keys(both.suggestion.overrides).sort(), ['primary', 'secondary']);
  const fixedBoth = identityOf('calm-corporate', { ...both.suggestion.overrides, contrast: 'AAA' });
  assert.deepEqual(rules.identity(fixedBoth, find).problems, []);
});

/* ---------- rule 3: no letter-spacing, uppercase or italic with Arabic ---------- */

test('arabic-typography: blocked in Arabic and bilingual projects, allowed in English ones', () => {
  const button = find('buttons', 'button-solid');
  for (const p of [AR, EN, BOTH]) assert.deepEqual(rules.template(button, p), []);
  const css = (extra) => ({ ...button, recipe: { ...button.recipe, css: button.recipe.css + extra } });
  const cases = [
    ['.hw-btn{letter-spacing:.05em}', 'letter-spacing'],
    ['.hw-btn{text-transform:uppercase}', 'text-transform'],
    ['.hw-btn{text-transform: Capitalize !important}', 'text-transform'],
    ['.hw-btn{font-style:italic}', 'font-style'],
    ['.hw-btn{font:italic 600 1rem/1.2 sans-serif}', 'font-style'],
    ['.hw-btn{font-style:oblique 10deg}', 'font-style']
  ];
  for (const [extra, property] of cases) {
    const t = css(extra);
    assert.deepEqual(
      rules.template(t, AR),
      [{ rule: 'arabic-typography', element: 'buttons', template: 'button-solid', property, where: 'recipe' }],
      extra
    );
    assert.deepEqual(rulesOf(rules.template(t, BOTH)), ['arabic-typography'], extra);
    assert.deepEqual(rules.template(t, EN), [], extra);
  }
  // Values that change nothing are not blocked; comments are not CSS.
  for (const extra of [
    '.hw-btn{letter-spacing:normal}',
    '.hw-btn{letter-spacing:0}',
    '.hw-btn{letter-spacing:0em}',
    '.hw-btn{text-transform:none}',
    '.hw-btn{font-style:normal}',
    '/* letter-spacing:2px; text-transform:uppercase */'
  ]) {
    assert.deepEqual(rules.template(css(extra), AR), [], extra);
  }
  // In tokens.
  const tokens = (t) => ({ ...button, tokens: { button: t } });
  assert.deepEqual(
    rules
      .template(tokens({ letterSpacing: { $type: 'dimension', $value: { value: 0.5, unit: 'px' } } }), AR)
      .map((p) => [p.property, p.where]),
    [['letter-spacing', 'tokens']]
  );
  assert.deepEqual(rules.template(tokens({ letterSpacing: { $value: { value: 0, unit: 'px' } } }), AR), []);
  assert.deepEqual(
    rules
      .template(tokens({ label: { textTransform: { $value: 'uppercase' }, fontStyle: { $value: 'italic' } } }), AR)
      .map((p) => p.property),
    ['text-transform', 'font-style']
  );
});

/* ---------- rule 4: platform templates stay on their platform ---------- */

test('platform: a template for other platforms is blocked in a web project', () => {
  const card = find('cards', 'card-bordered');
  assert.deepEqual(rules.template(card, AR), []);
  const mobileOnly = { ...card, platforms: ['mobile'] };
  assert.deepEqual(rules.template(mobileOnly, AR), [
    { rule: 'platform', element: 'cards', template: 'card-bordered', platform: 'web' }
  ]);
  assert.equal(rules.allowed({ ...card, platforms: ['web', 'mobile'] }, AR), true);
});

test('every published template and both ready identities pass the rules in the projects they are for', () => {
  for (const [element, list] of Object.entries(data.templates)) {
    for (const t of list) {
      const langs = element === 'fonts' ? t.extras.languages : ['ar', 'en'];
      const projects = [AR, EN, BOTH].filter((p) => p.language.split('+').every((l) => langs.includes(l)));
      for (const p of projects) assert.deepEqual(rules.template(t, p), [], `${t.id} in ${p.language}`);
    }
  }
});

test('elements whose data is not loaded are listed as unchecked, not passed', () => {
  const id = identityOf('warm-friendly');
  const r = rules.identity(id, (element, tid) => (element === 'buttons' ? null : find(element, tid)));
  assert.deepEqual(r.unchecked, ['buttons']);
});

/* ---------- color derivation at AAA (modes.derive level) ---------- */

test('modes.derive at AAA: every text color reaches 7:1, dark fills keep 7:1 text, AA output is unchanged', () => {
  const required = 7;
  const seeds = [];
  for (let h = 0; h < 360; h += 15) {
    for (const [L, C] of [
      [0.35, 0.12],
      [0.55, 0.15],
      [0.7, 0.12],
      [0.85, 0.08]
    ]) {
      seeds.push(require('../picker/js/core/color.js').toHex({ L, C, H: h }));
    }
  }
  seeds.push('#000000', '#ffffff', '#777777', '#3b82f6', '#ffff00');
  for (const seed of seeds) {
    const m = modes.derive(seed, { level: 'AAA' });
    const problems = rules
      .colors(m, 'AAA')
      // The chosen primary in light mode is kept as chosen: only its button text may miss (rules block it).
      .filter((p) => !(p.mode === 'light' && p.text === 'onPrimary'));
    assert.deepEqual(problems, [], seed);
    assert.deepEqual(modes.derive(seed, { level: 'AA' }), modes.derive(seed), seed);
    assert.deepEqual(rules.colors(modes.derive(seed), 'AA'), [], `${seed} at AA`);
  }
  assert.throws(() => modes.derive('#3b82f6', { level: 'AAAA' }), /level/);
  // The derived secondary is a step of its own ramp whose text reaches 7:1.
  const m = modes.derive('#3b82f6', { level: 'AAA' });
  assert.ok(m.ramps.secondary.includes(m.light.secondary));
  assert.ok(contrast.ratio(m.light.onSecondary, m.light.secondary) >= required);
});

test('resolve passes the project level to the colors: AAA identities have AAA text colors', () => {
  const aa = identityOf('calm-corporate');
  const aaa = identityOf('calm-corporate', { contrast: 'AAA' });
  assert.equal(aaa.project.contrast, 'AAA');
  assert.ok(contrast.ratio(aaa.tokens.color.light.mutedText, aaa.tokens.color.light.background) >= 7);
  assert.ok(contrast.ratio(aa.tokens.color.light.mutedText, aa.tokens.color.light.background) < 7);
});

test('loads as plain browser scripts after color, contrast, ramp and modes, and gives the same answers', () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const dir = path.join(__dirname, '..', 'picker', 'js', 'core');
  const sandbox = { self: {} };
  for (const f of ['color.js', 'contrast.js', 'ramp.js', 'modes.js', 'recipe.js', 'rules.js']) {
    vm.runInNewContext(fs.readFileSync(path.join(dir, f), 'utf8'), sandbox);
  }
  const out = vm.runInNewContext("JSON.stringify(self.Hawiya.rules.contrast('#777777', '#ffffff', 'AA'))", sandbox);
  assert.equal(out, JSON.stringify(rules.contrast('#777777', '#ffffff', 'AA')));
  // Loaded before its dependencies, it says what is missing.
  assert.throws(
    () => vm.runInNewContext(fs.readFileSync(path.join(dir, 'rules.js'), 'utf8'), { self: {} }),
    /load color\.js, contrast\.js, ramp\.js, modes\.js and recipe\.js first/
  );
});

// AA output is exactly what it was before the AAA option (task 2.14): the fingerprint below was taken from
// modes.js as committed in task 2.13 (86f4ffc), over 864 colors, with and without a given secondary.
test('modes.derive at AA gives exactly the colors it gave before the AAA option', () => {
  const crypto = require('node:crypto');
  const color = require('../picker/js/core/color.js');
  const seeds = [];
  for (let h = 0; h < 360; h += 10) {
    for (const L of [0.2, 0.35, 0.5, 0.65, 0.8, 0.95]) {
      for (const C of [0, 0.04, 0.1, 0.2]) seeds.push(color.toHex({ L, C, H: h }));
    }
  }
  const out = seeds.map((s) => [s, modes.derive(s), modes.derive(s, { secondary: '#7c3aed' })]);
  assert.equal(seeds.length, 864);
  assert.equal(
    crypto.createHash('sha256').update(JSON.stringify(out)).digest('hex'),
    '1d6e37b44327c375435a63ec2c798e277c919bd6f5470119b49fa8c886f2140e'
  );
});

test('a ratio just under the threshold is blocked even though it is close to 4.5', () => {
  const r = rules.contrast('#006ffb', '#ffffff', 'AA');
  assert.ok(r.ratio > 4.4998 && r.ratio < 4.5);
  assert.deepEqual([r.allowed, r.shown], [false, 4.49]);
});

/* ---------- from the independent review ---------- */

test('review A: the suggestion keeps the palette secondary even when the palette data is not loaded', () => {
  const id = identityOf('calm-corporate', { primary: '#3b82f6', contrast: 'AAA' });
  const noColors = (element, tid) => (element === 'colors' ? null : find(element, tid));
  const r = rules.identity(id, noColors);
  assert.deepEqual(r.unchecked, ['colors']);
  assert.deepEqual(Object.keys(r.suggestion.overrides), ['primary', 'secondary']);
  const fixed = identityOf('calm-corporate', { ...r.suggestion.overrides, contrast: 'AAA' });
  assert.deepEqual(rules.identity(fixed, find).problems, []);
});

test('review: a palette is offered only at the contrast level it reaches', () => {
  let aaa = 0;
  for (const t of data.templates.colors) {
    assert.equal(rules.allowed(t, AR), true, `${t.id} at AA`);
    const p = rules.template(t, { ...AR, contrast: 'AAA' });
    // A palette that declares AAA reaches 7:1 everywhere; one that declares AA is blocked at AAA, by contrast only.
    if (t.a11y.contrast === 'AAA') {
      aaa++;
      assert.deepEqual(p, [], `${t.id} declares AAA`);
    } else assert.ok(p.length > 0 && p.every((x) => x.rule === 'contrast' && x.template === t.id), `${t.id} at AAA`);
  }
  assert.ok(aaa > 0 && aaa < data.templates.colors.length, `${aaa} AAA palettes`);
});

test('review: italic tags, inline styles, custom properties, small caps and slant are blocked with Arabic', () => {
  const button = find('buttons', 'button-solid');
  const recipe = (html, css) => ({ ...button, recipe: { html, css: css === undefined ? button.recipe.css : css } });
  // The Arabic typography problems (a recipe outside the allow-list is also refused on its own, rule "recipe").
  const props = (t, p = AR) =>
    rules
      .template(t, p)
      .filter((x) => x.rule === 'arabic-typography')
      .map((x) => x.property);
  const btn = '<button class="hw-btn" type="button">{label}</button>';
  assert.deepEqual(props(recipe('<button class="hw-btn" style="letter-spacing:2px">{label}</button>')), [
    'letter-spacing'
  ]);
  assert.deepEqual(props(recipe("<button style='font-style: italic'>{label}</button>")), ['font-style']);
  assert.deepEqual(props(recipe('<button><em>{label}</em></button>')), ['font-style']);
  assert.deepEqual(props(recipe('<button><i>{label}</i></button>')), ['font-style']);
  assert.deepEqual(props(recipe('<button><em>{label}</em></button>'), EN), []);
  // Words that only look like tags or styles are not blocked.
  assert.deepEqual(props(recipe('<button><img alt="i"><input>{label}</button>')), []);
  assert.deepEqual(props(recipe(btn, '.hw-btn{--tt:uppercase;text-transform:var(--tt)}')), ['text-transform']);
  assert.deepEqual(props(recipe(btn, '.hw-btn{--tt:none;text-transform:var(--tt)}')), []);
  assert.deepEqual(props(recipe(btn, '.hw-btn{--s:italic}.hw-btn b{font-style:var(--s)}')), ['font-style']);
  assert.deepEqual(props(recipe(btn, '.hw-btn{letter-spacing:var(--unknown)}')), ['letter-spacing']);
  assert.deepEqual(props(recipe(btn, '.hw-btn{font-variant:small-caps}')), ['text-transform']);
  assert.deepEqual(props(recipe(btn, '.hw-btn{font-variant-caps:all-small-caps}')), ['text-transform']);
  assert.deepEqual(props(recipe(btn, '.hw-btn{font-variant-numeric:tabular-nums}')), []);
  assert.deepEqual(props(recipe(btn, ".hw-btn{font-variation-settings:'slnt' -10}")), ['font-style']);
  assert.deepEqual(props(recipe(btn, '.hw-btn{font-variation-settings:"ital" 1}')), ['font-style']);
  assert.deepEqual(props(recipe(btn, ".hw-btn{font-variation-settings:'wght' 600, 'slnt' 0}")), []);
  // Second review round: nested custom properties, the font shorthand, unknown values, unquoted styles.
  assert.deepEqual(props(recipe(btn, '.hw-btn{--b:uppercase;--a:var(--b);text-transform:var(--a)}')), [
    'text-transform'
  ]);
  assert.deepEqual(props(recipe(btn, '.hw-btn{font:small-caps 1rem sans-serif}')), ['text-transform']);
  assert.deepEqual(props(recipe(btn, '.hw-btn{font:italic small-caps 1rem sans-serif}')), [
    'text-transform',
    'font-style'
  ]);
  assert.deepEqual(props(recipe(btn, '.hw-btn{font:var(--f)}')), ['text-transform', 'font-style']);
  assert.deepEqual(props(recipe(btn, '.hw-btn{font-variant:var(--v)}')), ['text-transform']);
  assert.deepEqual(props(recipe('<button style=letter-spacing:2px>{label}</button>')), ['letter-spacing']);
  assert.deepEqual(props(recipe(btn, ".hw-btn{font-variation-settings:'ital'1}")), ['font-style']);
  // Values that change nothing.
  assert.deepEqual(props(recipe(btn, '.hw-btn{font:600 1rem/1 "Small-Caps Sans", sans-serif}')), []);
  assert.deepEqual(props(recipe(btn, '.hw-btn{font:600 1rem/1 "Oblique Sans", sans-serif}')), []);
  assert.deepEqual(props(recipe(btn, '.hw-btn{letter-spacing:calc(0px)}')), []);
  const zero = { ...button, tokens: { button: { letterSpacing: { $value: { value: '0', unit: 'px' } } } } };
  assert.deepEqual(props(zero), []);
});

test('review: Eastern Arabic numerals need a numerals font recorded to draw them', () => {
  const id = identityOf('calm-corporate');
  id.extensions.numerals = 'arab';
  delete id.tokens.font.numerals.easternArabicDigits; // not tested
  assert.deepEqual(rulesOf(rules.identity(id, find).problems), ['font-numerals']);
  id.tokens.font.numerals = { latin: 'Inter', fallback: ['sans-serif'] };
  assert.deepEqual(rulesOf(rules.identity(id, find).problems), ['font-numerals']);
  id.tokens.font.numerals = { arabic: 'Cairo', fallback: ['sans-serif'], easternArabicDigits: true };
  assert.deepEqual(rulesOf(rules.identity(id, find).problems), []);
});

/* ---------- warning rules (task 2.15, R-027 / R-091) ---------- */

const warn = (id, f = find) => rules.warnings(id, f).warnings.map((w) => w.rule);
// The library with one template replaced (warning cases the published library does not have yet).
const withTemplate = (element, id, change) => (e, tid) => {
  const t = find(e, tid);
  return e === element && tid === id && t ? change(structuredClone(t)) : t;
};

test('warnings: the ready identities have none, and the result lists unloaded elements', () => {
  for (const id of ['calm-corporate', 'warm-friendly']) {
    assert.deepEqual(rules.warnings(identityOf(id), find), { warnings: [], unchecked: [] }, id);
  }
  const r = rules.warnings(identityOf('calm-corporate'), (e, tid) => (e === 'fonts' ? null : find(e, tid)));
  assert.deepEqual(r.unchecked, ['fonts']);
});

test('thin-icons-heavy-font: light icons with a heavy font warn; regular icons or a regular font do not', () => {
  const id = identityOf('calm-corporate');
  const font = id.selections.fonts.template;
  const heavy = withTemplate('fonts', font, (t) => ({ ...t, extras: { ...t.extras, weight: 700 } }));
  const regular = withTemplate('fonts', font, (t) => ({ ...t, extras: { ...t.extras, weight: 400 } }));
  const light = structuredClone(id);
  light.extensions.icons.weight = 'light';
  light.selections.icons = { template: 'icons-lucide-light' };
  assert.deepEqual(rules.warnings(light, heavy).warnings, [
    { rule: 'thin-icons-heavy-font', element: 'icons', icons: 'light', fontWeight: 700 }
  ]);
  assert.deepEqual(warn(light, regular), []);
  assert.deepEqual(warn(light, find), []); // no weight recorded: no claim
  assert.deepEqual(warn(id, heavy), []); // regular icons
});

test('button-radius-over-card: a button rounder than the card warns; equal or smaller does not', () => {
  const id = identityOf('calm-corporate'); // button uses radius md (8), card radius lg (12)
  assert.deepEqual(warn(id), []);
  const same = structuredClone(id);
  same.tokens.radius.md = 12;
  assert.deepEqual(warn(same), []);
  const over = structuredClone(id);
  over.tokens.radius.md = 16;
  assert.deepEqual(rules.warnings(over, find).warnings, [
    { rule: 'button-radius-over-card', element: 'radius', button: 16, card: 12 }
  ]);
  // A pill button (radius full) inside a rounded card.
  const pill = withTemplate('buttons', id.selections.buttons.template, (t) => {
    t.recipe.css = t.recipe.css.replace('var(--radius-md)', 'var(--radius-full)');
    return t;
  });
  assert.deepEqual(warn(id, pill), ['button-radius-over-card']);
  // A radius written in px is read too.
  const px = withTemplate('cards', id.selections.cards.template, (t) => {
    t.recipe.css = t.recipe.css.replace('var(--radius-lg)', '4px');
    return t;
  });
  assert.deepEqual(rules.warnings(id, px).warnings[0], {
    rule: 'button-radius-over-card',
    element: 'radius',
    button: 8,
    card: 4
  });
});

test('dark-shadows-vanish: a shadow seen in light mode but not on the dark background warns', () => {
  const id = identityOf('calm-corporate');
  assert.deepEqual(warn(id), []);
  // The light shadow (soft: sm, md and lg) copied as is into dark mode: too faint on a near-black background.
  const copied = structuredClone(id);
  copied.tokens.shadow.dark = structuredClone(copied.tokens.shadow.light);
  assert.deepEqual(rules.warnings(copied, find).warnings, [
    { rule: 'dark-shadows-vanish', element: 'shadows', levels: ['sm', 'md', 'lg'] }
  ]);
  // No shadow in dark mode while light mode has one.
  const none = structuredClone(id);
  none.tokens.shadow.dark.lg = [];
  assert.deepEqual(rules.warnings(none, find).warnings[0].levels, ['lg']);
  // No shadow at all (strength 0): nothing is lost, no warning.
  const flat = identityOf('calm-corporate');
  for (const m of ['light', 'dark']) for (const k of ['sm', 'md', 'lg']) flat.tokens.shadow[m][k] = [];
  assert.deepEqual(warn(flat), []);
  // Shadow strength 0 keeps the layers at opacity 0 in both modes: nothing to lose either.
  const ready = data.identities.find((i) => i.id === 'calm-corporate');
  const selections = {};
  for (const [element, template] of Object.entries(ready.templates)) selections[element] = { template };
  selections.shadows.overrides = { strength: 0 };
  const zero = resolve.resolve({ name: 'Zero', selections }, data);
  assert.ok(zero.tokens.shadow.light.md.length > 0 && zero.tokens.shadow.light.md.every((l) => l.alpha === 0));
  assert.deepEqual(warn(zero), []);
});

test('arabic-line-height: below 1.6 warns in Arabic and bilingual projects, never in English ones (R-091)', () => {
  const id = identityOf('calm-corporate');
  for (const [lh, expected] of [
    [1.6, []],
    [1.8, []],
    [1.59, ['arabic-line-height']],
    [1.2, ['arabic-line-height']]
  ]) {
    const x = structuredClone(id);
    x.tokens.font.lineHeight.ar = lh;
    assert.deepEqual(warn(x), expected, String(lh));
  }
  const low = structuredClone(id);
  low.tokens.font.lineHeight.ar = 1.4;
  assert.deepEqual(rules.warnings(low, find).warnings, [
    { rule: 'arabic-line-height', element: 'type-scale', lineHeight: 1.4, minimum: 1.6 }
  ]);
  low.project = { ...low.project, language: 'ar+en' };
  assert.deepEqual(warn(low), ['arabic-line-height']);
  low.project = { ...low.project, language: 'en' };
  assert.deepEqual(warn(low), []);
});

test('display-font-body: a display font warns, because it is also the body font', () => {
  const id = identityOf('warm-friendly');
  const font = id.selections.fonts.template;
  const display = withTemplate('fonts', font, (t) => ({ ...t, extras: { ...t.extras, display: true } }));
  const text = withTemplate('fonts', font, (t) => ({ ...t, extras: { ...t.extras, display: false } }));
  assert.deepEqual(rules.warnings(id, display).warnings, [
    { rule: 'display-font-body', element: 'fonts', template: font }
  ]);
  assert.deepEqual(warn(id, text), []);
  assert.deepEqual(warn(id), []);
});

test('warnings never block: a warned identity still passes the blocking rules', () => {
  const id = identityOf('calm-corporate');
  id.tokens.font.lineHeight.ar = 1.4;
  id.tokens.radius.md = 16;
  assert.deepEqual(warn(id), ['button-radius-over-card', 'arabic-line-height']);
  assert.equal(rules.identity(id, find).allowed, true);
});
