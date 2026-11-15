'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const generate = require('../picker/js/core/generate.js');

const LINT_BIN = path.join(__dirname, '..', 'node_modules', '@google', 'design.md', 'dist', 'index.js');

function lint(markdown) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hawiya-lint-'));
  const file = path.join(dir, 'DESIGN.md');
  fs.writeFileSync(file, markdown);
  try {
    const out = execFileSync(process.execPath, [LINT_BIN, 'lint', '--format', 'json', file], { encoding: 'utf8' });
    return JSON.parse(out);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const BASE = { name: 'مؤسسي هادئ', primary: '#2563eb', fontFamily: 'IBM Plex Sans Arabic', radius: 8 };

// Linted cases: the 5 swatches, the 3 fonts, radius extremes, plus custom-picker colors chosen to be
// hard: very light, mid-luminance (where neither black nor white text is comfortable), and the
// counterexamples found in review (#ff0000, #0582c3, #7b7b7b, #006eff, #767676, #777777).
// The full color space is covered by the sweep test further below.
const CASES = [
  BASE,
  { ...BASE, primary: '#0f766e' },
  { ...BASE, primary: '#7c3aed' },
  { ...BASE, primary: '#b91c1c' },
  { ...BASE, primary: '#1f2937' },
  { ...BASE, primary: '#facc15' },
  { ...BASE, primary: '#ffffff' },
  { ...BASE, primary: '#000000' },
  { ...BASE, primary: '#ff0000' },
  { ...BASE, primary: '#0582c3' },
  { ...BASE, primary: '#7b7b7b' },
  { ...BASE, primary: '#006eff' },
  { ...BASE, primary: '#767676' },
  { ...BASE, primary: '#777777' },
  { ...BASE, fontFamily: 'Cairo' },
  { ...BASE, fontFamily: 'Tajawal' },
  { ...BASE, radius: 0 },
  { ...BASE, radius: 24 },
  { ...BASE, name: 'اسم: فيه "علامات" و#رموز\nوسطر جديد' }
];

for (const input of CASES) {
  const label = `${input.primary} / ${input.fontFamily} / ${input.radius}px / ${JSON.stringify(input.name)}`;

  test(`DESIGN.md passes official lint with 0 errors and 0 warnings: ${label}`, () => {
    const files = generate(input);
    const report = lint(files['DESIGN.md']);
    const problems = report.findings.filter((f) => f.severity !== 'info');
    assert.deepEqual(problems, [], JSON.stringify(problems, null, 2));
    assert.equal(report.summary.errors, 0);
    assert.equal(report.summary.warnings, 0);
  });

  test(`identity.json is valid JSON and carries the choices: ${label}`, () => {
    const files = generate(input);
    const identity = JSON.parse(files['identity.json']);
    assert.equal(identity.tokens.color.primary, input.primary.toLowerCase());
    assert.equal(identity.tokens.font.family, input.fontFamily);
    assert.equal(identity.tokens.radius.md, input.radius);
    assert.equal(identity.project.direction, 'rtl');
  });
}

test('DESIGN.md frontmatter carries the chosen values', () => {
  const md = generate(BASE)['DESIGN.md'];
  assert.match(md, /^---\n/);
  assert.match(md, /\n {2}primary: "#2563eb"\n/);
  assert.match(md, /fontFamily: "IBM Plex Sans Arabic"/);
  assert.match(md, /\n {2}md: "8px"\n/);
});

test('generator is deterministic: same input gives byte-identical files', () => {
  const a = generate(BASE);
  const b = generate({ ...BASE });
  assert.deepEqual(Object.keys(a).sort(), ['DESIGN.md', 'identity.json']);
  assert.equal(a['DESIGN.md'], b['DESIGN.md']);
  assert.equal(a['identity.json'], b['identity.json']);
});

// Independent WCAG 2.x contrast, written separately from the generator on purpose.
function lum(hex) {
  const v = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = v.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a, b) {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
const hex2 = (n) => n.toString(16).padStart(2, '0');

test('sweep of 4,913 colors across sRGB: on-primary and accent text always reach WCAG AA (4.5:1)', () => {
  const steps = [];
  for (let c = 0; c <= 255; c += 16) steps.push(c);
  steps.push(255);
  let checked = 0;
  let worst = { ratio: Infinity };
  for (const r of steps) for (const g of steps) for (const b of steps) {
    const primary = `#${hex2(r)}${hex2(g)}${hex2(b)}`;
    const d = generate.derive({ ...BASE, primary });
    const onPrimary = ratio(primary, d.onPrimary);
    const accent = ratio(d.accentText, '#ffffff');
    if (onPrimary < worst.ratio) worst = { primary, ratio: onPrimary };
    assert.ok(onPrimary >= 4.5, `on-primary ${d.onPrimary} on ${primary} = ${onPrimary.toFixed(3)}`);
    assert.ok(accent >= 4.5, `accent ${d.accentText} on #ffffff = ${accent.toFixed(3)}`);
    checked++;
  }
  assert.equal(checked, 17 ** 3);
  assert.ok(worst.ratio >= 4.58, `worst ${worst.primary} ${worst.ratio}`);
});

test('accent text uses primary only when primary itself reaches AA on the white surface', () => {
  assert.equal(generate.derive({ ...BASE, primary: '#2563eb' }).accentText, '#2563eb');
  assert.equal(generate.derive({ ...BASE, primary: '#facc15' }).accentText, '#111827');
  const md = generate({ ...BASE, primary: '#facc15' })['DESIGN.md'];
  assert.match(md, /button-secondary:\n {4}backgroundColor: "\{colors.surface\}"\n {4}textColor: "\{colors.on-surface\}"/);
  assert.match(md, /too light for text on surface/);
});

test('name: long names are cut on whole characters, bidi controls and lone surrogates removed', () => {
  const longEmoji = generate.derive({ ...BASE, name: 'x'.repeat(79) + '😀😀' }).name;
  assert.equal(Array.from(longEmoji).length, 80);
  assert.ok(longEmoji.endsWith('😀'));
  assert.doesNotMatch(longEmoji, /[\ud800-\udbff](?![\udc00-\udfff])/);

  const bidi = generate.derive({ ...BASE, name: 'هوية\u202Eخبيثة\u2066x\u2069\u061C' }).name;
  assert.equal(bidi, 'هويةخبيثةx');

  const lone = generate.derive({ ...BASE, name: 'a\ud83db' }).name;
  assert.equal(lone, 'ab');

  assert.equal(generate.derive({ ...BASE, name: '\u202E\u200F  ' }).name, 'Hawiya identity');
});

test('no left/right physical properties or Arabic-hostile typography in output', () => {
  const md = generate(BASE)['DESIGN.md'];
  assert.doesNotMatch(md, /letterSpacing/);
  assert.doesNotMatch(md, /\b(margin|padding)-(left|right)\b/);
});

test('rejects invalid input instead of producing a broken file', () => {
  assert.throws(() => generate({ ...BASE, primary: 'blue' }), /primary/);
  assert.throws(() => generate({ ...BASE, primary: '#12345' }), /primary/);
  assert.throws(() => generate({ ...BASE, radius: -2 }), /radius/);
  assert.throws(() => generate({ ...BASE, radius: 7.5 }), /radius/);
  assert.throws(() => generate({ ...BASE, radius: 500 }), /radius/);
  assert.throws(() => generate({ ...BASE, fontFamily: '' }), /fontFamily/);
  assert.throws(() => generate({ ...BASE, fontFamily: 'Evil"\n---' }), /fontFamily/);
  assert.throws(() => generate(null), /input/);
});

/* =====================================================================================================
 * Task 1.8: value files generated from a full identity (identity.json, tokens.json, tokens.css, theme.css).
 * ===================================================================================================== */

const validateMod = require('../picker/js/core/validate.js');
const modes = require('../picker/js/core/modes.js');
const scaleMod = require('../picker/js/core/scale.js');
const chrome = require('./helpers/chrome.js');

const ID_DIR = path.join(__dirname, 'fixtures', 'identity');
const IDENTITIES = fs
  .readdirSync(path.join(ID_DIR, 'valid'))
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => [f, JSON.parse(fs.readFileSync(path.join(ID_DIR, 'valid', f), 'utf8'))]);
const VALUE_FILES = ['identity.json', 'tokens.json', 'tokens.css', 'theme.css'];
const ROLES = modes.KEYS;
const kebab = (s) => s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
const RAMP_STEPS = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'];

// More identities: every sample re-colored from primary colors across the hue circle (modes.derive, task 1.5),
// with type scales from scale.generate (task 1.6). They must all pass the same checks.
function derivedIdentities() {
  const out = [];
  const colors = ['#000000', '#ffffff', '#ff0000', '#facc15', '#0f766e', '#7c3aed', '#3b82f6', '#808080', '#f97316', '#0ea5e9', '#22c55e', '#ec4899'];
  colors.forEach((hex, i) => {
    const [f, base] = IDENTITIES[i % IDENTITIES.length];
    const doc = structuredClone(base);
    const m = modes.derive(hex);
    doc.tokens.color = { light: m.light, dark: m.dark, ramps: m.ramps };
    const ts = [
      { base: 16, ratio: 1.25, steps: 6, below: 1 },
      { base: 14, ratio: 1.2, steps: 8, below: 2 },
      { base: 18, ratio: 1.333, steps: 5, below: 0 },
      { base: 16, ratio: 1.067, steps: 12, below: 3 }
    ][i % 4];
    doc.tokens.typeScale = { base: ts.base, ratio: ts.ratio, steps: scaleMod.generate(ts) };
    out.push([`${f} recolored ${hex}`, doc]);
  });
  return out;
}
const ALL_IDENTITIES = IDENTITIES.concat(derivedIdentities());

/* ---------- small parsers used by the checks (independent of the generator) ---------- */

function hexToComponents(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
}

// "selector { --a: 1; --b: 2; }" blocks → [{ selector, vars: Map }], nested @media/@layer flattened with context.
function cssBlocks(css) {
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks = [];
  const stack = [];
  let buf = '';
  for (const ch of noComments) {
    if (ch === '{') {
      stack.push({ head: buf.trim(), body: '' });
      buf = '';
    } else if (ch === '}') {
      const b = stack.pop();
      assert.ok(b, 'unbalanced }');
      const decls = (b.body + buf).trim();
      buf = '';
      const vars = new Map();
      for (const d of decls.split(';').map((x) => x.trim()).filter(Boolean)) {
        const m = /^(--[a-z0-9-]+|color-scheme)\s*:\s*([\s\S]+)$/.exec(d);
        if (m) vars.set(m[1], m[2].trim());
      }
      blocks.push({ head: b.head, context: stack.map((s) => s.head), vars });
    } else if (stack.length) {
      if (ch === ';' || /\S|\s/.test(ch)) buf += ch;
    } else {
      buf += ch;
    }
    if (stack.length && ch === ';') {
      stack[stack.length - 1].body += buf;
      buf = '';
    }
  }
  assert.equal(stack.length, 0, 'unbalanced {');
  return blocks;
}

/* ---------- DTCG 2025.10 structural check (written from the specification, independent of the generator) ---------- */

const TOKEN_PROPS = new Set(['$value', '$type', '$description', '$extensions', '$deprecated']);
const GROUP_PROPS = new Set(['$type', '$description', '$extensions', '$extends', '$deprecated']);
const NUM = (x) => typeof x === 'number' && Number.isFinite(x);

function checkColor(v, where) {
  assert.ok(v && typeof v === 'object' && !Array.isArray(v), `${where}: color value must be an object`);
  for (const k of Object.keys(v)) assert.ok(['colorSpace', 'components', 'alpha', 'hex'].includes(k), `${where}: unknown color field ${k}`);
  assert.equal(v.colorSpace, 'srgb', where);
  assert.ok(Array.isArray(v.components) && v.components.length === 3, `${where}: 3 components`);
  for (const c of v.components) assert.ok(NUM(c) && c >= 0 && c <= 1, `${where}: component ${c} outside 0..1`);
  if ('alpha' in v) assert.ok(NUM(v.alpha) && v.alpha >= 0 && v.alpha <= 1, `${where}: alpha`);
  if ('hex' in v) {
    assert.match(v.hex, /^#[0-9a-f]{6}$/, `${where}: hex must be 6-digit CSS hex`);
    hexToComponents(v.hex).forEach((c, i) => assert.ok(Math.abs(c - v.components[i]) <= 0.5 / 255, `${where}: hex and components disagree`));
  }
}

function checkDimension(v, where) {
  assert.ok(v && typeof v === 'object' && NUM(v.value) && ['px', 'rem'].includes(v.unit) && Object.keys(v).length === 2, `${where}: dimension ${JSON.stringify(v)}`);
}

function checkShadowLayer(v, where) {
  assert.ok(v && typeof v === 'object' && !Array.isArray(v), `${where}: shadow layer must be an object`);
  for (const k of Object.keys(v)) assert.ok(['color', 'offsetX', 'offsetY', 'blur', 'spread', 'inset'].includes(k), `${where}: unknown shadow field ${k}`);
  checkColor(v.color, `${where}.color`);
  for (const k of ['offsetX', 'offsetY', 'blur', 'spread']) checkDimension(v[k], `${where}.${k}`);
  if ('inset' in v) assert.equal(typeof v.inset, 'boolean', `${where}: inset`);
}

const CHECK_VALUE = {
  color: checkColor,
  dimension: checkDimension,
  number: (v, w) => assert.ok(NUM(v), `${w}: number`),
  fontFamily: (v, w) => assert.ok(typeof v === 'string' || (Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === 'string' && s)), `${w}: fontFamily`),
  shadow: (v, w) => (Array.isArray(v) ? (assert.ok(v.length > 0, `${w}: empty shadow list`), v.forEach((l, i) => checkShadowLayer(l, `${w}[${i}]`))) : checkShadowLayer(v, w))
};

// Returns Map("a.b.c" → { type, value }) of all tokens.
function checkDtcg(doc) {
  const tokens = new Map();
  const walk = (node, pathParts, inheritedType) => {
    const where = pathParts.join('.') || '(root)';
    assert.ok(node && typeof node === 'object' && !Array.isArray(node), `${where}: must be an object`);
    if (pathParts.length) {
      const name = pathParts[pathParts.length - 1];
      assert.ok(!name.startsWith('$') && !/[{}.]/.test(name), `${where}: invalid name`);
    }
    if ('$value' in node) {
      for (const k of Object.keys(node)) assert.ok(TOKEN_PROPS.has(k), `${where}: token has ${k}`);
      const type = node.$type || inheritedType;
      assert.ok(type && CHECK_VALUE[type], `${where}: no known $type`);
      CHECK_VALUE[type](node.$value, where);
      if ('$description' in node) assert.equal(typeof node.$description, 'string');
      if ('$extensions' in node) assert.ok(node.$extensions && typeof node.$extensions === 'object');
      tokens.set(where, { type, value: node.$value });
      return;
    }
    const type = node.$type || inheritedType;
    for (const [k, v] of Object.entries(node)) {
      if (k.startsWith('$')) {
        assert.ok(GROUP_PROPS.has(k), `${where}: group has ${k}`);
        continue;
      }
      walk(v, pathParts.concat(k), type);
    }
  };
  walk(doc, [], undefined);
  return tokens;
}

/* ---------- the tests ---------- */

test('[1.8] produces exactly the four value files, each ending with a newline', () => {
  for (const [f, id] of ALL_IDENTITIES) {
    const files = generate.valueFiles(id);
    assert.deepEqual(Object.keys(files).sort(), [...VALUE_FILES].sort(), f);
    for (const name of VALUE_FILES) {
      assert.equal(typeof files[name], 'string', `${f} ${name}`);
      assert.ok(files[name].endsWith('\n') && !files[name].endsWith('\n\n'), `${f} ${name} must end with one newline`);
    }
  }
});

test('[1.8] identity.json: same identity, passes the checker, keys in schema order whatever the input order', () => {
  const shuffle = (v, flip) => {
    if (Array.isArray(v)) return v.map((x) => shuffle(x, flip));
    if (v && typeof v === 'object') {
      const keys = Object.keys(v);
      if (flip) keys.reverse();
      else keys.sort();
      return Object.fromEntries(keys.map((k) => [k, shuffle(v[k], flip)]));
    }
    return v;
  };
  for (const [f, id] of ALL_IDENTITIES) {
    const text = generate.valueFiles(id)['identity.json'];
    const back = JSON.parse(text);
    assert.deepEqual(back, id, f);
    assert.equal(validateMod.checkText('identity', text).valid, true, f);
    assert.deepEqual(Object.keys(back), Object.keys(require('../schema/identity.schema.json').properties), `${f}: top-level order`);
    assert.equal(generate.valueFiles(shuffle(id, true))['identity.json'], text, `${f}: reversed keys`);
    assert.equal(generate.valueFiles(shuffle(id, false))['identity.json'], text, `${f}: sorted keys`);
  }
  // selections follow the element order of the schema, overrides are sorted
  const id = structuredClone(IDENTITIES[0][1]);
  // schema element order is colors, modes, fonts, ..., radius — not alphabetical (fonts < modes)
  id.selections = { radius: { template: 'radius-soft', overrides: { md: 8, lg: 12, 'a-b': 1 } }, fonts: { template: 'pair-x' }, modes: { template: 'modes-auto' }, colors: { template: 'palette-blue' } };
  const out = JSON.parse(generate.valueFiles(id)['identity.json']);
  assert.deepEqual(Object.keys(out.selections), ['colors', 'modes', 'fonts', 'radius']);
  assert.deepEqual(Object.keys(out.selections.radius.overrides), ['a-b', 'lg', 'md']);
});

test('[1.8] refuses an identity the checker rejects, and says why', () => {
  const { cases } = JSON.parse(fs.readFileSync(path.join(ID_DIR, 'invalid.json'), 'utf8'));
  const { applyCase } = require('./fixtures/mutate.js');
  const bases = Object.fromEntries(IDENTITIES);
  for (const c of cases) {
    const doc = applyCase(bases[c.base], c);
    assert.throws(() => generate.valueFiles(doc), (e) => /Hawiya\.generate: identity is not valid/.test(e.message) && Array.isArray(e.errors) && e.errors.length > 0, c.reason);
  }
  for (const bad of [null, 42, 'x', [], { ...IDENTITIES[0][1], schemaVersion: '0.1-prototype' }]) {
    assert.throws(() => generate.valueFiles(bad), /Hawiya\.generate/);
  }
});

test('[1.8] tokens.json follows DTCG 2025.10 and carries every value of the identity', () => {
  for (const [f, id] of ALL_IDENTITIES) {
    const doc = JSON.parse(generate.valueFiles(id)['tokens.json']);
    const t = checkDtcg(doc);
    const val = (p) => {
      assert.ok(t.has(p), `${f}: missing token ${p}`);
      return t.get(p).value;
    };
    for (const mode of ['light', 'dark']) {
      for (const role of ROLES) {
        const v = val(`color.${mode}.${kebab(role)}`);
        assert.equal(t.get(`color.${mode}.${kebab(role)}`).type, 'color');
        assert.equal(v.hex, id.tokens.color[mode][role], `${f} ${mode} ${role}`);
      }
      for (const size of ['sm', 'md', 'lg']) {
        const layers = id.tokens.shadow[mode][size];
        const v = val(`shadow.${mode}.${size}`);
        assert.equal(t.get(`shadow.${mode}.${size}`).type, 'shadow');
        const list = Array.isArray(v) ? v : [v];
        if (layers.length === 0) {
          assert.ok(list.every((l) => l.color.alpha === 0), `${f}: no shadow must be fully transparent`);
        } else {
          assert.equal(list.length, layers.length);
          list.forEach((l, i) => {
            assert.equal(l.color.hex, layers[i].color);
            assert.equal(l.color.alpha ?? 1, layers[i].alpha);
            assert.deepEqual([l.offsetX.value, l.offsetY.value, l.blur.value, l.spread.value], [layers[i].x, layers[i].y, layers[i].blur, layers[i].spread]);
            assert.equal(l.inset === true, layers[i].inset === true);
          });
        }
      }
    }
    for (const ramp of ['primary', 'secondary', 'neutral']) {
      RAMP_STEPS.forEach((s, i) => assert.equal(val(`color.ramp.${ramp}.${s}`).hex, id.tokens.color.ramps[ramp][i], `${f} ramp ${ramp} ${s}`));
    }
    for (const role of ['heading', 'body', 'numerals']) {
      const fam = val(`font.family.${role}`);
      const ref = id.tokens.font[role];
      assert.deepEqual(fam.slice(-ref.fallback.length), ref.fallback, `${f} ${role} fallback`);
      for (const n of [ref.latin, ref.arabic].filter(Boolean)) assert.ok(fam.includes(n), `${f} ${role} has ${n}`);
    }
    assert.equal(val('font.line-height.ar'), id.tokens.font.lineHeight.ar);
    assert.equal(val('font.line-height.en'), id.tokens.font.lineHeight.en);
    const sizes = [...t.entries()].filter(([p]) => p.startsWith('font.size.')).map(([, x]) => x.value);
    assert.deepEqual(sizes.map((s) => (s.unit === 'rem' ? s.value * 16 : s.value)), id.tokens.typeScale.steps, `${f} type scale`);
    assert.deepEqual(val('font.size.base'), { value: id.tokens.typeScale.base / 16, unit: 'rem' });
    for (const r of ['sm', 'md', 'lg', 'full']) assert.deepEqual(val(`radius.${r}`), { value: id.tokens.radius[r], unit: 'px' });
    assert.deepEqual(val('space.unit'), { value: id.tokens.spacing.unit, unit: 'px' });
    id.tokens.spacing.scale.forEach((s, i) => assert.deepEqual(val(`space.scale.${i}`), { value: s, unit: 'px' }));
    // what DTCG has no type for travels in $extensions
    const ext = doc.$extensions && doc.$extensions.hawiya;
    assert.ok(ext, `${f}: $extensions.hawiya`);
    assert.deepEqual(ext.project, id.project);
    assert.deepEqual(ext.extensions, id.extensions);
    assert.deepEqual(ext.leaveToAI, id.leaveToAI);
    assert.equal(typeof doc.$description, 'string');
  }
});

test('[1.8] tokens.css: light values by default, the same names with dark values for the dark mode', () => {
  for (const [f, id] of ALL_IDENTITIES) {
    const blocks = cssBlocks(generate.valueFiles(id)['tokens.css']);
    const root = blocks.find((b) => b.head === ':root' && b.context.length === 0);
    const media = blocks.find((b) => b.head === ':root:not([data-theme="light"])' && b.context[0] === '@media (prefers-color-scheme: dark)');
    const forced = blocks.find((b) => b.head === ':root[data-theme="dark"]' && b.context.length === 0);
    assert.ok(root && media && forced, `${f}: blocks ${blocks.map((b) => b.head)}`);
    assert.equal(root.vars.get('color-scheme'), 'light');
    for (const b of [media, forced]) assert.equal(b.vars.get('color-scheme'), 'dark');
    for (const role of ROLES) {
      const name = `--color-${kebab(role)}`;
      assert.equal(root.vars.get(name), id.tokens.color.light[role], `${f} ${name}`);
      assert.equal(media.vars.get(name), id.tokens.color.dark[role], `${f} dark ${name}`);
      assert.equal(forced.vars.get(name), id.tokens.color.dark[role], `${f} forced dark ${name}`);
    }
    assert.deepEqual([...media.vars], [...forced.vars], 'both dark blocks are identical');
    for (const k of media.vars.keys()) assert.ok(root.vars.has(k), `${f}: dark sets ${k} that light does not`);
    for (const ramp of ['primary', 'secondary', 'neutral']) RAMP_STEPS.forEach((s, i) => assert.equal(root.vars.get(`--color-${ramp}-${s}`), id.tokens.color.ramps[ramp][i]));
    for (const r of ['sm', 'md', 'lg', 'full']) assert.equal(root.vars.get(`--radius-${r}`), `${id.tokens.radius[r]}px`);
    for (const role of ['heading', 'body', 'numerals']) {
      const stack = root.vars.get(`--font-${role}`);
      const ref = id.tokens.font[role];
      for (const n of [ref.latin, ref.arabic].filter(Boolean)) assert.ok(stack.includes(`"${n}"`), `${f}: font names are quoted: ${stack}`);
      assert.ok(stack.endsWith(ref.fallback.join(', ')), `${f}: generic fallbacks last and unquoted: ${stack}`);
    }
    assert.equal(root.vars.get('--line-height-ar'), String(id.tokens.font.lineHeight.ar));
    assert.equal(root.vars.get('--line-height-en'), String(id.tokens.font.lineHeight.en));
    assert.equal(root.vars.get('--font-size-base'), `${id.tokens.typeScale.base / 16}rem`);
    id.tokens.spacing.scale.forEach((s, i) => assert.equal(root.vars.get(`--space-${i}`), `${s}px`));
    for (const size of ['sm', 'md', 'lg']) {
      assert.ok(root.vars.has(`--shadow-${size}`) && media.vars.has(`--shadow-${size}`), `${f}: shadow ${size} in both modes`);
      if (id.tokens.shadow.light[size].length === 0) assert.equal(root.vars.get(`--shadow-${size}`), '0 0 #0000');
    }
  }
});

test('[1.8] shadows are written exactly (offsets, blur, spread, color with alpha, inset)', () => {
  const id = structuredClone(IDENTITIES[0][1]);
  id.tokens.shadow.light.md = [
    { x: 0, y: 4, blur: 12, spread: -2, color: '#1f2937', alpha: 0.08 },
    { x: 0, y: 1, blur: 0, spread: 1, color: '#000000', alpha: 1, inset: true }
  ];
  id.tokens.shadow.light.sm = [];
  const root = cssBlocks(generate.valueFiles(id)['tokens.css']).find((b) => b.head === ':root');
  assert.equal(root.vars.get('--shadow-md'), '0px 4px 12px -2px rgb(31 41 55 / 0.08), inset 0px 1px 0px 1px rgb(0 0 0 / 1)');
  assert.equal(root.vars.get('--shadow-sm'), '0 0 #0000', 'not "none": a shadow list containing none is invalid and would drop focus rings');
  const tok = JSON.parse(generate.valueFiles(id)['tokens.json']).shadow.light;
  assert.deepEqual(tok.md.$value, [
    { color: { colorSpace: 'srgb', components: [0.1216, 0.1608, 0.2157], alpha: 0.08, hex: '#1f2937' }, offsetX: { value: 0, unit: 'px' }, offsetY: { value: 4, unit: 'px' }, blur: { value: 12, unit: 'px' }, spread: { value: -2, unit: 'px' } },
    { color: { colorSpace: 'srgb', components: [0, 0, 0], hex: '#000000' }, offsetX: { value: 0, unit: 'px' }, offsetY: { value: 1, unit: 'px' }, blur: { value: 0, unit: 'px' }, spread: { value: 1, unit: 'px' }, inset: true }
  ]);
  assert.equal(tok.sm.$value.color.alpha, 0, 'no shadow = fully transparent layer');
});

test('[1.8] theme.css is a Tailwind v4 theme: @theme with the documented namespaces, dark values switched by variables', () => {
  for (const [f, id] of ALL_IDENTITIES) {
    const css = generate.valueFiles(id)['theme.css'];
    assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), /@import/, `${f}: a shared theme file does not import tailwindcss itself`);
    const blocks = cssBlocks(css);
    const theme = blocks.find((b) => b.head === '@theme' && b.context.length === 0);
    assert.ok(theme, `${f}: @theme block`);
    for (const role of ROLES) assert.equal(theme.vars.get(`--color-${kebab(role)}`), id.tokens.color.light[role]);
    for (const ramp of ['primary', 'secondary', 'neutral']) RAMP_STEPS.forEach((s, i) => assert.equal(theme.vars.get(`--color-${ramp}-${s}`), id.tokens.color.ramps[ramp][i]));
    for (const role of ['heading', 'body', 'numerals']) assert.ok(theme.vars.has(`--font-${role}`));
    assert.equal(theme.vars.get('--font-sans'), theme.vars.get('--font-body'));
    const textSizes = [...theme.vars.keys()].filter((k) => /^--text-[a-z0-9]+$/.test(k));
    assert.equal(textSizes.length, id.tokens.typeScale.steps.length, `${f}: one --text-* per step`);
    for (const k of textSizes) assert.ok(theme.vars.has(`${k}--line-height`), `${f}: ${k}--line-height`);
    assert.equal(theme.vars.get('--text-base'), `${id.tokens.typeScale.base / 16}rem`);
    assert.equal(theme.vars.get('--leading-ar'), String(id.tokens.font.lineHeight.ar));
    assert.equal(theme.vars.get('--leading-en'), String(id.tokens.font.lineHeight.en));
    for (const r of ['sm', 'md', 'lg', 'full']) assert.equal(theme.vars.get(`--radius-${r}`), `${id.tokens.radius[r]}px`);
    // Tailwind copies @theme shadow values into utilities at build time: they must point at runtime variables
    for (const s of ['sm', 'md', 'lg']) assert.equal(theme.vars.get(`--shadow-${s}`), `var(--hawiya-shadow-${s})`);
    assert.equal(theme.vars.get('--spacing'), `${id.tokens.spacing.unit}px`);
    const light = blocks.find((b) => b.head === ':root' && b.context.join('|') === '@layer theme');
    const media = blocks.find((b) => b.head === ':root:not([data-theme="light"])' && b.context.join('|') === '@layer theme|@media (prefers-color-scheme: dark)');
    const forced = blocks.find((b) => b.head === ':root[data-theme="dark"]' && b.context.join('|') === '@layer theme');
    assert.ok(light && media && forced, `${f}: mode values inside @layer theme`);
    assert.equal(light.vars.get('color-scheme'), 'light');
    for (const b of [media, forced]) assert.equal(b.vars.get('color-scheme'), 'dark');
    const tokensRoot = cssBlocks(generate.valueFiles(id)['tokens.css']).find((b) => b.head === ':root');
    const tokensDark = cssBlocks(generate.valueFiles(id)['tokens.css']).find((b) => b.head === ':root[data-theme="dark"]');
    for (const s of ['sm', 'md', 'lg']) {
      assert.equal(light.vars.get(`--hawiya-shadow-${s}`), tokensRoot.vars.get(`--shadow-${s}`), `${f}: light shadow ${s}`);
      assert.equal(media.vars.get(`--hawiya-shadow-${s}`), tokensDark.vars.get(`--shadow-${s}`), `${f}: dark shadow ${s}`);
      assert.equal(forced.vars.get(`--hawiya-shadow-${s}`), tokensDark.vars.get(`--shadow-${s}`), `${f}: forced dark shadow ${s}`);
    }
    for (const role of ROLES) {
      assert.equal(media.vars.get(`--color-${kebab(role)}`), id.tokens.color.dark[role]);
      assert.equal(forced.vars.get(`--color-${kebab(role)}`), id.tokens.color.dark[role]);
    }
    // the dark: variant follows the same rule as the variables
    const variant = blocks.filter((b) => b.context[0] === '@custom-variant dark').map((b) => b.head);
    assert.deepEqual(variant, [
      '&:where(:root:not([data-theme="light"]), :root:not([data-theme="light"]) *)',
      '@media (prefers-color-scheme: dark)',
      '&:where([data-theme="dark"], [data-theme="dark"] *)'
    ], `${f}: @custom-variant dark`);
  }
});

