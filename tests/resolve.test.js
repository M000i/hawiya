'use strict';
// Task 2.4 (R-070, R-091): choices (a template per element + adjustments) → a complete identity
// that passes the identity checker, the same every time.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const resolve = require('../picker/js/core/resolve.js');
const validate = require('../picker/js/core/validate.js');
const bundle = require('../picker/js/core/bundle.js');
const generate = require('../picker/js/core/generate.js');
const build = require('../tools/build.js');
const { launch } = require('./helpers/chrome.js');

const ROOT = path.join(__dirname, '..');
const LIB = path.join(ROOT, 'library');
const DATA = build.select(build.load(LIB)).data;
const E = resolve.ELEMENTS;

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    Object.keys(o).forEach((k) => deepFreeze(o[k]));
  }
  return o;
}
// The page's data is frozen; resolve must never try to change it.
const FROZEN = deepFreeze(JSON.parse(JSON.stringify(DATA)));

function fromIdentity(id) {
  const ready = DATA.identities.find((i) => i.id === id);
  const selections = {};
  for (const e of E) selections[e] = { template: ready.templates[e] };
  return { name: ready.name.ar, selections };
}
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const refused = (fn, pattern) =>
  assert.throws(fn, (e) => {
    assert.equal(e.name, 'ResolveError');
    assert.ok(Array.isArray(e.problems) && e.problems.length > 0);
    assert.match(e.problems.join(' | '), pattern);
    return true;
  });

test('both starter identities resolve to identities that pass the checker', () => {
  for (const id of ['calm-corporate', 'warm-friendly']) {
    const choices = fromIdentity(id);
    const identity = resolve.resolve(choices, FROZEN);
    const v = validate.check('identity', identity);
    assert.equal(v.valid, true, `${id}: ${JSON.stringify(v.errors)}`);
    // Arabic default line height (R-091).
    assert.ok(identity.tokens.font.lineHeight.ar >= 1.6 && identity.tokens.font.lineHeight.ar <= 1.8, id);
    // Every choice is recorded, with no adjustments.
    assert.deepEqual(Object.keys(identity.selections), E);
    for (const e of E) assert.deepEqual(identity.selections[e], { template: choices.selections[e].template });
    assert.deepEqual(identity.extensions.components, {
      button: choices.selections.buttons.template,
      card: choices.selections.cards.template
    });
    assert.deepEqual(identity.autoFilled, []);
    assert.deepEqual(identity.leaveToAI, []);
  }
});

test('values come from the chosen templates', () => {
  const calm = resolve.resolve(fromIdentity('calm-corporate'), FROZEN);
  assert.deepEqual(calm.project, {
    language: 'ar',
    direction: 'rtl',
    platform: 'web',
    type: 'web-app',
    contrast: 'AA'
  });
  assert.equal(calm.tokens.color.light.primary, '#2563eb');
  assert.equal(calm.tokens.color.ramps.primary.includes('#2563eb'), true);
  assert.equal(calm.tokens.color.ramps.secondary.includes('#7c3aed'), true);
  assert.deepEqual(calm.tokens.font.body, {
    arabic: 'IBM Plex Sans Arabic',
    latin: 'IBM Plex Sans',
    fallback: ['system-ui', 'sans-serif'],
    latinSizeAdjust: 1
  });
  assert.deepEqual(calm.tokens.font.lineHeight, { ar: 1.7, en: 1.5 });
  assert.deepEqual(calm.tokens.typeScale, { base: 16, ratio: 1.25, steps: [12.8, 16, 20, 25, 31.25, 39.06] });
  assert.deepEqual(calm.tokens.radius, { sm: 4, md: 8, lg: 12, full: 9999 });
  assert.deepEqual(calm.tokens.shadow.light.lg, [
    { x: 0, y: 12, blur: 32, spread: -4, color: '#000000', alpha: 0.12 },
    { x: 0, y: 2, blur: 4, spread: 0, color: '#000000', alpha: 0.05 }
  ]);
  assert.deepEqual(calm.tokens.spacing, { unit: 4, scale: [0, 4, 8, 12, 16, 24, 32, 48, 64] });
  assert.deepEqual(calm.extensions.icons, { library: 'lucide', weight: 'regular', fill: 'outline', container: 'none' });
  assert.deepEqual(calm.extensions.rtl, {
    logicalProperties: true,
    mirror: ['arrow', 'chevron', 'undo', 'redo'],
    neverMirror: ['clock', 'play', 'check', 'media']
  });
  assert.equal(calm.extensions.numerals, 'latn');
  assert.equal(calm.extensions.calendar, 'gregory');

  const warm = resolve.resolve(fromIdentity('warm-friendly'), FROZEN);
  assert.deepEqual([warm.project.language, warm.project.direction], ['ar+en', 'both']);
  // Cairo draws both scripts: no size adjustment between two copies of the same family.
  assert.deepEqual(warm.tokens.font.heading, {
    arabic: 'Cairo',
    latin: 'Cairo',
    fallback: ['system-ui', 'sans-serif']
  });
  assert.equal(warm.tokens.font.lineHeight.ar, 1.8);
  assert.deepEqual(warm.tokens.typeScale.steps, [12, 16, 21.33, 28.43, 37.9, 50.52]);
  assert.deepEqual(warm.tokens.shadow.dark.sm, [{ x: 0, y: 1, blur: 2, spread: 0, color: '#000000', alpha: 0.5 }]);
});

