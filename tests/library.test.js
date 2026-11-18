'use strict';
// Task 2.2: the starter library (library/) is complete, valid, sourced and licensed,
// and the committed page data (picker/data/) is exactly what the library builds to.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const build = require('../tools/build.js');
const resolve = require('../picker/js/core/resolve.js');
const rules = require('../picker/js/core/rules.js');
const validate = require('../picker/js/core/validate.js');
const modes = require('../picker/js/core/modes.js');
const scale = require('../picker/js/core/scale.js');
const templateSchema = require('../schema/template.schema.json');
const identitySchema = require('../schema/identity.schema.json');

const ROOT = path.join(__dirname, '..');
const LIB = path.join(ROOT, 'library');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(LIB, rel), 'utf8'));

const lib = build.load(LIB);
const sel = build.select(lib);
const all = [].concat(...build.ELEMENTS.map((e) => lib.templates[e]));
const sources = readJson('sources.json');
const licenses = readJson('licenses.json');

function idDef(name) {
  const check = validate.compile({ $defs: identitySchema.$defs, $ref: '#/$defs/' + name });
  return (value) => {
    const r = check(value);
    assert.equal(r.valid, true, `${name}: ${JSON.stringify(value)} -> ${JSON.stringify(r.errors)}`);
  };
}
const dimPx = (tok) => {
  assert.equal(tok.$type, 'dimension');
  assert.equal(tok.$value.unit, 'px');
  return tok.$value.value;
};

// Task 3.14 (R-061, AC-11, AC-12): the published library is the reviewed one, about 250 templates or more, with no
// draft; the ten ready identities are all published.
test('the published library: every template reviewed (about 250 or more), no draft, the ten identities published', () => {
  let reviewed = 0;
  for (const e of build.ELEMENTS) {
    const list = lib.templates[e].filter((t) => t.status.state === 'reviewed');
    reviewed += list.length;
    assert.deepEqual(
      sel.data.templates[e].map((t) => t.id),
      list.map((t) => t.id),
      `${e}: published = reviewed`
    );
    assert.ok(
      sel.data.templates[e].every((t) => t.status.state === 'reviewed'),
      `${e}: no draft published`
    );
    assert.equal(sel.summary.elements[e].drafts, lib.templates[e].length - list.length, e);
  }
  assert.ok(reviewed >= 240, `${reviewed} reviewed templates`);
  assert.equal(sel.data.identities.length, 10);
  assert.deepEqual(sel.summary.identities.excluded, []);
  // The two first identities differ in most choices, so they show the range of the library.
  const a = sel.data.identities.find((i) => i.id === 'calm-corporate');
  const b = sel.data.identities.find((i) => i.id === 'warm-friendly');
  const same = build.ELEMENTS.filter((e) => a.templates[e] === b.templates[e]);
  assert.ok(same.length <= 2, `identities share ${same.join(', ')}`);
});