test('[1.8] no left / right anywhere in the generated CSS or token names (logical properties only, R-092)', () => {
  for (const [f, id] of ALL_IDENTITIES) {
    const files = generate.valueFiles(id);
    for (const name of ['tokens.css', 'theme.css']) assert.doesNotMatch(files[name], /\b(left|right)\b/i, `${f} ${name}`);
    const keys = [];
    JSON.parse(files['tokens.json'], (k, v) => (keys.push(k), v));
    assert.ok(!keys.some((k) => /\b(left|right)\b/i.test(k)), `${f}: tokens.json key`);
  }
});

test('[1.8] the identity name never reaches the CSS, and is escaped in JSON', () => {
  const id = structuredClone(IDENTITIES[0][1]);
  id.name = 'X */ body { display: none } /* "quoted" \\ back';
  assert.equal(validateMod.check('identity', id).valid, true);
  const files = generate.valueFiles(id);
  for (const name of ['tokens.css', 'theme.css']) assert.ok(!files[name].includes('display: none') && !files[name].includes(id.name), name);
  assert.ok(JSON.parse(files['tokens.json']).$description.includes(id.name));
  assert.equal(JSON.parse(files['identity.json']).name, id.name);
});

test('[1.8] same identity, same bytes (no dates, no randomness)', () => {
  for (const [f, id] of ALL_IDENTITIES) {
    const a = generate.valueFiles(id);
    const b = generate.valueFiles(structuredClone(id));
    for (const name of VALUE_FILES) assert.equal(a[name], b[name], `${f} ${name}`);
    assert.doesNotMatch(Object.values(a).join('\n'), /20\d\d-\d\d-\d\d|T\d\d:\d\d/, `${f}: no dates`);
  }
});

