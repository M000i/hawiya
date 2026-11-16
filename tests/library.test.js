'use strict';
// Task 2.2: the starter library (library/) is complete, valid, sourced and licensed,
// and the committed page data (picker/data/) is exactly what the library builds to.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const build = require('../tools/build.js');
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

test('every element has 2-3 reviewed templates and both identities are published', () => {
  for (const e of build.ELEMENTS) {
    const list = lib.templates[e].filter((t) => t.status.state === 'reviewed'); // drafts wait for review
    assert.ok(
      list.length >= 2 && list.length <= (e === 'fonts' || e === 'icons' ? 5 : 3),
      `${e}: ${list.length} templates`
    );
    assert.equal(sel.data.templates[e].length, list.length, `${e}: every starter template is reviewed`);
  }
  assert.deepEqual(sel.data.identities.map((i) => i.id).sort(), ['calm-corporate', 'warm-friendly']);
  assert.deepEqual(sel.summary.identities.excluded, []);
  // The two identities differ in most choices, so they show the range of the library.
  const [a, b] = sel.data.identities;
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
    const names = [t.extras.arabic, t.extras.latin].filter((n, i, all) => n && all.indexOf(n) === i);
    for (const role of ['heading', 'body', 'numerals']) {
      assert.equal(t.tokens.font[role].$type, 'fontFamily');
      assert.deepEqual(t.tokens.font[role].$value.slice(0, names.length), names, `${t.id} ${role}`);
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
  // The ready identity's button and card stay inside each other: the card corner is the larger one.
  for (const t of lib.templates.buttons) assert.match(t.recipe.css, /\.hw-btn\{[^}]*border-radius:var\(--radius-md\)/);
  for (const t of lib.templates.cards) assert.match(t.recipe.css, /\.hw-card\{[^}]*border-radius:var\(--radius-lg\)/);
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

test('colors: about 60 palettes from Radix Colors, Tailwind CSS and Open Color, each with tags, three metrics and its source (task 3.6)', () => {
  const palettes = lib.templates.colors;
  assert.ok(palettes.length >= 55, `${palettes.length} palettes`);
  const LABEL = { 'Radix Colors': 'Radix Colors ', 'Tailwind CSS': 'Tailwind CSS v3 ', 'Open Color': 'Open Color ' };
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
  for (const name of Object.keys(LABEL)) assert.ok(per[name] >= 15, `${name}: ${per[name]} palettes`);
});