test('every template names a recorded source with an allowed license', () => {
  const allowed = new Set(licenses.allowed.map((l) => l.id));
  const forbidden = licenses.forbiddenSources.map((f) => f.name.toLowerCase());
  assert.ok(forbidden.length >= 7, 'the forbidden list from the project file is recorded');
  const ids = new Set();
  for (const s of sources) {
    assert.ok(!ids.has(s.id), `duplicate source ${s.id}`);
    ids.add(s.id);
    assert.ok(allowed.has(s.license), `${s.name}: ${s.license} is not allowed`);
    // Its own repository, or its Figma Community page for a set published only there (Solar, Basil).
    assert.match(s.url, /^https:\/\/(github\.com|www\.figma\.com\/community\/file)\/[^\s]+$/);
    assert.match(s.licenseFile, /^https:\/\/(github\.com|www\.figma\.com\/community\/file)\/[^\s]+$/);
    assert.match(s.licenseReadAt, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(!forbidden.some((f) => s.name.toLowerCase().includes(f)), `${s.name} is forbidden`);
  }
  const used = new Set();
  for (const t of all) {
    const s = sources.find((x) => x.name === t.source.name);
    assert.ok(s, `${t.id}: source "${t.source.name}" missing from sources.json`);
    assert.equal(t.source.url, s.url, `${t.id}: source url`);
    assert.equal(t.source.license, s.license, `${t.id}: license`);
    used.add(s.id);
    for (const extra of (t.extras && t.extras.sources) || []) {
      assert.ok(ids.has(extra), `${t.id}: unknown source ${extra}`);
      used.add(extra);
    }
  }
  assert.deepEqual(
    [...ids].filter((i) => !used.has(i)),
    [],
    'no unused source'
  );
});

test('tags.json lists exactly the 16 fixed tags with both names', () => {
  const tags = readJson('tags.json');
  assert.deepEqual(
    tags.map((t) => t.id),
    templateSchema.$defs.tag.enum
  );
  for (const t of tags) {
    assert.ok(t.name.ar.length > 0 && t.name.en.length > 0, t.id);
    assert.deepEqual(Object.keys(t).sort(), ['id', 'name']);
  }
});

test('each element carries the values the page needs to build an identity', () => {
  const hex = idDef('hex');
  const family = idDef('familyName');
  const radiusPx = idDef('radiusPx');
  const shadowSet = idDef('shadowSet');
  const id = idDef('id');
  const T = lib.templates;

  for (const t of T.colors) {
    const p = t.tokens.color.primary.$value.hex;
    const s = t.tokens.color.secondary.$value.hex;
    hex(p);
    hex(s);
    const set = modes.derive(p, { secondary: s });
    assert.equal(set.light.primary, p, `${t.id}: primary kept`);
  }
  for (const t of T.modes) assert.ok(['system', 'light', 'dark'].includes(t.tokens.mode.default.$value), t.id);
  const byLang = { ar: 0, en: 0, both: 0 };
  for (const t of T.fonts) {
    const L = t.extras.languages;
    assert.ok(
      ['ar', 'en'].some((x) => JSON.stringify(L) === JSON.stringify([x])) || JSON.stringify(L) === '["ar","en"]',
      `${t.id}: languages`
    );
    byLang[L.length === 2 ? 'both' : L[0]]++;
    // A font names the family for each language it is for, and only those (R-030).
    if (L.includes('ar')) family(t.extras.arabic);
    else assert.equal(t.extras.arabic, undefined, t.id);
    if (L.includes('en')) family(t.extras.latin);
    else assert.equal(t.extras.latin, undefined, t.id);
    const uniq = (list) => list.filter((n, i, all) => n && all.indexOf(n) === i);
    const x = t.extras;
    // Each role's token starts with that role's families: the body pair, the heading pair (its own families,
    // task 3.8, or the body's), and the numerals font first for the numerals.
    const roles = {
      heading: uniq([x.headingArabic || x.arabic, x.headingLatin || x.latin]),
      body: uniq([x.arabic, x.latin]),
      numerals: [x.numeralsFont || x.arabic || x.latin]
    };
    for (const role of ['heading', 'body', 'numerals']) {
      assert.equal(t.tokens.font[role].$type, 'fontFamily');
      assert.deepEqual(t.tokens.font[role].$value.slice(0, roles[role].length), roles[role], `${t.id} ${role}`);
    }
    // R-094: Eastern Arabic digit support is recorded for every font (measured, task 2.11).
    assert.equal(typeof t.extras.easternArabicDigits, 'boolean', `${t.id}: easternArabicDigits`);
    // R-090: a two-family pair carries a size adjustment.
    if (t.extras.arabic && t.extras.latin && t.extras.arabic !== t.extras.latin) {
      assert.ok(t.extras.latinSizeAdjust >= 0.5 && t.extras.latinSizeAdjust <= 2, t.id);
    }
  }
  assert.ok(
    byLang.ar >= 1 && byLang.en >= 1 && byLang.both >= 1,
    `fonts for each project language: ${JSON.stringify(byLang)}`
  );
  for (const t of T['type-scale']) {
    const ts = t.tokens.typeScale;
    const out = scale.generate({
      base: dimPx(ts.base),
      ratio: ts.ratio.$value,
      steps: ts.steps.$value,
      below: ts.below.$value
    });
    assert.equal(out.length, ts.steps.$value, t.id);
    const lh = t.tokens.lineHeight.ar.$value;
    assert.ok(lh >= 1.6 && lh <= 1.8, `${t.id}: Arabic line height ${lh} (R-091)`);
  }
  for (const t of T.radius) {
    ['sm', 'md', 'lg'].forEach((k) => radiusPx(dimPx(t.tokens.radius[k])));
    assert.equal(dimPx(t.tokens.radius.full), 9999);
  }
  for (const t of T.shadows) {
    for (const mode of ['light', 'dark']) {
      const set = {};
      for (const k of ['sm', 'md', 'lg']) {
        const tok = t.tokens.shadow[mode][k];
        assert.equal(tok.$type, 'shadow');
        set[k] = tok.$value.map((l) => ({
          x: l.offsetX.value,
          y: l.offsetY.value,
          blur: l.blur.value,
          spread: l.spread.value,
          color: l.color.hex,
          alpha: l.color.alpha === undefined ? 1 : l.color.alpha
        }));
      }
      shadowSet(set);
      assert.ok(set.md.length > 0 && set.lg.length > 0, `${t.id} ${mode}: md and lg stay visible`);
    }
  }
  for (const t of T.icons) {
    id(t.extras.library);
    id(t.extras.weight);
    assert.ok(['outline', 'filled', 'duotone'].includes(t.extras.fill), t.id);
    assert.ok(['none', 'circle', 'square', 'rounded'].includes(t.extras.container), t.id);
  }
  for (const t of T.spacing) {
    const unit = dimPx(t.tokens.spacing.unit);
    const list = Object.keys(t.tokens.spacing.scale).map((k) => dimPx(t.tokens.spacing.scale[k]));
    assert.ok(Number.isInteger(unit) && unit >= 2 && unit <= 8, t.id);
    assert.ok(
      list.length >= 3 && list.length <= 16 && list.every((v) => Number.isInteger(v) && v >= 0 && v <= 256),
      t.id
    );
    assert.deepEqual(
      Object.keys(t.tokens.spacing.scale),
      list.map((_, i) => String(i)),
      `${t.id}: keys in order`
    );
  }
  const pairs = { rtl: 'ar', ltr: 'en', both: 'ar+en' };
  for (const t of T.direction) {
    const dir = t.tokens.direction.$value;
    assert.equal(t.extras.language, pairs[dir], `${t.id}: language matches direction`);
    assert.ok(
      ['latn', 'arab'].includes(t.extras.numerals) && ['gregory', 'islamic-umalqura'].includes(t.extras.calendar),
      t.id
    );
    for (const list of [t.extras.mirror, t.extras.neverMirror]) {
      assert.ok(list.length > 0, t.id);
      list.forEach(id);
    }
    assert.deepEqual(
      t.extras.mirror.filter((x) => t.extras.neverMirror.includes(x)),
      [],
      `${t.id}: no item in both lists`
    );
  }
});

test('button and card recipes use only variables the generated tokens.css defines, and logical properties', () => {
  const css = fs.readFileSync(path.join(ROOT, 'tests/fixtures/expected/identity-ar-web-app/tokens.css'), 'utf8');
  const defined = new Set(css.match(/--[a-z0-9-]+(?=\s*:)/g));
  for (const t of lib.templates.buttons.concat(lib.templates.cards)) {
    const used = t.recipe.css.match(/var\(--[a-z0-9-]+\)/g) || [];
    assert.ok(used.length > 0, t.id);
    for (const v of used) assert.ok(defined.has(v.slice(4, -1)), `${t.id}: ${v} is not in tokens.css`);
    assert.doesNotMatch(
      t.recipe.css,
      /(^|[;{\s-])(left|right)\s*:|(margin|padding|border)-(left|right)|text-align\s*:\s*(left|right)/,
      `${t.id}: physical direction`
    );
    assert.doesNotMatch(t.recipe.html, /<script|\son[a-z]+=|javascript:/i, `${t.id}: recipe HTML has no script`);
    if (/transition|animation/.test(t.recipe.css))
      assert.ok(t.a11y.reducedMotion, `${t.id}: reduced-motion alternative`);
  }
  // In every ready identity the button stays inside the card: no button rounder than its card (a pill button of task
  // 3.11 may be rounder in a user's own identity: the page then warns, R-026 warning rule).
  const findT = (e, id) => lib.templates[e].find((t) => t.id === id);
  for (const ready of sel.data.identities) {
    const selections = Object.fromEntries(build.ELEMENTS.map((e) => [e, { template: ready.templates[e] }]));
    const id = resolve.resolve({ name: ready.id, selections }, sel.data);
    const w = rules.warnings(id, findT).warnings.filter((x) => x.rule === 'button-radius-over-card');
    assert.deepEqual(w, [], ready.id);
  }
  // Every button's corners come from the identity's radii (or none at all).
  for (const t of lib.templates.buttons)
    assert.match(t.recipe.css, /\.hw-btn\{[^}]*border-radius:(var\(--radius-(sm|md|lg|full)\)|0)[;}]/, t.id);
  // Cards take any of the identity's radii or none (task 3.12).
  for (const t of lib.templates.cards)
    assert.match(t.recipe.css, /\.hw-card\{[^}]*border-radius:(var\(--radius-(sm|md|lg)\)|0)[;}]/, t.id);
});