test('[1.8] a test page colored only by tokens.css shows the light and dark values in a real browser', async (t) => {
  const c = await chrome.launch();
  if (!c) return t.skip('Chrome not found (set CHROME_PATH to run this check)');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hawiya-tokens-'));
  try {
    const id = IDENTITIES.find(([f]) => f === 'identity-bilingual-landing.json')[1];
    fs.writeFileSync(path.join(dir, 'tokens.css'), generate.valueFiles(id)['tokens.css']);
    fs.writeFileSync(
      path.join(dir, 'page.html'),
      `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><link rel="stylesheet" href="tokens.css"><style>
        body { background: var(--color-background); color: var(--color-on-surface); font-family: var(--font-body); line-height: var(--line-height-ar); margin: 0; }
        .btn { background: var(--color-primary); color: var(--color-on-primary); border-radius: var(--radius-md); padding-inline: var(--space-4); font-size: var(--font-size-lg); box-shadow: var(--shadow-md); }
        .card { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-lg); }
      </style></head><body><div class="card"><button class="btn">زر</button></div></body></html>`
    );
    await c.open('file://' + path.join(dir, 'page.html'));
    const read = () =>
      c.eval(`(() => { const s = (q) => getComputedStyle(document.querySelector(q)); const toHex = (rgb) => '#' + rgb.match(/\\d+/g).slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('');
        return { bg: toHex(s('body').backgroundColor), text: toHex(s('body').color), btn: toHex(s('.btn').backgroundColor), btnText: toHex(s('.btn').color),
          card: toHex(s('.card').backgroundColor), border: toHex(s('.card').borderTopColor), radius: s('.btn').borderTopLeftRadius, pad: s('.btn').paddingInlineStart,
          size: s('.btn').fontSize, font: s('body').fontFamily, scheme: s('html').colorScheme }; })()`);
    const expect = (mode) => ({
      bg: id.tokens.color[mode].background,
      text: id.tokens.color[mode].onSurface,
      btn: id.tokens.color[mode].primary,
      btnText: id.tokens.color[mode].onPrimary,
      card: id.tokens.color[mode].surface,
      border: id.tokens.color[mode].border
    });
    const pick = (r) => ({ bg: r.bg, text: r.text, btn: r.btn, btnText: r.btnText, card: r.card, border: r.border });
    const setTheme = (v) => c.eval(v ? `document.documentElement.setAttribute('data-theme', '${v}')` : `document.documentElement.removeAttribute('data-theme')`);

    await c.media([{ name: 'prefers-color-scheme', value: 'light' }]);
    let r = await read();
    assert.deepEqual(pick(r), expect('light'), 'system light');
    assert.equal(r.radius, `${id.tokens.radius.md}px`);
    assert.equal(r.pad, `${id.tokens.spacing.scale[4]}px`);
    assert.equal(r.size, `${id.tokens.typeScale.steps[id.tokens.typeScale.steps.indexOf(id.tokens.typeScale.base) + 1]}px`);
    assert.match(r.font, /^"IBM Plex Sans", "IBM Plex Sans Arabic", system-ui, sans-serif$/);
    assert.equal(r.scheme, 'light');

    await c.media([{ name: 'prefers-color-scheme', value: 'dark' }]);
    r = await read();
    assert.deepEqual(pick(r), expect('dark'), 'system dark');
    assert.equal(r.scheme, 'dark');

    await setTheme('light');
    assert.deepEqual(pick(await read()), expect('light'), 'system dark, page forces light');
    await c.media([{ name: 'prefers-color-scheme', value: 'light' }]);
    await setTheme('dark');
    assert.deepEqual(pick(await read()), expect('dark'), 'system light, page forces dark');
    await setTheme(null);
    assert.deepEqual(pick(await read()), expect('light'), 'back to system light');
  } finally {
    c.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('[1.8] generate.js source is plain ASCII, so the generated bytes never depend on the page charset', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'picker', 'js', 'core', 'generate.js'), 'utf8');
  const bad = [...src].map((ch, i) => [ch, i]).filter(([ch]) => ch.charCodeAt(0) > 0x7e);
  assert.deepEqual(bad.slice(0, 5), []);
});