test('the language follows the direction template', () => {
  const pairs = { 'direction-rtl': ['ar', 'rtl'], 'direction-ltr': ['en', 'ltr'], 'direction-both': ['ar+en', 'both'] };
  for (const [tpl, want] of Object.entries(pairs)) {
    const c = fromIdentity('calm-corporate');
    c.selections.direction = { template: tpl };
    const id = resolve.resolve(c, FROZEN);
    assert.deepEqual([id.project.language, id.project.direction], want);
  }
});

test('adjustments are applied, normalized and recorded', () => {
  const c = fromIdentity('calm-corporate');
  c.selections.colors.overrides = { secondary: '#D97706', primary: '#3B82F6' };
  c.selections.fonts.overrides = { 'latin-size-adjust': 0.94 };
  c.selections['type-scale'].overrides = {
    ratio: 1.2,
    base: 18,
    steps: 5,
    below: 0,
    'line-height-ar': 1.65,
    'line-height-en': 1.4
  };
  c.selections.radius.overrides = { md: 20 };
  c.selections.icons.overrides = { fill: 'duotone', container: 'circle' };
  c.selections.spacing.overrides = { unit: 6 };
  c.selections.direction.overrides = { numerals: 'arab', calendar: 'islamic-umalqura' };
  c.project = { type: 'dashboard', contrast: 'AAA' };
  c.motion = 'none';
  c.autoFilled = ['shadows'];
  c.leaveToAI = ['illustrations'];
  const id = resolve.resolve(c, FROZEN);
  assert.equal(validate.check('identity', id).valid, true);
  assert.equal(id.tokens.color.light.primary, '#3b82f6');
  assert.ok(id.tokens.color.ramps.secondary.includes('#d97706'));
  assert.equal(id.tokens.font.numerals.latinSizeAdjust, 0.94);
  assert.deepEqual(id.tokens.font.lineHeight, { ar: 1.65, en: 1.4 });
  assert.deepEqual(id.tokens.typeScale, { base: 18, ratio: 1.2, steps: [18, 21.6, 25.92, 31.1, 37.32] });
  assert.deepEqual(id.tokens.radius, { sm: 4, md: 20, lg: 12, full: 9999 });
  assert.deepEqual([id.extensions.icons.fill, id.extensions.icons.container], ['duotone', 'circle']);
  // 4-px scale resized to a 6-px unit: 0, 4, 8, 12, 16, 24, 32, 48, 64 → ×1.5.
  assert.deepEqual(id.tokens.spacing, { unit: 6, scale: [0, 6, 12, 18, 24, 36, 48, 72, 96] });
  assert.deepEqual([id.extensions.numerals, id.extensions.calendar], ['arab', 'islamic-umalqura']);
  assert.deepEqual(id.project, {
    language: 'ar',
    direction: 'rtl',
    platform: 'web',
    type: 'dashboard',
    contrast: 'AAA'
  });
  assert.equal(id.extensions.motion, 'none');
  assert.deepEqual(id.autoFilled, ['shadows']);
  assert.deepEqual(id.leaveToAI, ['illustrations']);
  // Recorded lowercase and in a fixed key order.
  assert.deepEqual(id.selections.colors, {
    template: 'palette-blue',
    overrides: { primary: '#3b82f6', secondary: '#d97706' }
  });
  assert.deepEqual(Object.keys(id.selections['type-scale'].overrides), [
    'base',
    'below',
    'line-height-ar',
    'line-height-en',
    'ratio',
    'steps'
  ]);
  // A compact scale with half-unit steps rounds half up: 2 × 5/4 = 2.5 → 3.
  const d = fromIdentity('calm-corporate');
  d.selections.spacing = { template: 'spacing-compact', overrides: { unit: 5 } };
  assert.deepEqual(resolve.resolve(d, FROZEN).tokens.spacing.scale, [0, 3, 5, 10, 15, 20, 30, 40, 60]);
});

