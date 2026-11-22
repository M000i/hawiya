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

// "selector { --a: 1; --b: 2; }" blocks → [{ selector, vars: Map }], nested @media/@layer flattened with context;
// top-level statements such as @import are skipped.
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
    } else if (ch === ';') {
      buf = ''; // a statement at-rule at the top level (@import, CHG-5) ends here and heads no block
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
    // CHG-4 (task 6.2): the fixture's pair has a Latin size adjustment (0.96), so the stack starts with the adjusted family.
    assert.match(r.font, /^"IBM Plex Sans Hawiya 96", "IBM Plex Sans", "IBM Plex Sans Arabic", system-ui, sans-serif$/);
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

/* =====================================================================================================
 * Task 1.9: the full DESIGN.md from a full identity.
 * ===================================================================================================== */

const contrastMod = require('../picker/js/core/contrast.js');

function exportDtcg(markdown) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hawiya-export-'));
  const file = path.join(dir, 'DESIGN.md');
  fs.writeFileSync(file, markdown);
  try {
    return JSON.parse(execFileSync(process.execPath, [LINT_BIN, 'export', '--format', 'dtcg', file], { encoding: 'utf8' }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const SECTIONS_1_9 = [
  'Overview', 'Colors', 'Typography', 'Layout', 'Elevation & Depth', 'Shapes', 'Components', "Do's and Don'ts",
  'Iconography', 'Motion', 'Numbers & Calendar', 'Arabic & Direction (العربي والاتجاه)'
];

function sectionText(md, title) {
  const body = md.split('\n---\n').slice(1).join('\n---\n');
  const start = body.indexOf(`\n## ${title}\n`);
  assert.ok(start !== -1, `missing section ${title}`);
  const next = body.indexOf('\n## ', start + 4);
  return body.slice(start, next === -1 ? undefined : next);
}

const mainFont = (id, role) => {
  const ref = id.tokens.font[role];
  return id.project.language === 'en' ? ref.latin || ref.arabic : ref.arabic || ref.latin;
};

test('[1.9] DESIGN.md passes the official lint with 0 errors and 0 warnings for every identity', () => {
  for (const [f, id] of ALL_IDENTITIES) {
    const report = lint(generate.designMd(id));
    const problems = report.findings.filter((x) => x.severity !== 'info');
    assert.deepEqual(problems, [], `${f}: ${JSON.stringify(problems, null, 2)}`);
    assert.equal(report.summary.errors, 0);
    assert.equal(report.summary.warnings, 0);
  }
});

test('[1.9] sections: the standard ones in order, then icons, motion, numbers & calendar, Arabic & direction', () => {
  for (const [f, id] of ALL_IDENTITIES) {
    const md = generate.designMd(id);
    const headings = md.split('\n').filter((l) => l.startsWith('## ')).map((l) => l.slice(3));
    assert.deepEqual(headings, SECTIONS_1_9, f);
    assert.match(md, /^---\nversion: alpha\nname: /, f);
    assert.ok(md.endsWith('\n') && !md.endsWith('\n\n'), `${f}: ends with one newline`);
  }
});

test('[1.9] front matter (read back by the official tool) carries the identity values', () => {
  for (const [f, id] of ALL_IDENTITIES) {
    const md = generate.designMd(id);
    const out = exportDtcg(md);
    const hex = (name) => {
      assert.ok(out.color && out.color[name], `${f}: color ${name} missing`);
      return out.color[name].$value.hex;
    };
    for (const role of ROLES) {
      assert.equal(hex(kebab(role)), id.tokens.color.light[role], `${f} light ${role}`);
      assert.equal(hex(`dark-${kebab(role)}`), id.tokens.color.dark[role], `${f} dark ${role}`);
    }
    const ui = generate.uiColors;
    for (const [mode, prefix] of [['light', ''], ['dark', 'dark-']]) {
      const c = ui(id.tokens.color[mode]);
      assert.equal(hex(`${prefix}focus-ring`), c.focusRing, `${f} ${mode} focus ring`);
      assert.equal(hex(`${prefix}control-border`), c.controlBorder, `${f} ${mode} control border`);
    }
    const fm = md.split('\n---\n')[0];
    for (const r of ['sm', 'md', 'lg', 'full']) assert.match(fm, new RegExp(`\\n  ${r}: "${id.tokens.radius[r]}px"\\n`), `${f} rounded ${r}`);
    assert.match(fm, new RegExp(`\\n  body-md:\\n    fontFamily: "${mainFont(id, 'body')}"\\n    fontSize: "${id.tokens.typeScale.base}px"\\n`), `${f}: body-md`);
    const numFont = id.extensions.numerals === 'arab' ? id.tokens.font.numerals.arabic || id.tokens.font.numerals.latin : id.tokens.font.numerals.latin || id.tokens.font.numerals.arabic;
    assert.match(fm, new RegExp(`\\n  numeric-md:\\n    fontFamily: "${numFont}"\\n`), `${f}: numeric-md uses the family that draws the digits`);
    const lh = id.project.language === 'en' ? id.tokens.font.lineHeight.en : id.tokens.font.lineHeight.ar;
    assert.equal(out.typography['body-md'].$value.lineHeight, lh, `${f}: line height survives the official read-back`);
    assert.equal(out.typography['body-md'].$value.fontSize.value, id.tokens.typeScale.base);
    assert.match(fm, /\n {4}fontFeature: "\\"tnum\\" 1"\n/, `${f}: tabular numbers`);
    id.tokens.spacing.scale.forEach((s, i) => assert.match(fm, new RegExp(`\\n  space-${i}: "${s}px"\\n`), `${f} space-${i}`));
    assert.match(fm, new RegExp(`\\n  unit: "${id.tokens.spacing.unit}px"\\n`));
    for (const size of id.tokens.typeScale.steps) assert.ok(fm.includes(`fontSize: "${size}px"`), `${f}: size ${size}`);
  }
});

test('[1.9] focus ring and control borders reach 3:1 against background and surface in both modes (closes B-001 for DESIGN.md)', () => {
  const check = (set, label) => {
    const c = generate.uiColors(set);
    for (const k of ['focusRing', 'controlBorder']) {
      for (const bg of [set.background, set.surface]) {
        assert.ok(contrastMod.ratio(c[k], bg) >= 3, `${label}: ${k} ${c[k]} on ${bg} = ${contrastMod.ratio(c[k], bg)}`);
      }
    }
    return c;
  };
  for (const [f, id] of ALL_IDENTITIES) for (const mode of ['light', 'dark']) check(id.tokens.color[mode], `${f} ${mode}`);
  // every primary on a 17-level grid of sRGB (4,913 colors), through the real mode derivation
  let usedPrimary = 0;
  let replaced = 0;
  for (let r = 0; r <= 255; r += 16) {
    for (let g = 0; g <= 255; g += 16) {
      for (let b = 0; b <= 255; b += 16) {
        const hex = '#' + [r, g, b].map((x) => Math.min(x, 255).toString(16).padStart(2, '0')).join('');
        const m = modes.derive(hex);
        for (const mode of ['light', 'dark']) {
          const c = check(m[mode], `${hex} ${mode}`);
          if (c.focusRing === m[mode].primary) usedPrimary++;
          else replaced++;
        }
      }
    }
  }
  assert.ok(usedPrimary > 0 && replaced > 0, `${usedPrimary} kept primary, ${replaced} replaced`);
  // the B-001 example: a light primary is not used for the ring on white
  const yellow = modes.derive('#ffff00').light;
  assert.notEqual(generate.uiColors(yellow).focusRing, yellow.primary);
});

test('[1.9] icons, motion, numbers, calendar, Arabic rules, mirroring and the Latin size adjustment are written out', () => {
  for (const [f, id] of ALL_IDENTITIES) {
    const md = generate.designMd(id);
    const ext = id.extensions;
    const icons = sectionText(md, 'Iconography');
    for (const v of [ext.icons.library, ext.icons.weight, ext.icons.fill, ext.icons.container]) assert.ok(icons.includes(v), `${f}: icons ${v}`);
    const motion = sectionText(md, 'Motion');
    assert.ok(motion.includes(`**${ext.motion}**`), `${f}: motion level`);
    assert.ok(motion.includes('prefers-reduced-motion'), `${f}: reduced motion`);
    const nums = sectionText(md, 'Numbers & Calendar');
    assert.ok(nums.includes(ext.numerals === 'arab' ? 'nu-arab' : 'nu-latn'), `${f}: numbering system`);
    assert.ok(nums.includes(`ca-${ext.calendar}`), `${f}: calendar`);
    assert.ok(nums.includes('tabular-nums'), `${f}: tabular numbers`);
    const ar = sectionText(md, SECTIONS_1_9[11]);
    for (const m of ext.rtl.mirror) assert.ok(ar.includes(`\`${m}\``), `${f}: mirror ${m}`);
    for (const m of ext.rtl.neverMirror) assert.ok(ar.includes(`\`${m}\``), `${f}: never mirror ${m}`);
    assert.ok(ar.indexOf('Mirror in right-to-left') < ar.indexOf('Never mirror'), f);
    assert.ok(ar.includes('margin-inline-start') && ar.includes('inset-inline-start'), `${f}: logical properties`);
    assert.ok(ar.includes(String(id.tokens.font.lineHeight.ar)), `${f}: Arabic line height`);
    for (const role of ['heading', 'body', 'numerals']) {
      const ref = id.tokens.font[role];
      if (ref.latinSizeAdjust !== undefined && ref.arabic && ref.latin) {
        assert.ok(sectionText(md, 'Typography').includes(`Latin size adjustment: **${ref.latinSizeAdjust}**`), `${f}: latin size adjust for ${role}`);
        assert.ok(sectionText(md, 'Typography').includes('size-adjust'), `${f}: how to apply it`);
      }
    }
    const lang = { ar: 'lang="ar" dir="rtl"', en: 'lang="en" dir="ltr"', 'ar+en': 'lang="ar" dir="rtl"' }[id.project.language];
    assert.ok(ar.includes(lang), `${f}: html lang/dir`);
    if (id.project.language === 'ar+en') assert.ok(ar.includes('lang="en" dir="ltr"'), `${f}: English pages`);
    // light and dark colors, and the shadows of both modes, are in the prose too
    const colors = sectionText(md, 'Colors');
    for (const role of ROLES) for (const mode of ['light', 'dark']) assert.ok(colors.includes(id.tokens.color[mode][role]), `${f} prose ${mode} ${role}`);
    const elev = sectionText(md, 'Elevation & Depth');
    assert.ok(elev.includes('data-theme'), `${f}: modes explained`);
    for (const l of id.leaveToAI) assert.ok(sectionText(md, 'Overview').includes(l), `${f}: left to AI ${l}`);
  }
});

test('[1.9] contrast figures in the prose are the measured ones, never rounded up to a threshold', () => {
  for (const [f, id] of ALL_IDENTITIES) {
    const md = generate.designMd(id);
    for (const mode of ['light', 'dark']) {
      const s = id.tokens.color[mode];
      const shown = contrastMod.display(contrastMod.ratio(s.onPrimary, s.primary));
      assert.ok(sectionText(md, 'Colors').includes(`${s.onPrimary} on ${s.primary}: ${shown}:1`), `${f} ${mode}: ${shown}`);
    }
  }
});

test('[1.9] the identity name cannot break the front matter or the markdown', () => {
  const id = structuredClone(IDENTITIES[0][1]);
  for (const name of ['## Colors', '"quoted" \\ name: x', '---', '*bold* _x_ [link](http://x) `code` | pipe', 'Right # name', 'هوية \u{1F3A8}']) {
    id.name = name;
    assert.equal(validateMod.check('identity', id).valid, true, name);
    const md = generate.designMd(id);
    const report = lint(md);
    assert.deepEqual(report.findings.filter((x) => x.severity !== 'info'), [], name);
    assert.deepEqual(md.split('\n').filter((l) => l.startsWith('## ')).map((l) => l.slice(3)), SECTIONS_1_9, name);
    assert.equal(md.split('\n').filter((l) => l === '---').length, 2, `${name}: exactly two front matter fences`);
    assert.ok(md.includes('\nname: ' + JSON.stringify(name) + '\n'), name);
  }
});

test('[1.9] same identity, same bytes; an invalid identity is refused', () => {
  for (const [f, id] of ALL_IDENTITIES) {
    assert.equal(generate.designMd(id), generate.designMd(structuredClone(id)), f);
    assert.doesNotMatch(generate.designMd(id), /20\d\d-\d\d-\d\d/, `${f}: no dates`);
  }
  assert.throws(() => generate.designMd({ ...IDENTITIES[0][1], schemaVersion: 2 }), /identity is not valid/);
});

test('[1.9] a ratio just under 4.5 is shown as 4.49, never 4.50; the heading carries no markdown from the name', () => {
  const id = structuredClone(IDENTITIES[0][1]);
  id.tokens.color.light.primary = '#6363f8'; // white on it: 4.4961:1
  id.tokens.color.light.onPrimary = '#ffffff';
  const md = generate.designMd(id);
  assert.ok(md.includes('#ffffff on #6363f8: 4.49:1'), 'measured value, not rounded up');
  assert.ok(!md.includes('#ffffff on #6363f8: 4.5:1'));
  id.name = '[click](javascript:alert(1)) *x* `y` #z';
  const heading = generate.designMd(id).split('\n---\n')[1].split('\n').find((l) => l.startsWith('# '));
  assert.doesNotMatch(heading.slice(2), /[[\]`*#<>|\\_]/, heading);
});

test('[1.9] focus ring and control border are real variables in tokens.css, theme.css and tokens.json, per mode', () => {
  for (const [f, id] of ALL_IDENTITIES) {
    const files = generate.valueFiles(id);
    const css = cssBlocks(files['tokens.css']);
    const theme = cssBlocks(files['theme.css']);
    const tok = JSON.parse(files['tokens.json']);
    for (const mode of ['light', 'dark']) {
      const ui = generate.uiColors(id.tokens.color[mode]);
      const cssBlock = css.find((b) => b.head === (mode === 'light' ? ':root' : ':root[data-theme="dark"]'));
      const themeBlock = theme.find((b) => b.head === (mode === 'light' ? '@theme' : ':root[data-theme="dark"]'));
      for (const [name, v] of [['focus-ring', ui.focusRing], ['control-border', ui.controlBorder]]) {
        assert.equal(cssBlock.vars.get(`--color-${name}`), v, `${f} tokens.css ${mode} ${name}`);
        assert.equal(themeBlock.vars.get(`--color-${name}`), v, `${f} theme.css ${mode} ${name}`);
        assert.equal(tok.color[mode][name].$value.hex, v, `${f} tokens.json ${mode} ${name}`);
      }
    }
    const md = generate.designMd(id);
    assert.ok(md.includes('--color-focus-ring') && md.includes('outline-focus-ring') && md.includes('--color-control-border'), `${f}: DESIGN.md names the variables`);
  }
});

test('[1.9] the text contrast target follows the project level (AAA = 7:1) and pairs below it are marked', () => {
  const id = structuredClone(IDENTITIES.find(([f]) => f === 'identity-bilingual-landing.json')[1]);
  assert.equal(id.project.contrast, 'AAA');
  let md = generate.designMd(id);
  const colors = sectionText(md, 'Colors');
  assert.ok(colors.includes('The AAA target is 7:1 for body text'), 'AAA target stated');
  assert.ok(colors.includes('#ffffff on #2563eb: 5.17:1` (below the 7:1 target: large text only)'), 'pair below 7:1 marked');
  assert.ok(!/: [0-6]\.\d+:1` \(text allowed\)/.test(colors), 'no status color under 7:1 is allowed as text');
  assert.ok(sectionText(md, "Do's and Don'ts").includes('7:1 or more (WCAG AAA)'));
  id.project.contrast = 'AA';
  md = generate.designMd(id);
  assert.ok(sectionText(md, 'Colors').includes('The AA target is 4.5:1 for body text'));
  assert.ok(!sectionText(md, 'Colors').includes('#ffffff on #2563eb: 5.17:1` (below'), '5.17 meets AA');
});

test('[1.9] bilingual projects get per-language number and date formats; mirroring uses :dir(); spacing maps to Tailwind', () => {
  for (const [f, id] of ALL_IDENTITIES) {
    const md = generate.designMd(id);
    const nums = sectionText(md, 'Numbers & Calendar');
    const nu = id.extensions.numerals === 'arab' ? 'arab' : 'latn';
    assert.ok(nums.includes(`"ar-u-ca-${id.extensions.calendar}-nu-${nu}"`), `${f}: Arabic dates`);
    assert.ok(nums.includes(`"en-u-ca-${id.extensions.calendar}-nu-latn"`), `${f}: English dates always use Western digits`);
    assert.ok(nums.includes(`"ar-u-nu-${nu}"`) && nums.includes('"en-u-nu-latn"'), `${f}: number formats`);
    for (const loc of nums.match(/"(?:ar|en)-u-[a-z0-9-]+"/g)) {
      const tag = JSON.parse(loc);
      assert.deepEqual(Intl.getCanonicalLocales(tag), [tag], `${f}: ${tag} is a canonical BCP 47 tag`);
    }
    assert.ok(sectionText(md, SECTIONS_1_9[11]).includes(':dir(rtl) { scale: -1 1; }'), `${f}: mirroring example`);
    const layout = sectionText(md, 'Layout');
    id.tokens.spacing.scale.forEach((sp, k) => {
      const mult = sp / id.tokens.spacing.unit;
      assert.ok(layout.includes(`${sp}px (\`--space-${k}\`${Number.isInteger(mult) ? `, \`p-${mult}\`` : ''})`), `${f}: step ${k}`);
    });
  }
});

test('[1.9] the Latin size adjustment is applied to the font (@font-face size-adjust), never by element selectors', () => {
  const id = IDENTITIES.find(([f]) => f === 'identity-bilingual-landing.json')[1];
  const md = generate.designMd(id);
  const pctOf = (x) => `${Math.round(x * 10000) / 100}%`;
  assert.ok(md.includes(`size-adjust: ${pctOf(id.tokens.font.body.latinSizeAdjust)};`), 'percent form of the value');
  assert.doesNotMatch(md, /\[lang="en"\][^`]*font-size/, 'no element font-size rule (it shrinks whole English headings)');
});

test('[1.9] with Western digits and two families, the numbers font is the Latin one (it comes first in the stack)', () => {
  const id = structuredClone(IDENTITIES.find(([f]) => f === 'identity-bilingual-landing.json')[1]);
  id.extensions.numerals = 'latn';
  const fm = generate.designMd(id).split('\n---\n')[0];
  assert.match(fm, new RegExp(`\\n  numeric-md:\\n    fontFamily: "${id.tokens.font.numerals.latin}"\\n`));
  id.extensions.numerals = 'arab';
  assert.match(generate.designMd(id).split('\n---\n')[0], new RegExp(`\\n  numeric-md:\\n    fontFamily: "${id.tokens.font.numerals.arabic}"\\n`));
});

test('[1.9] an AAA project whose colors only reach AA gets an explicit warning; marks below 3:1 say do not use', () => {
  const id = structuredClone(IDENTITIES.find(([f]) => f === 'identity-bilingual-landing.json')[1]);
  const m = modes.derive('#2563eb');
  id.tokens.color = { light: m.light, dark: m.dark, ramps: m.ramps };
  const colors = sectionText(generate.designMd(id), 'Colors');
  assert.match(colors, /\*\*Warning:\*\* this identity does not meet the AAA target \(7:1\) for: light text on primary/);
  id.project.contrast = 'AA';
  assert.doesNotMatch(sectionText(generate.designMd(id), 'Colors'), /does not meet the AA target/);
  const low = structuredClone(IDENTITIES[0][1]);
  low.tokens.color.light.onPrimary = low.tokens.color.light.primary === '#ffffff' ? '#eeeeee' : low.tokens.color.light.primary;
  assert.ok(sectionText(generate.designMd(low), 'Colors').includes('(below 3:1: do not use)'));
});

/* =====================================================================================================
 * Task 1.10: style-guide.html, a standalone page showing the identity in both modes.
 * ===================================================================================================== */

const SG_SECTIONS = ['colors', 'fonts', 'scale', 'radius', 'shadows', 'buttons', 'cards'];

test('[1.10] a standalone page: no scripts at all, a policy that forbids them, logical properties only', () => {
  for (const [f, id] of ALL_IDENTITIES) {
    const html = generate.styleGuide(id);
    assert.match(html, /^<!doctype html>\n<html lang="(ar|en)" dir="(rtl|ltr)">\n/, f);
    const lang = id.project.language === 'en' ? 'en" dir="ltr' : 'ar" dir="rtl';
    assert.ok(html.includes(`<html lang="${lang}">`), `${f}: lang/dir`);
    assert.ok(html.includes('<meta charset="utf-8">'), f);
    const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html);
    assert.ok(csp, `${f}: CSP meta`);
    assert.match(csp[1], /default-src 'none'/);
    assert.doesNotMatch(csp[1], /script-src/, 'no script source is allowed at all');
    assert.doesNotMatch(html, /<script|javascript:|\son[a-z]+\s*=/i, `${f}: no script, no event handler`);
    const css = (html.match(/<style>([\s\S]*?)<\/style>/) || [])[1];
    assert.ok(css, `${f}: inline style`);
    assert.doesNotMatch(css, /\b(left|right)\b/i, `${f}: logical properties only`);
    for (const mode of ['light', 'dark']) {
      const panel = html.split(`<section class="mode" data-mode="${mode}"`)[1];
      assert.ok(panel, `${f}: ${mode} panel`);
      for (const s of SG_SECTIONS) assert.ok(panel.includes(`data-section="${s}"`), `${f}: ${mode} ${s}`);
    }
    for (const role of ['heading', 'body', 'numerals']) {
      for (const fam of [id.tokens.font[role].arabic, id.tokens.font[role].latin].filter(Boolean)) {
        assert.ok(html.includes(`https://fonts.googleapis.com/css2?family=${fam.replace(/ /g, '+')}&amp;display=swap`), `${f}: font link ${fam}`);
      }
    }
    assert.ok(html.endsWith('</html>\n'), f);
    assert.ok(html.includes('<h1 dir="auto">'), `${f}: the name keeps its own direction`);
    assert.doesNotMatch(css, /opacity/, `${f}: text color comes from identity roles, not transparency`);
    assert.ok(!/<span class="en">/.test(html) && html.includes('<span class="en" lang="en">'), `${f}: English labels marked lang="en"`);
    assert.ok(html.includes(`<code dir="ltr">${id.tokens.color.light.primary}</code>`), `${f}: hex codes keep left-to-right order in RTL pages`);
    assert.equal(html, generate.styleGuide(structuredClone(id)), `${f}: same bytes`);
    assert.doesNotMatch(html, /20\d\d-\d\d-\d\d/, `${f}: no dates`);
  }
});

test('[1.10] text from the identity is escaped; a name with a script tag never reaches the page', () => {
  assert.equal(generate.escapeHtml(`<script>alert("x")</script> & 'q'`), '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;q&#39;');
  const id = structuredClone(IDENTITIES[0][1]);
  id.name = '<script>alert(1)</script>';
  assert.throws(() => generate.styleGuide(id), /identity is not valid/, 'the identity checker refuses angle brackets in the name');
  id.name = '&lt;script&gt;alert(1)&lt;/script&gt; "x" \'y\'';
  const html = generate.styleGuide(id);
  assert.ok(html.includes('&amp;lt;script&amp;gt;alert(1)&amp;lt;/script&amp;gt; &quot;x&quot; &#39;y&#39;'), 'entities stay literal text');
  assert.doesNotMatch(html, /<script/i);
});

test('[1.10] in a real browser: no errors, the name shows as plain text, both modes show the identity values', async (t) => {
  const c = await chrome.launch();
  if (!c) return t.skip('Chrome not found (set CHROME_PATH to run this check)');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hawiya-sg-'));
  try {
    for (const [f, base] of IDENTITIES) {
      const id = structuredClone(base);
      id.name = '&lt;script&gt;alert(1)&lt;/script&gt; "x" \'y\' & ' + base.name;
      const file = path.join(dir, f.replace('.json', '.html'));
      fs.writeFileSync(file, generate.styleGuide(id));
      await c.open('file://' + file);
      const r = await c.eval(`(() => {
        const toHex = (rgb) => { const m = rgb.match(/[\\d.]+/g); return m ? '#' + m.slice(0, 3).map((n) => Number(n).toString(16).padStart(2, '0')).join('') : rgb; };
        const cs = (el) => getComputedStyle(el);
        const panel = (mode) => document.querySelector('section.mode[data-mode="' + mode + '"]');
        const out = { title: document.title, h1: document.querySelector('h1').textContent, scripts: document.scripts.length, modes: {} };
        for (const mode of ['light', 'dark']) {
          const p = panel(mode);
          const sw = {};
          p.querySelectorAll('[data-role]').forEach((el) => { sw[el.dataset.role] = toHex(cs(el.querySelector('.chip')).backgroundColor); });
          const btn = p.querySelector('.btn-primary');
          const sec = p.querySelector('.btn-secondary');
          const card = p.querySelector('.card');
          const sizes = [...p.querySelectorAll('[data-size]')].map((el) => [el.dataset.size, cs(el).fontSize]);
          out.modes[mode] = { sw, bg: toHex(cs(p).backgroundColor), text: toHex(cs(p).color),
            btn: [toHex(cs(btn).backgroundColor), toHex(cs(btn).color), cs(btn).borderTopLeftRadius],
            sec: [toHex(cs(sec).backgroundColor), toHex(cs(sec).color), toHex(cs(sec).borderTopColor)],
            card: [toHex(cs(card).backgroundColor), cs(card).borderTopLeftRadius, cs(card).boxShadow], sizes };
        }
        out.overflow = document.documentElement.scrollWidth > document.documentElement.clientWidth;
        return out; })()`);
      const shownName = id.name;
      assert.equal(r.h1, shownName, `${f}: name shown as text`);
      assert.ok(r.title.includes(shownName), `${f}: title`);
      assert.equal(r.scripts, 0);
      assert.equal(r.overflow, false, `${f}: no horizontal scroll`);
      for (const mode of ['light', 'dark']) {
        const set = id.tokens.color[mode];
        const ui = generate.uiColors(set);
        const m = r.modes[mode];
        for (const role of ROLES) assert.equal(m.sw[kebab(role)], set[role], `${f} ${mode} swatch ${role}`);
        assert.equal(m.sw['focus-ring'], ui.focusRing);
        assert.equal(m.sw['control-border'], ui.controlBorder);
        assert.deepEqual([m.bg, m.text], [set.background, set.onSurface], `${f} ${mode} panel`);
        assert.deepEqual(m.btn, [set.primary, set.onPrimary, `${id.tokens.radius.md}px`], `${f} ${mode} primary button`);
        assert.deepEqual(m.sec, [set.surface, set.accentText, ui.controlBorder], `${f} ${mode} secondary button`);
        assert.equal(m.card[0], set.surface);
        assert.equal(m.card[1], `${id.tokens.radius.lg}px`);
        const noShadow = m.card[2] === 'none' || /^rgba\(0, 0, 0, 0\) 0px 0px 0px 0px$/.test(m.card[2]);
        assert.equal(noShadow, id.tokens.shadow[mode].md.length === 0, `${f} ${mode} card shadow: ${m.card[2]}`);
        assert.deepEqual(m.sizes.map(([, px]) => parseFloat(px)).reverse(), id.tokens.typeScale.steps, `${f} ${mode} type scale (shown largest first)`);
      }
    }
    const errs = c.errors().filter((e) => !/fonts\.(googleapis|gstatic)\.com/.test(e.url + e.text) && !/ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED/.test(e.text));
    assert.deepEqual(errs, [], 'no page errors (font downloads excepted)');
  } finally {
    c.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Task 6.2 (CHG-4, R-103): the Latin size adjustment as @font-face rules in tokens.css, theme.css and style-guide.html.
function libraryIdentity(fontsTemplate, overrides) {
  const resolve = require('../picker/js/core/resolve.js');
  const build = require('../tools/build.js');
  const data = build.select(build.load(path.join(__dirname, '..', 'library'))).data;
  const calm = data.identities.find((i) => i.id === 'calm-corporate');
  const selections = {};
  for (const [element, template] of Object.entries(calm.templates)) selections[element] = { template };
  selections.fonts = { template: fontsTemplate };
  if (overrides) selections.fonts.overrides = overrides;
  return resolve.resolve({ name: 'T', selections }, data);
}

test('[6.2] two families with the value 1: no rule and the stacks as before; an adjusted pair: the rules of every recorded face', () => {
  const plainPair = generate.valueFiles(libraryIdentity('pair-zain-figtree'));
  for (const f of ['tokens.css', 'theme.css']) assert.ok(!plainPair[f].includes('@font-face') && !/"[^"]+ Hawiya \d/.test(plainPair[f]), f);
  assert.match(plainPair['tokens.css'], /--font-body: "Figtree", "Zain", /);
  assert.ok(!generate.styleGuide(libraryIdentity('pair-zain-figtree')).includes('@font-face'));

  const id = libraryIdentity('pair-amiri-eb-garamond');
  const css = generate.valueFiles(id)['tokens.css'];
  const record = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'library', 'font-faces.json'), 'utf8')).families['EB Garamond'];
  const blocks = [...css.matchAll(/@font-face \{([^}]*)\}/g)].map((m) => m[1]);
  assert.equal(blocks.length, record.faces.length, 'one rule per recorded face (3 weights × latin-ext, latin)');
  record.faces.forEach((f, i) => {
    assert.ok(blocks[i].includes(`src: url(${f.url}) format("woff2");`), `face ${i}: file`);
    assert.ok(blocks[i].includes(`unicode-range: ${f.unicodeRange};`), `face ${i}: range`);
    assert.ok(blocks[i].includes(`font-weight: ${f.weight};`), `face ${i}: weight`);
    assert.ok(blocks[i].includes('font-style: normal;') && blocks[i].includes('font-display: swap;'), `face ${i}`);
  });
  assert.ok(css.indexOf('@font-face') < css.indexOf(':root {'), 'the rules come before the variables');
  assert.ok(generate.valueFiles(id)['theme.css'].indexOf('@font-face') < generate.valueFiles(id)['theme.css'].indexOf('@theme {'));
  // The Tailwind default text font follows too.
  assert.match(generate.valueFiles(id)['theme.css'], /--font-sans: "EB Garamond Hawiya 135", "EB Garamond", "Amiri", /);
  // tokens.json and identity.json are unchanged by the adjustment: the names and value stay as they were.
  assert.ok(!generate.valueFiles(id)['tokens.json'].includes('Hawiya 135'));
});

test('[6.2] DESIGN.md says the rules are ready and not to add size-adjust again; the old instruction stays without rules', () => {
  const md = generate.designMd(libraryIdentity('pair-amiri-eb-garamond'));
  assert.match(md, /The Latin size adjustment is already applied in tokens\.css and theme\.css: their `@font-face` rules declare \*\*EB Garamond\*\* again as `"EB Garamond Hawiya 135"` with `size-adjust: 135%;`/);
  assert.match(md, /do not add `size-adjust` yourself and do not change font sizes for Latin text/);
  assert.ok(!md.includes('when self-hosting the font'), 'the old instruction is gone');
  const report = lint(md);
  assert.deepEqual([report.summary.errors, report.summary.warnings], [0, 0]);
  // A pair with the value 1: no adjustment text that asks for anything new.
  assert.ok(!generate.designMd(libraryIdentity('pair-zain-figtree')).includes('already applied'));
});

test('[6.2] without recorded rules nothing changes; unsound recorded rules are refused, never written into CSS', () => {
  const dir = path.join(__dirname, '..', 'picker', 'js', 'core');
  const id = libraryIdentity('pair-amiri-eb-garamond');
  const run = (fontFaces) => {
    const sandbox = { self: { Hawiya: { data: { fontFaces } } } };
    for (const f of ['schemas.js', 'validate.js', 'contrast.js', 'generate.js']) vm().runInNewContext(fs.readFileSync(path.join(dir, f), 'utf8'), sandbox);
    sandbox.text = JSON.stringify(id);
    return vm().runInNewContext('self.Hawiya.generate.valueFiles(JSON.parse(text))["tokens.css"]', sandbox);
  };
  const none = run({});
  assert.ok(!none.includes('@font-face') && none.includes('--font-body: "EB Garamond", "Amiri", '), 'no record: the stack as before');
  const good = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'library', 'font-faces.json'), 'utf8')).families;
  assert.equal(run(good), generate.valueFiles(id)['tokens.css'], 'the page data gives the same file as Node');
  for (const [what, change] of [
    ['a file elsewhere', (f) => (f.url = 'https://example.com/s/x/v1/a.woff2')],
    ['a range that leaves the rule', (f) => (f.unicodeRange = 'U+0000-00FF; } * { color: red')],
    ['another weight', (f) => (f.weight = '400; color: red')]
  ]) {
    const bad = JSON.parse(JSON.stringify(good));
    change(bad['EB Garamond'].faces[0]);
    assert.throws(() => run(bad), /recorded @font-face rules of "EB Garamond" are not sound/, what);
  }
});
const vm = () => require('node:vm');

// Review of 6.2: a value that rounds to 100% is the value 1; a role whose family the record lacks keeps the old
// instruction next to the ready one; the reference variables say the value is already applied.
test('[6.2] a value rounding to 100% writes no rule; a role without recorded rules keeps its instruction; no double adjustment', () => {
  const near = generate.valueFiles(libraryIdentity('pair-amiri-eb-garamond', { 'latin-size-adjust': 1.00001 }))['tokens.css'];
  assert.ok(!near.includes('@font-face') && near.includes('--font-body: "EB Garamond", "Amiri", '), '1.00001 is 100%');

  const id = libraryIdentity('pair-amiri-eb-garamond');
  const css = generate.valueFiles(id)['tokens.css'];
  assert.match(css, /\/\* Latin size adjustment: already applied by the @font-face rules above; for reference only, never multiply sizes by it \*\/\n {2}--font-heading-latin-size-adjust: 1\.35;/);
  assert.ok(!generate.valueFiles(libraryIdentity('pair-zain-figtree'))['tokens.css'].includes('already applied'), 'value 1: no comment');

  // A hand-edited identity: the heading pairs a Latin family the record lacks, with its own value.
  const mixed = JSON.parse(JSON.stringify(id));
  mixed.tokens.font.heading = { arabic: 'Amiri', latin: 'Roboto', fallback: ['ui-serif', 'serif'], latinSizeAdjust: 1.1 };
  const md = generate.designMd(mixed);
  assert.match(md, /declare \*\*EB Garamond\*\* again as `"EB Garamond Hawiya 135"`/);
  assert.match(md, /Apply a Latin size adjustment to the font itself, not to elements: add the `size-adjust` descriptor to the `@font-face` rules of the Latin family \(for example `size-adjust: 110%;`/);
  assert.match(generate.valueFiles(mixed)['tokens.css'], /--font-heading: "Roboto", "Amiri", /);
});

// Task 6.8 (CHG-5, R-105, R-106): tokens.css loads every font of the identity itself; DESIGN.md gives the exact links.
test('[6.8] tokens.css starts with two Google Fonts @import lines per family, for every published font template', () => {
  const build = require('../tools/build.js');
  const data = build.select(build.load(path.join(__dirname, '..', 'library'))).data;
  assert.ok(data.templates.fonts.length > 40, 'the published font templates');
  for (const tpl of data.templates.fonts) {
    const id = libraryIdentity(tpl.id);
    const files = generate.valueFiles(id);
    const families = [];
    for (const role of ['heading', 'body', 'numerals'])
      for (const fam of [id.tokens.font[role].arabic, id.tokens.font[role].latin]) if (fam && !families.includes(fam)) families.push(fam);
    const expected = families.flatMap((fam) => {
      const q = fam.replace(/ /g, '+');
      return [
        `@import url("https://fonts.googleapis.com/css2?family=${q}&display=swap");`,
        `@import url("https://fonts.googleapis.com/css2?family=${q}:wght@700&display=swap");`
      ];
    });
    const css = files['tokens.css'];
    const lines = css.split('\n');
    const start = lines.indexOf(' */') + 1;
    assert.deepEqual(lines.slice(start, start + expected.length), expected, tpl.id);
    assert.equal(lines[start + expected.length], '', `${tpl.id}: a blank line after the imports`);
    assert.equal((css.match(/^@import /gm) || []).length, expected.length, `${tpl.id}: no other @import`);
    assert.ok(css.search(/^@import /m) < css.search(/@font-face|:root \{/), `${tpl.id}: the imports come before every rule`);
    assert.ok(!files['theme.css'].includes('@import url('), `${tpl.id}: theme.css has no @import`);
  }
  // One family for both languages: two lines only.
  const cairo = generate.valueFiles(libraryIdentity('pair-cairo'))['tokens.css'];
  assert.equal((cairo.match(/^@import /gm) || []).length, 2);
});

test('[6.8] DESIGN.md says tokens.css loads the fonts and gives the same links as the style guide', () => {
  const id = libraryIdentity('pair-amiri-eb-garamond');
  const md = generate.designMd(id);
  assert.ok(
    md.includes(
      'Fonts load from Google Fonts. tokens.css loads every font of the identity itself (its first lines are `@import` rules), so linking tokens.css with `<link>` (or importing it before any other CSS) is enough. With theme.css (Tailwind), or the font stacks without tokens.css, add these links to the `<head>` of every page:'
    )
  );
  const block = /```html\n([\s\S]*?)\n```/.exec(md);
  assert.ok(block, 'an html code block with the links');
  assert.deepEqual(block[1].split('\n'), [
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Amiri&amp;display=swap">',
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Amiri:wght@700&amp;display=swap">',
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=EB+Garamond&amp;display=swap">',
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=EB+Garamond:wght@700&amp;display=swap">'
  ]);
  const guide = generate.styleGuide(id);
  for (const l of block[1].split('\n')) assert.ok(guide.includes(l), `the style guide has ${l}`);
  assert.ok(!md.includes('Load the fonts from Google Fonts.'), 'the old vague sentence is gone');
});