test('picker/data is exactly what the library builds to', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'hawiya-lib-'));
  try {
    build.build({ libraryDir: LIB, outDir: out });
    const want = fs.readdirSync(out).sort();
    const have = fs.readdirSync(path.join(ROOT, 'picker/data')).sort();
    assert.deepEqual(have, want);
    for (const f of want) {
      assert.ok(
        fs.readFileSync(path.join(ROOT, 'picker/data', f)).equals(fs.readFileSync(path.join(out, f))),
        `${f} is out of date: run npm run build`
      );
    }
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('every icons template carries the same 14 sample meanings, as plain SVG shapes only (task 2.12)', () => {
  const icons = require('../tools/icons-extract.js');
  const meanings = icons.MEANINGS;
  assert.ok(meanings.length >= 12 && meanings.length <= 16, 'sample of 12 to 16 icons per set');
  for (const t of lib.templates.icons) {
    assert.match(t.extras.viewBox, /^0 0 \d+ \d+$/, t.id);
    assert.ok(t.extras.samples.outline, `${t.id}: outline samples`);
    for (const [fill, list] of Object.entries(t.extras.samples)) {
      assert.ok(['outline', 'filled', 'duotone'].includes(fill), `${t.id}: ${fill}`);
      assert.deepEqual(
        list.map((s) => s.meaning),
        meanings,
        `${t.id} ${fill}`
      );
      for (const s of list) icons.check(s.body, `${t.id} ${s.meaning}`); // throws on anything outside the allow-list
    }
  }
  // The allow-list refuses what could run or load something.
  for (const bad of [
    '<script>x</script>',
    '<path d="M0" onclick="x()"/>',
    '<image href="a.png"/>',
    '<path fill="url(#a)"/>',
    '<path d="M0"/>text',
    '<use href="#a"/>'
  ]) {
    assert.throws(() => icons.check(bad, 'test'), /not allowed|outside|unexpected/, bad);
  }
});

test('colors: 100+ palettes and themes from the confirmed sources, each with tags, three metrics and its source (tasks 3.6, 3.7)', () => {
  const palettes = lib.templates.colors;
  assert.ok(palettes.length >= 100, `${palettes.length} palettes`);
  const LABEL = {
    'Radix Colors': 'Radix Colors ',
    'Tailwind CSS': 'Tailwind CSS v3 ',
    'Open Color': 'Open Color ',
    'shadcn/ui': 'shadcn/ui ',
    tweakcn: 'tweakcn ',
    DaisyUI: 'DaisyUI ',
    Catppuccin: 'Catppuccin ',
    'Primer Primitives': 'Primer Primitives '
  };
  const per = {};
  for (const t of palettes) {
    assert.ok(LABEL[t.source.name], `${t.id}: source ${t.source.name}`);
    per[t.source.name] = (per[t.source.name] || 0) + 1;
    // Where the two values come from, as the source names its steps: "<source> <hue step> / <hue step>".
    assert.ok(t.extras.palette.startsWith(LABEL[t.source.name]) && t.extras.palette.includes(' / '), t.id);
    assert.ok(t.tags.length >= 1, t.id);
    for (const k of ['roundness', 'density', 'intensity']) {
      const v = t.metrics[k];
      assert.ok(typeof v === 'number' && v >= 0 && v <= 1, `${t.id}: metrics.${k}`);
    }
    assert.ok(['AA', 'AAA'].includes(t.a11y.contrast), t.id);
    for (const k of ['primary', 'secondary']) assert.match(t.tokens.color[k].$value.hex, /^#[0-9a-f]{6}$/, t.id);
  }
  for (const name of ['Radix Colors', 'Tailwind CSS', 'Open Color', 'tweakcn', 'DaisyUI'])
    assert.ok(per[name] >= 15, `${name}: ${per[name]} palettes`);
  for (const name of ['shadcn/ui', 'Catppuccin', 'Primer Primitives'])
    assert.ok(per[name] >= 3, `${name}: ${per[name]} palettes`);
  // A primary of pure white or black is no brand color: never a palette.
  for (const t of palettes) assert.ok(!['#ffffff', '#000000'].includes(t.tokens.color.primary.$value.hex), t.id);
});

// Task 3.8 (R-043, R-090, R-094): 40+ font pairs from the confirmed fonts of the project file.
test('fonts: 40+ pairs (bilingual, Arabic, English) from the confirmed fonts, each with its languages, numerals font and digit support', () => {
  const CONFIRMED = new Set([
    // Arabic for interfaces
    'Cairo',
    'Readex Pro',
    'Alexandria',
    'IBM Plex Sans Arabic',
    'Tajawal',
    'Almarai',
    'Noto Sans Arabic',
    'Noto Kufi Arabic',
    'Vazirmatn',
    'Rubik',
    'Changa',
    'El Messiri',
    'Zain',
    'Mada',
    'Kufam',
    'Fustat',
    'Beiruti',
    'Baloo Bhaijaan 2',
    'Harmattan',
    // Arabic for headings and long text
    'Amiri',
    'Noto Naskh Arabic',
    'Markazi Text',
    'Reem Kufi',
    'Scheherazade New',
    'Aref Ruqaa',
    'Lalezar',
    'Rakkas',
    'Lemonada',
    'Marhey',
    'Handjet',
    'Playpen Sans Arabic',
    'Alyamama',
    'Estedad',
    'Qahiri',
    'Badeen Display',
    // English sans and mono
    'Inter',
    'Geist',
    'IBM Plex Sans',
    'Manrope',
    'DM Sans',
    'Plus Jakarta Sans',
    'Outfit',
    'Figtree',
    'Onest',
    'Sora',
    'Space Grotesk',
    'Instrument Sans',
    'Bricolage Grotesque',
    'JetBrains Mono',
    'Geist Mono',
    // the starter pair of task 2.2 (Noto Sans: the Latin half of Noto Sans Arabic)
    'Noto Sans',
    // Task 5.2 (CHG-3, B-070): candidates of the project file whose licenses were read (OFL 1.1, google/fonts),
    // and two more members of the IBM Plex family already recorded
    'EB Garamond',
    'Fraunces',
    'Lora',
    'Playfair Display',
    'Space Mono',
    'IBM Plex Mono',
    'IBM Plex Serif'
  ]);
  const fonts = lib.templates.fonts;
  const kinds = { bilingual: 0, arabic: 0, english: 0 };
  for (const t of fonts) {
    const x = t.extras;
    const names = [x.arabic, x.latin, x.headingArabic, x.headingLatin, x.numeralsFont].filter(Boolean);
    for (const n of names) assert.ok(CONFIRMED.has(n), `${t.id}: ${n} is not a confirmed font`);
    const ar = typeof x.arabic === 'string';
    const en = typeof x.latin === 'string';
    assert.deepEqual(x.languages, ar && en ? ['ar', 'en'] : ar ? ['ar'] : ['en'], t.id);
    if (ar && en) kinds.bilingual++;
    else if (ar) kinds.arabic++;
    else kinds.english++;
    // A heading family is in the template's own script; a Latin heading only without Arabic, and the reverse.
    if (x.headingArabic) assert.ok(ar && !en && x.headingArabic !== x.arabic, t.id);
    if (x.headingLatin) assert.ok(en && !ar && x.headingLatin !== x.latin, t.id);
    assert.equal(typeof x.easternArabicDigits, 'boolean', `${t.id}: digit support recorded`);
    if (ar && en && x.arabic !== x.latin) {
      assert.ok(typeof x.latinSizeAdjust === 'number' && x.latinSizeAdjust >= 0.5 && x.latinSizeAdjust <= 2, t.id);
    }
    // Every family has its source recorded.
    for (const s of x.sources)
      assert.ok(
        sources.some((y) => y.id === s),
        `${t.id}: source ${s}`
      );
  }
  assert.ok(fonts.length >= 42, `${fonts.length} font templates`);
  assert.ok(kinds.bilingual >= 15 && kinds.arabic >= 10 && kinds.english >= 10, JSON.stringify(kinds));
  // The numerals font of a new pair is named (R-094).
  for (const t of fonts.filter((f) => f.status.state === 'draft'))
    assert.equal(typeof t.extras.numeralsFont, 'string', t.id);
});

// Task 3.9 (R-042, R-044, R-045, R-046, R-050, R-051): the numeric elements and the settings.
test('numeric elements and settings: 8 scales, 8 corners, 10 shadows with dark values, 6 spacings, 5 modes, direction', () => {
  const T = lib.templates;
  assert.equal(T['type-scale'].length, 8);
  assert.equal(T.radius.length, 8);
  assert.equal(T.shadows.length, 10);
  assert.equal(T.spacing.length, 6);
  assert.equal(T.modes.length, 5);
  assert.deepEqual(T.direction.map((t) => t.tokens.direction.$value).sort(), ['both', 'ltr', 'rtl']);
  for (const t of T['type-scale']) {
    const lh = t.tokens.lineHeight.ar.$value;
    assert.ok(lh >= 1.6 && lh <= 1.8, `${t.id}: Arabic line height ${lh} (R-091)`);
  }
  // A button (medium corners) is never rounder than a card (large corners).
  for (const t of T.radius) {
    const r = t.tokens.radius;
    assert.ok(r.sm.$value.value <= r.md.$value.value && r.md.$value.value <= r.lg.$value.value, t.id);
  }
  // Every shadow has dark-mode values for each size, strong enough to show on a dark surface: black layers at
  // 0.4 or more, or light layers (a light edge or ring).
  for (const t of T.shadows) {
    for (const k of ['sm', 'md', 'lg']) {
      const dark = t.tokens.shadow.dark[k].$value;
      const light = t.tokens.shadow.light[k].$value;
      assert.equal(dark.length > 0, light.length > 0, `${t.id} ${k}: dark values when light has a shadow`);
      for (const l of dark) {
        const lum = l.color.components.reduce((a, b) => a + b, 0) / 3;
        assert.ok(lum > 0.5 || l.color.alpha >= 0.4, `${t.id} dark ${k}: visible on a dark surface`);
      }
    }
  }
  // Modes: every default × switch pair, the three defaults offered with the switch.
  const modes = T.modes.map((t) => `${t.tokens.mode.default.$value}/${t.tokens.mode.switch.$value}`).sort();
  assert.deepEqual(modes, ['dark/none', 'dark/offered', 'light/none', 'light/offered', 'system/offered']);
});

// Task 3.10 (R-047): icon styles combine library, weight, fill and container; CC BY sets are named in the notices.
test('icons: 25+ styles across libraries, weights, fills and containers; CC BY sets credited in the notices', () => {
  const icons = lib.templates.icons;
  assert.ok(icons.length >= 25, `${icons.length} icon styles`);
  const seen = (k) => new Set(icons.map((t) => t.extras[k]));
  assert.ok(seen('library').size >= 15, 'every confirmed library');
  for (const w of ['thin', 'light', 'regular', 'bold']) assert.ok(seen('weight').has(w), w);
  for (const f of ['outline', 'filled', 'duotone']) assert.ok(seen('fill').has(f), f);
  for (const c of ['none', 'circle', 'square', 'rounded']) assert.ok(seen('container').has(c), c);
  for (const t of icons) {
    // The chosen fill is one the samples have (the extraction tool drew it).
    assert.ok(Array.isArray(t.extras.samples[t.extras.fill]), `${t.id}: ${t.extras.fill} samples`);
  }
  const notices = fs.readFileSync(path.join(ROOT, 'THIRD_PARTY_NOTICES.md'), 'utf8');
  for (const t of icons) {
    const s = sources.find((x) => x.name === t.source.name);
    if (s.license !== 'CC-BY-4.0') continue;
    assert.ok(notices.includes(`## ${s.name}\n`) && notices.includes(s.note), `${t.id}: ${s.name} credited`);
  }
});

// Task 3.11 (R-048): 22+ buttons, each recipe with its four states, in the identity's colors, with a recorded source.
test('buttons: 22+ recipes, each with hover, pressed, focus and disabled states, identity colors and a source', () => {
  const list = lib.templates.buttons;
  assert.ok(list.length >= 22, `${list.length} buttons`);
  for (const t of list) {
    for (const state of [':hover', ':active', ':focus-visible', ':disabled'])
      assert.ok(t.recipe.css.includes(`.hw-btn${state}{`), `${t.id}: ${state}`);
    // Colors only from the identity: no color written as a value.
    assert.doesNotMatch(t.recipe.css, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i, `${t.id}: a color outside the identity`);
    const s = sources.find((x) => x.name === t.source.name);
    assert.ok(s && s.license === t.source.license, `${t.id}: source and license recorded`);
  }
});

// Task 3.12 (R-049): 22+ cards, each recipe in the identity's colors, corners and shadows, with a title and a body
// and a recorded source.
test('cards: 22+ recipes in the identity colors, corners and shadows, each with a title and a body and a source', () => {
  const list = lib.templates.cards;
  assert.ok(list.length >= 22, `${list.length} cards`);
  for (const t of list) {
    assert.match(t.recipe.html, /^<article class="hw-card">[^]*\{title\}[^]*\{body\}[^]*<\/article>$/, t.id);
    // Colors only from the identity: no color written as a value.
    assert.doesNotMatch(t.recipe.css, /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i, `${t.id}: a color outside the identity`);
    // A shadow is the identity's (--shadow-*) or a hard offset in an identity color.
    for (const m of t.recipe.css.matchAll(/box-shadow:([^;}]+)/g))
      assert.match(m[1], /^(var\(--shadow-(sm|md|lg)\)|\d+px \d+px 0 var\(--color-[a-z-]+\))$/, `${t.id}: ${m[1]}`);
    const s = sources.find((x) => x.name === t.source.name);
    assert.ok(s && s.license === t.source.license, `${t.id}: source and license recorded`);
    assert.equal(t.rtl.supported, true, t.id);
  }
});