test('same choices give the same identity, whatever the key order', () => {
  const a = fromIdentity('warm-friendly');
  a.selections.colors.overrides = { primary: '#123456', secondary: '#abcdef' };
  const b = { selections: {}, name: a.name };
  for (const e of [...E].reverse()) b.selections[e] = { ...a.selections[e] };
  b.selections.colors = { overrides: { secondary: '#ABCDEF', primary: '#123456' }, template: 'palette-teal' };
  const one = JSON.stringify(resolve.resolve(a, FROZEN));
  assert.equal(JSON.stringify(resolve.resolve(a, FROZEN)), one);
  assert.equal(JSON.stringify(resolve.resolve(b, FROZEN)), one);
  assert.equal(JSON.stringify(resolve.resolve(a, DATA)), one, 'frozen or not, same result');
});

test('the identity shares nothing with the library: changing it leaves the data untouched', () => {
  const before = JSON.stringify(DATA);
  const id = resolve.resolve(fromIdentity('calm-corporate'), DATA);
  id.extensions.rtl.mirror.push('x');
  id.tokens.font.body.fallback.push('serif');
  id.tokens.spacing.scale[1] = 99;
  id.tokens.shadow.light.md[0].x = 9;
  assert.equal(JSON.stringify(DATA), before);
});

test('every template combination and adjustment either gives a valid identity or is refused (2,000 seeded tries)', () => {
  const rand = rng(2_04);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const num = (lo, hi, dp) => Number((lo + rand() * (hi - lo)).toFixed(dp));
  const hex = () => '#' + Array.from({ length: 6 }, () => pick('0123456789abcdefABCDEF'.split(''))).join('');
  let ok = 0;
  let no = 0;
  for (let i = 0; i < 2000; i++) {
    const c = { name: pick(['هوية', 'Brand', ' مؤسسي هادئ ', 'A']), selections: {} };
    for (const e of E) c.selections[e] = { template: pick(DATA.templates[e]).id };
    if (rand() < 0.5)
      c.selections.colors.overrides = rand() < 0.5 ? { primary: hex() } : { primary: hex(), secondary: hex() };
    const font = DATA.templates.fonts.find((t) => t.id === c.selections.fonts.template).extras;
    if (rand() < 0.3 && font.arabic && font.latin && font.arabic !== font.latin)
      c.selections.fonts.overrides = { 'latin-size-adjust': num(0.5, 2, 2) };
    if (rand() < 0.4) {
      const steps = 3 + Math.floor(rand() * 10);
      c.selections['type-scale'].overrides = {
        base: num(10, 32, 1),
        ratio: num(1.01, 2, 3),
        steps,
        below: Math.floor(rand() * steps),
        'line-height-ar': num(1, 2.5, 2)
      };
    }
    if (rand() < 0.4) c.selections.radius.overrides = { sm: Math.floor(rand() * 65), lg: Math.floor(rand() * 65) };
    if (rand() < 0.3)
      c.selections.icons.overrides = {
        fill: pick(['outline', 'filled', 'duotone']),
        container: pick(['none', 'circle', 'square', 'rounded'])
      };
    if (rand() < 0.4) c.selections.spacing.overrides = { unit: 2 + Math.floor(rand() * 7) };
    if (rand() < 0.3) c.selections.shadows.overrides = { strength: num(0, 2, 2) };
    if (rand() < 0.3) c.selections.direction.overrides = { numerals: pick(['latn', 'arab']) };
    if (rand() < 0.3)
      c.project = {
        type: pick(['landing', 'website', 'web-app', 'dashboard', 'html-page']),
        contrast: pick(['AA', 'AAA'])
      };
    let id;
    try {
      id = resolve.resolve(c, FROZEN);
    } catch (e) {
      assert.equal(e.name, 'ResolveError', e.stack);
      // Only a type scale whose sizes leave 6..200 px may be refused here.
      assert.match(e.problems.join(' | '), /^type-scale: /, JSON.stringify(c));
      no++;
      continue;
    }
    const v = validate.check('identity', id);
    assert.equal(v.valid, true, JSON.stringify(v.errors));
    if (!c.selections['type-scale'].overrides)
      assert.ok(id.tokens.font.lineHeight.ar >= 1.6 && id.tokens.font.lineHeight.ar <= 1.8);
    ok++;
  }
  assert.ok(ok > 1500, `${ok} resolved, ${no} refused`);
});

test('resolved identities generate the six files, and the export bundle checks out', () => {
  for (const id of ['calm-corporate', 'warm-friendly']) {
    const identity = resolve.resolve(fromIdentity(id), FROZEN);
    const files = generate.valueFiles(identity);
    assert.ok(files['tokens.css'].includes('--color-primary'));
    const b = bundle.build(identity);
    assert.deepEqual(bundle.verify(b), []);
    assert.deepEqual(JSON.parse(b.files['identity.json']), identity);
  }
});

test('broken choices are refused with a reason, never turned into an identity', () => {
  const base = () => fromIdentity('calm-corporate');
  const withSel = (e, v) => {
    const c = base();
    c.selections[e] = v;
    return c;
  };
  const withOv = (e, ov) => withSel(e, { template: base().selections[e].template, overrides: ov });
  refused(
    () => resolve.resolve(withOv('colors', { accent: '#000000' }), FROZEN),
    /colors: "accent" cannot be adjusted/
  );
  refused(() => resolve.resolve(withOv('colors', { primary: 'red' }), FROZEN), /colors\.primary: expected #rrggbb/);
  refused(() => resolve.resolve(withOv('colors', { primary: '#12345' }), FROZEN), /colors\.primary/);
  refused(() => resolve.resolve(withOv('radius', { md: 65 }), FROZEN), /radius\.md: expected an integer from 0 to 64/);
  refused(() => resolve.resolve(withOv('radius', { md: 8.5 }), FROZEN), /radius\.md/);
  refused(() => resolve.resolve(withOv('radius', { md: '8' }), FROZEN), /radius\.md/);
  refused(() => resolve.resolve(withOv('type-scale', { ratio: 1 }), FROZEN), /type-scale\.ratio/);
  refused(() => resolve.resolve(withOv('type-scale', { base: NaN }), FROZEN), /type-scale\.base/);
  refused(() => resolve.resolve(withOv('type-scale', { base: 32, ratio: 2, steps: 12 }), FROZEN), /^type-scale: /);
  refused(() => resolve.resolve(withOv('type-scale', { 'line-height-ar': 3 }), FROZEN), /line-height-ar/);
  refused(() => resolve.resolve(withOv('spacing', { unit: 1 }), FROZEN), /spacing\.unit/);
  refused(() => resolve.resolve(withOv('shadows', { md: 1 }), FROZEN), /shadows: "md" cannot be adjusted/);
  refused(() => resolve.resolve(withOv('icons', { fill: 'solid' }), FROZEN), /icons\.fill/);
  refused(() => resolve.resolve(withOv('direction', { calendar: 'hijri' }), FROZEN), /direction\.calendar/);
  refused(() => resolve.resolve(withOv('colors', ['#000000']), FROZEN), /overrides must be an object/);
  refused(
    () => resolve.resolve(withOv('colors', { __proto__: null, constructor: 1 }), FROZEN),
    /"constructor" cannot be adjusted/
  );
  refused(() => resolve.resolve(withSel('radius', undefined), FROZEN), /radius: no template chosen/);
  refused(
    () => resolve.resolve(withSel('radius', { template: 'radius-nope' }), FROZEN),
    /radius: "radius-nope" is not a published template/
  );
  refused(
    () => resolve.resolve(withSel('radius', { template: 'palette-blue' }), FROZEN),
    /radius: "palette-blue" is a colors template/
  );
  refused(
    () => resolve.resolve(withSel('radius', { template: 'radius-medium', extra: 1 }), FROZEN),
    /unknown field "extra"/
  );
  refused(() => {
    const c = base();
    c.selections.motion = { template: 'x' };
    return resolve.resolve(c, FROZEN);
  }, /"motion" is not an element/);
  refused(() => resolve.resolve({ ...base(), colour: 1 }, FROZEN), /unknown choice "colour"/);
  refused(() => resolve.resolve({ ...base(), project: { type: 'game' } }, FROZEN), /project\.type/);
  refused(() => resolve.resolve({ ...base(), project: { platform: 'mobile' } }, FROZEN), /unknown setting "platform"/);
  refused(() => resolve.resolve({ ...base(), motion: 'wild' }, FROZEN), /motion/);
  // The final identity check catches what only the schema knows: name rules, list rules.
  refused(() => resolve.resolve({ ...base(), name: '' }, FROZEN), /\/name/);
  refused(() => resolve.resolve({ ...base(), name: '<b>' }, FROZEN), /\/name/);
  refused(() => resolve.resolve({ ...base(), autoFilled: ['radius', 'radius'] }, FROZEN), /\/autoFilled/);
  refused(() => resolve.resolve({ ...base(), leaveToAI: ['Not An Id'] }, FROZEN), /\/leaveToAI/);
  refused(() => resolve.resolve(base(), { templates: {} }), /no template chosen|not a published template/);
  refused(() => resolve.resolve(base()), /no library data/);
  refused(() => resolve.resolve(null, FROZEN), /expected the choices object/);
  // A draft is not in the published data, so it cannot be chosen.
  const all = build.load(path.join(ROOT, 'tests/fixtures/library'));
  const fixture = build.select(all).data;
  const c = {};
  for (const e of E) c[e] = { template: fixture.templates[e][0].id };
  c.radius = { template: 'radius-sharp' };
  refused(
    () => resolve.resolve({ name: 'x', selections: c }, fixture),
    /radius: "radius-sharp" is not a published template/
  );
});

test('a real browser gives the same identity from picker/data (page opened as a file)', async (t) => {
  const c = await launch();
  if (!c) return t.skip('Chrome not installed');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hawiya-resolve-'));
  try {
    const core = ['color', 'contrast', 'ramp', 'modes', 'scale', 'schemas', 'validate', 'resolve'];
    const data = fs.readdirSync(path.join(ROOT, 'picker/data')).sort();
    const src = (p) => `<script src="${new URL('file://' + path.join(ROOT, 'picker', p)).href}"></script>`;
    const html = data.map((f) => src('data/' + f)).join('') + core.map((f) => src(`js/core/${f}.js`)).join('');
    fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html><meta charset="utf-8"><title>t</title>${html}`);
    await c.open('file://' + path.join(dir, 'index.html'));
    const choices = fromIdentity('warm-friendly');
    choices.selections.colors.overrides = { primary: '#3B82F6' };
    const got = await c.eval(`JSON.stringify(Hawiya.resolve.resolve(${JSON.stringify(choices)}))`);
    assert.equal(got, JSON.stringify(resolve.resolve(choices, FROZEN)));
    assert.deepEqual(c.errors(), []);
  } finally {
    c.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('cases the starter library does not have: an opaque shadow layer, an inset layer, digits support, no fallback', () => {
  const data = JSON.parse(JSON.stringify(DATA));
  const soft = data.templates.shadows.find((t) => t.id === 'shadow-soft');
  delete soft.tokens.shadow.light.md.$value[0].color.alpha;
  soft.tokens.shadow.light.lg.$value[0].inset = true;
  const plex = data.templates.fonts.find((t) => t.id === 'pair-plex-arabic-plex-sans');
  plex.extras.easternArabicDigits = true;
  plex.extras.numeralsFont = 'IBM Plex Sans Arabic';
  plex.tokens.font.body.$value = ['IBM Plex Sans Arabic', 'IBM Plex Sans'];
  const id = resolve.resolve(fromIdentity('calm-corporate'), deepFreeze(data));
  assert.deepEqual(id.tokens.shadow.light.md, [{ x: 0, y: 4, blur: 12, spread: 0, color: '#000000', alpha: 1 }]);
  assert.equal(id.tokens.shadow.light.lg[0].inset, true);
  assert.equal('inset' in id.tokens.shadow.light.lg[1], false);
  assert.equal(id.tokens.font.numerals.easternArabicDigits, true);
  assert.equal('easternArabicDigits' in id.tokens.font.body, false);
  assert.deepEqual(id.tokens.font.body.fallback, ['system-ui', 'sans-serif']);
  // A template value in another unit is refused rather than misread.
  const data2 = JSON.parse(JSON.stringify(DATA));
  data2.templates.radius.find((t) => t.id === 'radius-medium').tokens.radius.md.$value.unit = 'rem';
  refused(() => resolve.resolve(fromIdentity('calm-corporate'), data2), /radius\.md: expected a px dimension/);
});

test('review fixes: no silent adjustment, unreadable secondary, step order, R-091 default, -0', () => {
  // Cairo draws both scripts: a Latin size adjustment would do nothing, so it is refused.
  const w = fromIdentity('warm-friendly');
  w.selections.fonts.overrides = { 'latin-size-adjust': 0.8 };
  refused(() => resolve.resolve(w, FROZEN), /latin-size-adjust has no effect/);

  const data = JSON.parse(JSON.stringify(DATA));
  data.templates.colors.find((t) => t.id === 'palette-blue').tokens.color.secondary.$value.hex = '#73e';
  refused(() => resolve.resolve(fromIdentity('calm-corporate'), data), /secondary color is not #rrggbb/);
  // Without a secondary at all, one is derived from the primary.
  delete data.templates.colors.find((t) => t.id === 'palette-blue').tokens.color.secondary;
  assert.equal(resolve.resolve(fromIdentity('calm-corporate'), data).tokens.color.light.primary, '#2563eb');

  // Half steps are read in numeric order.
  const d2 = JSON.parse(JSON.stringify(DATA));
  const px = (v) => ({ $type: 'dimension', $value: { value: v, unit: 'px' } });
  d2.templates.spacing.find((t) => t.id === 'spacing-comfortable').tokens.spacing.scale = {
    0: px(0),
    0.5: px(2),
    1: px(4),
    1.5: px(6),
    2: px(8)
  };
  assert.deepEqual(resolve.resolve(fromIdentity('calm-corporate'), d2).tokens.spacing.scale, [0, 2, 4, 6, 8]);

  // A template whose Arabic line height breaks R-091 is refused; an explicit adjustment may go lower.
  const d3 = JSON.parse(JSON.stringify(DATA));
  d3.templates['type-scale'].find((t) => t.id === 'scale-major-third').tokens.lineHeight.ar.$value = 1.2;
  refused(() => resolve.resolve(fromIdentity('calm-corporate'), d3), /R-091/);
  const low = fromIdentity('calm-corporate');
  low.selections['type-scale'].overrides = { 'line-height-ar': 1.4 };
  assert.equal(resolve.resolve(low, FROZEN).tokens.font.lineHeight.ar, 1.4);

  const z = fromIdentity('calm-corporate');
  z.selections.radius.overrides = { sm: -0 };
  const id = resolve.resolve(z, FROZEN);
  assert.ok(Object.is(id.tokens.radius.sm, 0) && Object.is(id.selections.radius.overrides.sm, 0));
  assert.deepEqual(JSON.parse(JSON.stringify(id)), id);
});

test('every template combination keeps the Arabic default line height in 1.6..1.8 (R-091)', () => {
  for (const ts of DATA.templates['type-scale']) {
    for (const dir of DATA.templates.direction) {
      const c = fromIdentity('calm-corporate');
      c.selections['type-scale'] = { template: ts.id };
      c.selections.direction = { template: dir.id };
      const ar = resolve.resolve(c, FROZEN).tokens.font.lineHeight.ar;
      assert.ok(ar >= 1.6 && ar <= 1.8, `${ts.id}: ${ar}`);
    }
  }
});

test('shadow strength (task 2.9): scales the opacity of every shadow layer in both modes, nothing else', () => {
  const base = resolve.resolve(fromIdentity('calm-corporate'), FROZEN);
  const withStrength = (s) => {
    const c = fromIdentity('calm-corporate');
    c.selections.shadows.overrides = { strength: s };
    return resolve.resolve(c, FROZEN);
  };
  const layers = (id) => ['light', 'dark'].flatMap((m) => ['sm', 'md', 'lg'].flatMap((k) => id.tokens.shadow[m][k]));
  const round2 = (x) => Math.floor(Number((x * 100).toFixed(6)) + 0.5) / 100;
  for (const s of [0, 0.5, 1.3, 1.5, 2]) {
    const id = withStrength(s);
    assert.equal(validate.check('identity', id).valid, true, String(s));
    const a = layers(base);
    const b = layers(id);
    assert.equal(b.length, a.length);
    b.forEach((l, i) => {
      const { alpha, ...geometry } = l;
      const { alpha: alpha0, ...geometry0 } = a[i];
      assert.deepEqual(geometry, geometry0, 'offsets, blur, spread, color unchanged');
      assert.equal(alpha, Math.min(1, round2(alpha0 * s)), `${s}: ${alpha0}`);
    });
    assert.deepEqual(id.selections.shadows, { template: 'shadow-soft', overrides: { strength: s } });
  }
  // Exact examples: 0.12 × 1.5 = 0.18 (not 0.18000000000000002); 0.05 × 1.3 = 0.065 → 0.07 (half up); dark 0.7 × 2 → 1.
  const id = withStrength(1.5);
  assert.equal(id.tokens.shadow.light.lg[0].alpha, 0.18);
  assert.equal(withStrength(1.3).tokens.shadow.light.lg[1].alpha, 0.07);
  assert.equal(withStrength(2).tokens.shadow.dark.lg[0].alpha, 1);
  assert.equal(withStrength(0).tokens.shadow.light.md[0].alpha, 0);
  // Out of range or not a number: refused.
  for (const bad of [-0.1, 2.01, '1', NaN, Infinity]) {
    const c = fromIdentity('calm-corporate');
    c.selections.shadows.overrides = { strength: bad };
    refused(() => resolve.resolve(c, FROZEN), /shadows\.strength: expected a number from 0 to 2/);
  }
});

test('review fixes (2.9): broken template opacity is refused with or without strength; precise half-up; 1 changes nothing', () => {
  for (const bad of [1.5, -0.1, '0.5', null, true]) {
    const data = JSON.parse(JSON.stringify(DATA));
    data.templates.shadows.find((t) => t.id === 'shadow-soft').tokens.shadow.light.lg.$value[0].color.alpha = bad;
    for (const strength of [undefined, 1, 0.5]) {
      const c = fromIdentity('calm-corporate');
      if (strength !== undefined) c.selections.shadows.overrides = { strength };
      refused(() => resolve.resolve(c, data), /shadows\.light\.lg\[0\]: opacity must be a number from 0 to 1/);
    }
  }
  // Just below a half rounds down: 0.05 × 0.09999998 = 0.004999999 → 0.00.
  const c = fromIdentity('calm-corporate');
  c.selections.shadows.overrides = { strength: 0.09999998 };
  assert.equal(resolve.resolve(c, FROZEN).tokens.shadow.light.lg[1].alpha, 0);
  // Strength 1 leaves every opacity exactly as the template has it, even with more than two decimals.
  const data = JSON.parse(JSON.stringify(DATA));
  data.templates.shadows.find((t) => t.id === 'shadow-soft').tokens.shadow.light.lg.$value[0].color.alpha = 0.123;
  const one = fromIdentity('calm-corporate');
  one.selections.shadows.overrides = { strength: 1 };
  assert.equal(resolve.resolve(one, data).tokens.shadow.light.lg[0].alpha, 0.123);
});

// Task 3.8: a pair may name its own heading families, and an English pair its own numerals font.
test('font pairs: heading families, the Latin numerals font, and the size adjustment only on the body pair', () => {
  const data = JSON.parse(JSON.stringify(DATA));
  data.templates.fonts = JSON.parse(fs.readFileSync(path.join(LIB, 'elements/fonts.json'), 'utf8')); // drafts too
  const choose = (id) => {
    const c = fromIdentity('calm-corporate');
    c.selections.fonts = { template: id };
    return resolve.resolve(c, deepFreeze(JSON.parse(JSON.stringify(data))));
  };
  const fb = ['system-ui', 'sans-serif'];
  // Arabic pair: El Messiri headings, Tajawal text and numerals.
  let id = choose('pair-ar-el-messiri-tajawal');
  assert.deepEqual(id.tokens.font.heading, { arabic: 'El Messiri', fallback: fb });
  assert.deepEqual(id.tokens.font.body, { arabic: 'Tajawal', fallback: fb });
  assert.deepEqual(id.tokens.font.numerals, { arabic: 'Tajawal', fallback: fb, easternArabicDigits: true });
  // English pair: the heading family is Latin; the numerals font is the Latin body.
  id = choose('pair-en-space-grotesk-sora');
  assert.deepEqual(id.tokens.font.heading, { latin: 'Space Grotesk', fallback: fb });
  assert.deepEqual(id.tokens.font.body, { latin: 'Sora', fallback: fb });
  assert.deepEqual(id.tokens.font.numerals, { latin: 'Sora', fallback: fb, easternArabicDigits: false });
  // English font with a monospaced numerals font: the numerals role is that Latin family, not an "Arabic" one.
  id = choose('pair-en-geist-geist-mono');
  assert.deepEqual(id.tokens.font.numerals, { latin: 'Geist Mono', fallback: fb, easternArabicDigits: false });
  assert.deepEqual(id.tokens.font.heading, { latin: 'Geist', fallback: fb });
  // Bilingual pair: heading = body, both with the measured adjustment.
  id = choose('pair-kufam-space-grotesk');
  const pair = { arabic: 'Kufam', latin: 'Space Grotesk', fallback: fb, latinSizeAdjust: 1.2 };
  assert.deepEqual(id.tokens.font.heading, pair);
  assert.deepEqual(id.tokens.font.body, pair);
  // The six files: tokens.css names each role's families; the identity passes the checker.
  for (const t of ['pair-ar-amiri-noto-naskh-arabic', 'pair-en-jetbrains-mono-space-grotesk', 'pair-rubik']) {
    const ident = choose(t);
    const css = generate.valueFiles(ident)['tokens.css'];
    assert.equal(validate.check('identity', ident).valid, true, t);
    assert.match(css, /--font-heading: /, t);
    if (t === 'pair-ar-amiri-noto-naskh-arabic') {
      assert.match(css, /--font-heading: "Amiri"/);
      assert.match(css, /--font-body: "Noto Naskh Arabic", ui-serif, serif/);
    }
    if (t === 'pair-en-jetbrains-mono-space-grotesk') assert.match(css, /--font-heading: "JetBrains Mono"/);
  }
});

// Independent review of 3.8: the size adjustment was measured for the body pair, so it never reaches another pair.
test('the size adjustment stays off a numerals font that is not the body Arabic family', () => {
  const data = JSON.parse(JSON.stringify(DATA));
  const plex = data.templates.fonts.find((t) => t.id === 'pair-plex-arabic-plex-sans');
  plex.extras.latinSizeAdjust = 0.9;
  plex.extras.numeralsFont = 'Noto Sans Arabic';
  const id = resolve.resolve(fromIdentity('calm-corporate'), deepFreeze(data));
  assert.equal(id.tokens.font.body.latinSizeAdjust, 0.9);
  assert.equal('latinSizeAdjust' in id.tokens.font.numerals, false);
  assert.equal(id.tokens.font.numerals.arabic, 'Noto Sans Arabic');
});
