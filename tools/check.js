'use strict';

/*
 * The library check (task 3.1, R-062, R-092): the quality gate before anything is published.
 *
 *   npm run check                                       library/ and picker/data/
 *   node tools/check.js --library <dir> --data <dir>    other folders (tests)
 *
 * Every template is checked, drafts too (AC-14: the whole library is green), and every problem is printed with the
 * file and the template id, then the command exits 1. Nothing is written. What is checked, by kind:
 *
 *   structure       the folders hold only <name>.json, files are strict UTF-8 JSON (no key twice, no "__proto__"),
 *                   one file per element and each template in its own element's file
 *   schema          schema/template.schema.json (identities: the build's identity schema)
 *   tokens          tokens in Design Tokens shape, in depth: each token is { $type?, $value } with a value of its
 *                   type (color: srgb components that match the hex; dimension: px or rem; shadow layers; ...)
 *   id              ids unique across the library (templates), and across the ready identities
 *   tags            library/tags.json lists exactly the 16 fixed tags with both names; every tag used is one of them
 *   names           both names present: no blank or padded name, the Arabic name in Arabic letters, the English
 *                   name without them
 *   contrast        the declared level (a11y.contrast) holds: a palette reaches it in light and dark (the rules
 *                   engine, rules.js); a button or card puts text only on fills the contrast rule checks, in every
 *                   state; a template with no text/background pair declares "n/a"
 *   reduced-motion  a recipe with transition/animation (or a motion token) has a reduced-motion alternative that
 *                   turns the motion off for each selector that moves, inside the recipe allow-list
 *   logical         no "left" / "right" in recipes (CSS, HTML attribute values, the reduced-motion CSS) or in
 *                   token names and values: logical properties (start / end) only (R-092)
 *   recipe          the recipe allow-list (picker/js/core/recipe.js): no script, no outside request
 *   identity        a ready identity names a template of the right element for every element; and (task 3.13,
 *                   R-040) once the library has no other problem, each ready identity is built (resolve.js) in
 *                   Arabic, English and both (its direction swapped for each direction template) with every
 *                   template of the library, drafts too: the blocking rules (rules.js: fonts, contrast in light
 *                   AND dark, Arabic typography, platform) allow it in each, and the DESIGN.md generated from it
 *                   passes the official check (@google/design.md) with no error and no warning
 *   license         (task 3.2, R-064) every template names a source recorded in sources.json, with the same
 *                   address and license; every license (template, source, "also" parts) is on the allowed list;
 *                   nothing (template source, address, icon library, font names, sources.json entry) matches a
 *                   forbidden source of licenses.json; extras.sources ids exist; every source is used; every license
 *                   a third-party source uses has its full text (the notices print it); both files have their shape
 *   notices         THIRD_PARTY_NOTICES.md is exactly what `npm run notices` makes from sources.json and
 *                   licenses.json (checked when both files are sound)
 *   data            picker/data is exactly what `npm run build` makes from the library (only checked when the
 *                   library itself has no problem, since the build refuses a library with problems)
 *
 *   axes            (task 3.3, R-063) every two templates of one element differ in at least two of the element's
 *                   axes (library/axes.json); an axis may weigh 2 (the icon library: each library draws every
 *                   icon differently); an element whose axes weigh less than 2 in all (modes) needs every axis to
 *                   differ. The later template is named with the one it repeats. Owner's decisions: decisions.md.
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const build = require('./build.js');
const validate = require('../picker/js/core/validate.js');
const recipe = require('../picker/js/core/recipe.js');
const rules = require('../picker/js/core/rules.js');
const resolve = require('../picker/js/core/resolve.js');
const generate = require('../picker/js/core/generate.js');
const SCHEMAS = require('../picker/js/core/schemas.js');
const color = require('../picker/js/core/color.js');
const notices = require('./notices.js');

const ROOT = path.join(__dirname, '..');
const ELEMENTS = build.ELEMENTS;
const TAGS = SCHEMAS.template.$defs.tag.enum.slice();
const checkIdentity = validate.compile(build.IDENTITY_SCHEMA);

const ARABIC = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/;
const PHYSICAL = /(^|[^a-z0-9])(left|right)(?![a-z])/i; // "_" and digits separate words too

const own = (o, k) => o !== null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/* ---------- CSS blocks (recipes are flat: no nesting) ---------- */

// "sel{decls}" → [{ selector, decls: { prop: value } }], one entry per selector of a selector list.
function blocks(css) {
  const out = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls = {};
    for (const d of m[2].split(';')) {
      const at = d.indexOf(':');
      if (at > 0) decls[d.slice(0, at).trim().toLowerCase()] = d.slice(at + 1).trim();
    }
    for (const sel of m[1].split(',')) {
      const s = sel.trim();
      if (s && !s.startsWith('@')) out.push({ selector: s, decls });
    }
  }
  return out;
}

/* ---------- names ---------- */

function nameProblems(name) {
  const out = [];
  if (!isObject(name)) return out; // the schema reports it
  for (const lang of ['ar', 'en']) {
    const v = name[lang];
    if (typeof v !== 'string') continue; // the schema reports it
    if (!v.trim()) out.push(`the ${lang === 'ar' ? 'Arabic' : 'English'} name is blank`);
    else if (v !== v.trim())
      out.push(`the ${lang === 'ar' ? 'Arabic' : 'English'} name has spaces at its start or end`);
  }
  if (typeof name.ar === 'string' && name.ar.trim() && !ARABIC.test(name.ar))
    out.push(`the Arabic name "${name.ar}" has no Arabic letters`);
  if (typeof name.en === 'string' && ARABIC.test(name.en)) out.push(`the English name "${name.en}" has Arabic letters`);
  return out;
}

/* ---------- tokens (Design Tokens shape, in depth) ---------- */

const TOKEN_KEYS = new Set(['$type', '$value', '$description']);

function colorValue(v, where, out) {
  if (!isObject(v)) return out.push(`${where}: a color value is an object { colorSpace, components, hex }`);
  const keys = Object.keys(v).filter((k) => !['colorSpace', 'components', 'hex', 'alpha'].includes(k));
  if (keys.length) out.push(`${where}: unexpected color field ${keys.join(', ')}`);
  if (v.colorSpace !== 'srgb') out.push(`${where}: colorSpace must be "srgb"`);
  if (typeof v.hex !== 'string' || !/^#[0-9a-f]{6}$/.test(v.hex))
    return out.push(`${where}: hex must be #rrggbb in lower case`);
  const c = v.components;
  if (!Array.isArray(c) || c.length !== 3 || !c.every((x) => typeof x === 'number' && x >= 0 && x <= 1)) {
    return out.push(`${where}: components must be three numbers from 0 to 1`);
  }
  const bytes = [1, 3, 5].map((i) => parseInt(v.hex.slice(i, i + 2), 16));
  if (c.some((x, i) => Math.round(x * 255) !== bytes[i]))
    out.push(`${where}: components ${JSON.stringify(c)} do not match ${v.hex}`);
  if (own(v, 'alpha') && !(typeof v.alpha === 'number' && v.alpha >= 0 && v.alpha <= 1))
    out.push(`${where}: alpha must be from 0 to 1`);
}

function dimensionValue(v, where, out) {
  if (!isObject(v) || Object.keys(v).sort().join() !== 'unit,value')
    return out.push(`${where}: a dimension is { value, unit }`);
  if (typeof v.value !== 'number' || !Number.isFinite(v.value)) out.push(`${where}: dimension value must be a number`);
  if (v.unit !== 'px' && v.unit !== 'rem') out.push(`${where}: dimension unit must be "px" or "rem"`);
}

const VALUE = {
  color: colorValue,
  dimension: dimensionValue,
  number: (v, where, out) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) out.push(`${where}: a number token holds a number`);
  },
  fontFamily: (v, where, out) => {
    const ok = (s) => typeof s === 'string' && s.trim() !== '';
    if (!(ok(v) || (Array.isArray(v) && v.length > 0 && v.every(ok))))
      out.push(`${where}: a fontFamily is a name or a list of names`);
  },
  fontWeight: (v, where, out) => {
    if (!(typeof v === 'number' && v >= 1 && v <= 1000)) out.push(`${where}: a fontWeight is a number from 1 to 1000`);
  },
  duration: (v, where, out) => {
    if (!isObject(v) || typeof v.value !== 'number' || (v.unit !== 'ms' && v.unit !== 's'))
      out.push(`${where}: a duration is { value, unit: "ms" | "s" }`);
  },
  cubicBezier: (v, where, out) => {
    if (!Array.isArray(v) || v.length !== 4 || !v.every((x) => typeof x === 'number'))
      out.push(`${where}: a cubicBezier is four numbers`);
  },
  shadow: (v, where, out) => {
    if (!Array.isArray(v)) return out.push(`${where}: a shadow is a list of layers`);
    v.forEach((layer, i) => {
      const w = `${where}[${i}]`;
      if (!isObject(layer)) return out.push(`${w}: a shadow layer is an object`);
      const extra = Object.keys(layer).filter(
        (k) => !['color', 'offsetX', 'offsetY', 'blur', 'spread', 'inset'].includes(k)
      );
      if (extra.length) out.push(`${w}: unexpected shadow field ${extra.join(', ')}`);
      colorValue(layer.color, `${w}.color`, out);
      for (const k of ['offsetX', 'offsetY', 'blur', 'spread']) dimensionValue(layer[k], `${w}.${k}`, out);
      if (own(layer, 'inset') && typeof layer.inset !== 'boolean') out.push(`${w}: inset is true or false`);
    });
  }
};
const MOTION_TYPES = new Set(['duration', 'cubicBezier', 'transition']);

// Walks tokens: { problems, physical: [where], motion: boolean }.
function tokenProblems(tokens) {
  const out = [];
  const physical = [];
  let motion = false;
  let count = 0;
  const stack = [[tokens, 'tokens']];
  while (stack.length) {
    const [node, where] = stack.pop();
    if (!isObject(node)) {
      out.push(`${where}: expected a token { $value } or a group of tokens`);
      continue;
    }
    if (own(node, '$value')) {
      count++;
      const extra = Object.keys(node).filter((k) => !TOKEN_KEYS.has(k));
      if (extra.length) out.push(`${where}: unexpected token field ${extra.join(', ')}`);
      const type = node.$type;
      if (type === undefined) {
        // A plain setting (mode, direction): a word or a number.
        if (!(typeof node.$value === 'string' && node.$value.trim()) && typeof node.$value !== 'number') {
          out.push(`${where}: a token without $type holds a word or a number`);
        }
      } else if (!own(VALUE, type)) out.push(`${where}: unknown $type ${JSON.stringify(type)}`);
      else VALUE[type](node.$value, `${where}`, out);
      if (MOTION_TYPES.has(type)) motion = true;
      if (typeof node.$value === 'string' && PHYSICAL.test(node.$value)) physical.push(`${where} = "${node.$value}"`);
      continue;
    }
    const keys = Object.keys(node);
    if (!keys.length) out.push(`${where}: an empty group`);
    for (const k of keys.reverse()) {
      if (k.startsWith('$')) {
        if (k !== '$description') out.push(`${where}: unexpected group field ${k}`);
        continue;
      }
      if (PHYSICAL.test(k.replace(/([a-z])([A-Z])/g, '$1-$2'))) physical.push(`${where}.${k}`);
      stack.push([node[k], `${where}.${k}`]);
    }
  }
  if (!count) out.push('tokens: no token at all');
  return { problems: out, physical, motion };
}

/* ---------- recipes: left / right, reduced motion, contrast ---------- */

// Each CSS declaration (or selector) that names left or right.
function physicalCss(css) {
  return css
    .split(/[;{}]/)
    .map((s) => s.trim())
    .filter((s) => PHYSICAL.test(s));
}

function physicalHtml(html) {
  const out = [];
  for (const m of html.matchAll(/\s([a-z][a-z0-9-]*)="([^"]*)"/g))
    if (PHYSICAL.test(m[2])) out.push(`${m[1]}="${m[2]}"`);
  return out;
}

const MOTION_PROP = /^(?:-[a-z]+-)?(transition|animation)(-|$)/;
const KEYFRAMES = /@(?:-[a-z]+-)?keyframes/i;
const STILL = /^(none|0m?s)$/i;
const IMPORTANT = /\s*!important\s*$/i;
const plainValue = (v) => v.replace(IMPORTANT, '').trim();

// A transition that only fades (opacity) in under 100ms: allowed under reduced motion (the DESIGN.md generate.js
// writes says "instant changes or plain fades under 100ms").
function shortFade(value) {
  return plainValue(value)
    .split(',')
    .every((item) => {
      const words = item.trim().split(/\s+/);
      const times = words
        .filter((w) => /^[\d.]+m?s$/i.test(w))
        .map((w) => (/ms$/i.test(w) ? parseFloat(w) : parseFloat(w) * 1000));
      return words[0] === 'opacity' && times.length > 0 && times[0] < 100;
    });
}

// [{ selector, family }] for every selector whose declarations move something (vendor prefixes too). With fades,
// a short opacity transition does not count (the reduced-motion alternative may keep one).
function motionIn(css, { fades = false } = {}) {
  const out = [];
  for (const b of blocks(css)) {
    for (const [prop, value] of Object.entries(b.decls)) {
      const m = MOTION_PROP.exec(prop);
      if (!m || STILL.test(plainValue(value))) continue;
      if (fades && prop.replace(/^-[a-z]+-/, '') === 'transition' && shortFade(value)) continue;
      out.push({ selector: b.selector, family: m[1] });
    }
  }
  if (KEYFRAMES.test(css)) out.push({ selector: '@keyframes', family: 'animation' });
  return out;
}

// Does this declaration turn the family off ("transition: none", "-webkit-animation-duration: 0s", ...)?
function stillDecl(prop, value, family) {
  const p = prop.replace(/^-[a-z]+-/, '');
  const v = plainValue(value);
  return (p === family && STILL.test(v)) || (p === `${family}-duration` && /^0m?s$/i.test(v));
}

// A selector without its states (":hover", "::before", ...) in every part: the element(s) it styles.
const stateless = (sel) =>
  sel
    .replace(/::?[a-z-]+(\([^)]*\))?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

// Does the alternative CSS turn this family of motion off for this selector? The same selector, or the same element
// (same selector without its states) with !important: a plain rule loses to a more specific state such as :hover,
// and motion does not inherit, so a rule on an ancestor does not count.
function stills(alt, selector, family) {
  return blocks(alt).some((b) =>
    Object.entries(b.decls).some(
      ([p, v]) =>
        stillDecl(p, v, family) &&
        (selector === '@keyframes' ||
          b.selector === selector ||
          (stateless(b.selector) === stateless(selector) && IMPORTANT.test(v)))
    )
  );
}

// The pairs the contrast rule (rules.js) checks in both modes, as CSS variable roles: text roles on the page colors,
// button text on its own fill. A transparent fill shows the page (background or surface), both checked.
const TEXT_ROLES = ['on-surface', 'muted-text', 'accent-text', 'success', 'warning', 'danger', 'info'];
const PAGE_FILLS = ['background', 'surface', 'transparent'];
const CHECKED = new Set(
  TEXT_ROLES.flatMap((t) => PAGE_FILLS.map((b) => `${t} on ${b}`)).concat([
    'on-primary on primary',
    'on-secondary on secondary'
  ])
);
const role = (v) =>
  (v && (v.match(/^var\(--color-([a-z-]+)\)$/) || [])[1]) ||
  (v === 'transparent' ? 'transparent' : v ? `"${v}"` : 'none');
const SEE_THROUGH = /^(none|transparent|inherit|unset|initial|revert|revert-layer)$/i;

// What an element paints behind its text (from its resolved declarations), or undefined (shows its parent). A
// background image or an inset shadow can cover the fill, so it counts as a fill of its own (one the contrast rule
// never checks).
function fillOf(d) {
  const image = d['background-image'];
  if (image && !SEE_THROUGH.test(image)) return `background-image:${image}`;
  if (d['box-shadow'] && /(^|[\s,])inset([\s,]|$)/i.test(d['box-shadow'])) return `box-shadow:${d['box-shadow']}`;
  const v = d['background-color'];
  return v && !SEE_THROUGH.test(v) ? v : undefined;
}
const textOf = (d) => (d.color && !/^(inherit|unset|currentcolor)$/i.test(d.color) ? d.color : undefined);

// The elements of an allow-listed recipe HTML: [{ tag, classes, parent }].
function elementsOf(html) {
  const out = [];
  const open = [];
  for (const m of html.matchAll(/<(\/?)([a-z][a-z0-9]*)((?:\s+[a-z][a-z0-9-]*(?:="[^"]*")?)*)\s*(\/?)>/g)) {
    if (m[1]) {
      const i = open.map((e) => e.tag).lastIndexOf(m[2]);
      if (i !== -1) open.length = i;
      continue;
    }
    const cls = (/\sclass="([^"]*)"/.exec(m[3]) || [null, ''])[1].split(/\s+/).filter(Boolean);
    const el = { tag: m[2], classes: cls, parent: open[open.length - 1] || null };
    out.push(el);
    if (!m[4] && !['br', 'hr', 'input'].includes(m[2])) open.push(el);
  }
  return out;
}

// CSS specificity of a selector: [ids, classes + attributes + pseudo-classes, tags + pseudo-elements].
function specificity(selector) {
  const s = selector.replace(/\([^)]*\)/g, '');
  const pseudoElements = (s.match(/::[a-z-]+/gi) || []).length;
  const pseudoClasses = (s.replace(/::[a-z-]+/gi, '').match(/:[a-z-]+/gi) || []).length;
  const tags = s.split(/[\s>+~]+/).filter((part) => /^[a-z]/i.test(part)).length;
  return [
    (s.match(/#[\w-]+/g) || []).length,
    (s.match(/\.[\w-]+/g) || []).length + (s.match(/\[[^\]]*\]/g) || []).length + pseudoClasses,
    tags + pseudoElements
  ];
}

// A selector's last compound split into what it matches and its states ([":hover"], ["[disabled]"], ...).
function compound(selector) {
  const last = selector
    .trim()
    .split(/[\s>+~]+/)
    .pop();
  const at = last.search(/[:[]/);
  const simple = at === -1 ? last : last.slice(0, at);
  const states = at === -1 ? [] : last.slice(at).match(/::?[a-z-]+(\([^)]*\))?|\[[^\]]*\]/gi) || [last.slice(at)];
  const tag = (/^[a-z][a-z0-9]*|^\*/i.exec(simple) || [''])[0];
  const classes = [...simple.matchAll(/\.([A-Za-z0-9_-]+)/g)].map((x) => x[1]);
  return { simple, states, tag, classes };
}
// Recipe HTML has no ids (not in the allow-list), so a selector with one only matches its own placeholder element.
const matches = (el, c) =>
  el.virtual
    ? el.virtual === c.simple
    : !c.simple.includes('#') &&
      (!c.tag || c.tag === '*' || c.tag === el.tag) &&
      c.classes.every((k) => el.classes.includes(k));
const describe = (el) => el.virtual || el.tag + el.classes.map((k) => '.' + k).join('');

// The declarations that decide contrast, "background" shorthand split into its color and image.
function colorDecls(decls) {
  const out = [];
  for (const [prop, raw] of Object.entries(decls)) {
    const important = IMPORTANT.test(raw);
    const value = plainValue(raw);
    if (prop === 'background') {
      out.push(['background-color', value, important]);
      out.push(['background-image', /(gradient|url|image)\s*\(/i.test(value) ? value : 'none', important]);
    } else if (['background-color', 'background-image', 'color', 'box-shadow'].includes(prop)) {
      out.push([prop, value, important]);
    }
  }
  return out;
}

// Each subset of the states a recipe names (all of them when there are few; else each alone and all together).
function stateSets(all) {
  if (all.length > 6)
    return [[]].concat(
      all.map((x) => [x]),
      [all]
    );
  const out = [];
  for (let mask = 0; mask < 1 << all.length; mask++) out.push(all.filter((_, i) => mask & (1 << i)));
  return out;
}

// Every text color a recipe shows on a fill, in every state, must be a pair the contrast rule checks. For each element
// of the recipe HTML and each combination of the states the CSS names (hover and focus together, ...), the
// declarations are resolved as a browser does (!important, then specificity, then order). Text and fill come from the
// element or its nearest ancestor (text inherits; a fill shows through a transparent child). Text with no color
// anywhere is the scene's text, readable on the page colors only. A selector that matches no element of the HTML
// (content put in a placeholder) is taken as a child of the outermost element.
function recipePairs(html, css) {
  const out = [];
  const list = blocks(css).map((b, order) => ({
    ...b,
    c: compound(b.selector),
    spec: specificity(b.selector),
    order,
    decls: colorDecls(b.decls)
  }));
  const els = elementsOf(html);
  for (const b of list) {
    if (!els.some((el) => matches(el, b.c))) els.push({ virtual: b.c.simple, parent: els[0] || null, classes: [] });
  }
  const wins = (a, b) => {
    const ka = [a.important ? 1 : 0, ...a.spec, a.order];
    const kb = [b.important ? 1 : 0, ...b.spec, b.order];
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] > kb[i];
    return true;
  };
  const allStates = [...new Set(list.flatMap((b) => b.c.states))];
  const seen = new Set();
  let pairs = 0;
  for (const active of stateSets(allStates)) {
    const resolved = new Map(
      els.map((el) => {
        const best = {};
        for (const b of list) {
          if (!matches(el, b.c) || !b.c.states.every((x) => active.includes(x))) continue;
          for (const [prop, value, important] of b.decls) {
            const d = { value, important, spec: b.spec, order: b.order };
            if (!best[prop] || wins(d, best[prop])) best[prop] = d;
          }
        }
        return [el, Object.fromEntries(Object.entries(best).map(([k, d]) => [k, d.value]))];
      })
    );
    const nearest = (el, get) => {
      for (let e = el; e; e = e.parent) {
        const v = get(resolved.get(e));
        if (v) return v;
      }
      return undefined;
    };
    for (const el of els) {
      const text = nearest(el, textOf);
      const fill = nearest(el, fillOf) || 'transparent';
      pairs++;
      const where = describe(el) + active.join('');
      let m = null;
      if (!text) {
        if (!PAGE_FILLS.includes(role(fill)))
          m = `${where}: the scene's text on ${fill} is not a pair the contrast rule checks; give it a text color`;
      } else if (!CHECKED.has(`${role(text)} on ${role(fill)}`)) {
        m = `${where}: ${role(text)} on ${role(fill)} is not a pair the contrast rule checks`;
      }
      if (m && !seen.has(m)) {
        out.push(m);
        seen.add(m);
      }
    }
  }
  return { problems: out, pairs };
}

/* ---------- the check ---------- */

function check({
  libraryDir = path.join(ROOT, 'library'),
  dataDir = path.join(ROOT, 'picker', 'data'),
  noticesFile = path.join(ROOT, 'THIRD_PARTY_NOTICES.md')
} = {}) {
  const problems = [];
  const add = (kind, file, template, message) => problems.push({ kind, file, template, message });
  const counts = {
    templates: 0,
    reviewed: 0,
    drafts: 0,
    identities: 0,
    identitiesBuilt: 0,
    pairs: 0,
    dataFiles: 0,
    sources: 0,
    comparisons: 0
  };
  const result = { problems, counts, dataChecked: false, noticesChecked: false, libraryDir, dataDir, noticesFile };
  const valid = []; // { file, label, t } for every template that passed the schema (license checks below)
  const io = (list, kind = 'structure') => list.splice(0).forEach((p) => add(kind, null, null, p));
  const raw = [];

  const elementsDir = path.join(libraryDir, 'elements');
  if (!isDir(elementsDir)) {
    add('structure', elementsDir, null, 'no library here: the elements folder is missing');
    return result;
  }

  // tags.json: exactly the fixed tags, in order, each with both names.
  const tagsFile = path.join(libraryDir, 'tags.json');
  const tags = fs.existsSync(tagsFile) ? build.readJson(tagsFile, raw) : (raw.push(`${tagsFile}: missing`), undefined);
  io(raw, 'tags');
  if (Array.isArray(tags)) {
    const ids = tags.map((t) => (isObject(t) ? t.id : undefined));
    if (JSON.stringify(ids) !== JSON.stringify(TAGS))
      add('tags', 'tags.json', null, `must list exactly the ${TAGS.length} fixed tags in order: ${TAGS.join(', ')}`);
    tags.forEach((t, i) => {
      const label = isObject(t) && typeof t.id === 'string' ? t.id : `[${i}]`;
      if (
        !isObject(t) ||
        Object.keys(t).sort().join() !== 'id,name' ||
        !isObject(t.name) ||
        typeof t.name.ar !== 'string' ||
        typeof t.name.en !== 'string'
      ) {
        add('tags', 'tags.json', label, 'a tag is { id, name: { ar, en } }');
      } else nameProblems(t.name).forEach((m) => add('names', 'tags.json', label, m));
    });
  } else if (tags !== undefined) add('tags', 'tags.json', null, 'expected a JSON array of tags');

  const byId = new Map(); // id -> { element, file, state }
  const hasFile = new Set();
  for (const name of build.listJson(elementsDir, raw)) {
    const element = name.slice(0, -'.json'.length);
    if (!ELEMENTS.includes(element)) {
      add('structure', name, null, `"${element}" is not an element (expected one of: ${ELEMENTS.join(', ')})`);
      continue;
    }
    hasFile.add(element);
    const list = build.readJson(path.join(elementsDir, name), raw);
    io(raw);
    if (list === undefined) continue;
    if (!Array.isArray(list)) {
      add('structure', name, null, 'expected a JSON array of templates');
      continue;
    }
    list.forEach((t, i) => checkTemplate(t, i, name, element));
  }
  io(raw);
  for (const e of ELEMENTS)
    if (!hasFile.has(e)) add('structure', `${e}.json`, null, `the element "${e}" has no file in ${elementsDir}`);

  function checkTemplate(t, i, file, element) {
    counts.templates++;
    const label = isObject(t) && typeof t.id === 'string' && t.id ? t.id : `[${i}]`;
    const say = (kind, message) => add(kind, file, label, message);
    if (!isObject(t)) return say('schema', 'a template is a JSON object');
    if (isObject(t.status)) counts[t.status.state === 'reviewed' ? 'reviewed' : 'drafts']++;

    const result = validate.check('template', t);
    for (const e of result.errors) {
      // The top-level field the error is about: /name/en → name; a missing top-level field → that field.
      const field = e.instancePath.split('/')[1] || (e.params && e.params.missingProperty) || '';
      const kind = { id: 'id', name: 'names', tags: 'tags', source: 'license' }[field] || 'schema';
      say(kind, `${e.instancePath || '/'} ${e.message}`);
    }
    nameProblems(t.name).forEach((m) => say('names', m));
    if (typeof t.id === 'string') {
      if (byId.has(t.id)) say('id', `id "${t.id}" is already used in ${byId.get(t.id).file}`);
      else byId.set(t.id, { element: t.element, file, state: isObject(t.status) ? t.status.state : null });
    }
    if (typeof t.element === 'string' && t.element !== element)
      say('structure', `says element "${t.element}" but is in ${file}`);
    if (!result.valid) return; // the deeper checks need the template's shape
    valid.push({ file, label, t });
    if ((t.element === 'buttons' || t.element === 'cards') && t.kind !== 'composite')
      say('schema', `a ${t.element.slice(0, -1)} is a composite template with a recipe (kind is "${t.kind}")`);

    const tok = tokenProblems(t.tokens);
    tok.problems.forEach((m) => say('tokens', m));
    tok.physical.forEach((w) => say('logical', `${w} names left or right; use start / end`));

    const alt = t.a11y.reducedMotion;
    if (t.recipe) {
      recipe.check(t.recipe).forEach((p) => say('recipe', `recipe ${p.where} not allowed: ${p.what}`));
      physicalCss(t.recipe.css).forEach((d) =>
        say('logical', `recipe CSS "${d}" names left or right; use logical properties (start / end)`)
      );
      physicalHtml(t.recipe.html).forEach((a) => say('logical', `recipe HTML ${a} names left or right`));
    }
    if (alt !== null) {
      recipe
        .check({ html: '<span></span>', css: alt })
        .forEach((p) => say('reduced-motion', `the reduced-motion CSS is not allowed: ${p.what}`));
      physicalCss(alt).forEach((d) => say('logical', `reduced-motion CSS "${d}" names left or right`));
      if (!alt.trim())
        say('reduced-motion', 'a11y.reducedMotion is blank: give the CSS that turns the motion off, or null');
      else if (motionIn(alt, { fades: true }).length)
        say('reduced-motion', 'the reduced-motion CSS itself moves something');
      else if (
        tok.motion &&
        !blocks(alt).some((b) =>
          Object.entries(b.decls).some(([p, v]) => stillDecl(p, v, 'transition') || stillDecl(p, v, 'animation'))
        )
      )
        say('reduced-motion', 'the tokens hold motion but the reduced-motion CSS turns no transition or animation off');
    }
    const moving = t.recipe ? motionIn(t.recipe.css) : [];
    if ((moving.length || tok.motion) && alt === null) {
      say(
        'reduced-motion',
        `${moving.length ? `the recipe moves (${moving.map((m) => `${m.selector} ${m.family}`).join(', ')})` : 'the tokens hold motion'} but a11y.reducedMotion is null`
      );
    } else if (alt !== null) {
      const seen = new Set();
      for (const m of moving) {
        const key = `${m.selector} ${m.family}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (!stills(alt, m.selector, m.family))
          say('reduced-motion', `the reduced-motion CSS does not turn off ${m.family} on ${m.selector}`);
      }
    }

    const declared = t.a11y.contrast;
    if (t.element === 'colors') {
      const c = t.tokens.color;
      if (!isObject(c) || !isObject(c.primary) || c.primary.$type !== 'color')
        say('contrast', 'a palette needs tokens.color.primary (a color) to be checked');
      else if (declared === 'n/a') say('contrast', 'a palette must declare the level it reaches: "AA" or "AAA"');
      else {
        // A color that is not a valid #rrggbb is already a tokens problem; the rules engine cannot read it.
        if (tok.problems.length) return;
        const project = { contrast: declared, platform: t.platforms[0], language: 'en' };
        const failing = rules.template(t, project).filter((p) => p.rule === 'contrast');
        counts.pairs++;
        failing.forEach((p) =>
          say(
            'contrast',
            `declares ${declared} but in ${p.mode} mode ${p.text} on ${p.on} is ${p.shown}:1 (needs ${p.required}:1)`
          )
        );
      }
    } else if (t.recipe) {
      if (declared === 'n/a') say('contrast', 'a button or card shows text: declare "AA" or "AAA"');
      const pairs = recipePairs(t.recipe.html, t.recipe.css);
      counts.pairs += pairs.pairs;
      pairs.problems.forEach((m) => say('contrast', m));
    } else if (declared !== 'n/a') {
      say('contrast', `declares ${declared} but has no text on a background to check; declare "n/a"`);
    }
  }

  licenseProblems(libraryDir, valid, add, counts);
  axesProblems(libraryDir, valid, add, counts);
  // THIRD_PARTY_NOTICES.md: only sound sources and licenses can be rendered.
  if (!problems.some((p) => p.kind === 'license' && (p.file === 'sources.json' || p.file === 'licenses.json'))) {
    const n = noticesProblem(libraryDir, noticesFile);
    if (n !== undefined) result.noticesChecked = true;
    if (n) add('notices', path.basename(noticesFile), null, n);
  }

  // Ready identities.
  const identitiesDir = path.join(libraryDir, 'identities');
  if (fs.existsSync(identitiesDir)) {
    if (!isDir(identitiesDir)) add('structure', identitiesDir, null, 'not a folder');
    else {
      const seen = new Map();
      for (const name of build.listJson(identitiesDir, raw)) {
        const value = build.readJson(path.join(identitiesDir, name), raw);
        io(raw);
        if (value === undefined) continue;
        counts.identities++;
        const label = isObject(value) && typeof value.id === 'string' ? value.id : name;
        const say = (kind, message) => add(kind, `identities/${name}`, label, message);
        const r = checkIdentity(value);
        r.errors.forEach((e) => say('schema', `${e.instancePath || '/'} ${e.message}`));
        if (!isObject(value)) continue;
        nameProblems(value.name).forEach((m) => say('names', m));
        if (isObject(value.description))
          nameProblems(value.description).forEach((m) => say('names', `description: ${m.replace(' name', ' text')}`));
        if (typeof value.id === 'string') {
          if (seen.has(value.id)) say('id', `identity id "${value.id}" is already used in ${seen.get(value.id)}`);
          else seen.set(value.id, name);
        }
        if (!r.valid) continue;
        for (const element of ELEMENTS) {
          if (!own(value.templates, element)) {
            say('identity', `${element}: no template chosen`);
            continue;
          }
          const id = value.templates[element];
          const hit = byId.get(id);
          if (!hit) say('identity', `${element}: "${id}" does not exist`);
          else if (hit.element !== element) say('identity', `${element}: "${id}" is a ${hit.element} template`);
        }
      }
      io(raw);
    }
  }

  // picker/data: only a library without problems can be built.
  if (!problems.length) {
    let lib;
    try {
      lib = build.load(libraryDir);
    } catch (e) {
      if (!(e instanceof build.LibraryError)) throw e;
      (e.problems || [e.message]).forEach((p) => add('structure', null, null, p));
    }
    if (lib) {
      identityOutputProblems(lib, counts).forEach((p) => add('identity', `identities/${p.file}`, p.id, p.message));
      result.dataChecked = true;
      const files = build.render(build.select(lib).data);
      dataProblems(files, dataDir).forEach((p) => add('data', p.file, p.template, p.message));
      counts.dataFiles = Object.keys(files).length;
    }
  }
  return result;
}

/* ---------- ready identities, built (task 3.13) ---------- */

// The official DESIGN.md check (plan: "@google/design.md, within npm run check"), for many files in one process:
// the package is an ES module, so a child node imports it once and lints each text given on stdin.
const LINT_SCRIPT = `import { lint } from '@google/design.md/linter';
let s = '';
process.stdin.on('data', (d) => (s += d)).on('end', () => {
  const out = JSON.parse(s).map((md) => {
    try {
      const r = lint(md);
      return { summary: r.summary, findings: r.findings.filter((f) => f.severity !== 'info').map((f) => f.message) };
    } catch (e) {
      return { error: String(e && e.message) };
    }
  });
  process.stdout.write(JSON.stringify(out));
});`;

function lintDesignMd(texts) {
  if (!texts.length) return [];
  const out = spawnSync(process.execPath, ['--input-type=module', '-e', LINT_SCRIPT], {
    cwd: ROOT,
    input: JSON.stringify(texts),
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024
  });
  if (out.status !== 0) throw new Error(`the official DESIGN.md check did not run: ${out.stderr || out.error}`);
  return JSON.parse(out.stdout);
}

const LANGUAGE_OF = { rtl: 'Arabic', ltr: 'English', both: 'Arabic and English' };

// Each ready identity, built with the whole library (drafts too: an identity may wait for a draft's review, and the
// build leaves it out until then) in every direction, must pass the blocking rules; its own DESIGN.md, the lint.
function identityOutputProblems(lib, counts) {
  const out = [];
  const data = { templates: lib.templates };
  const find = (element, id) => {
    const hit = lib.byId.get(id);
    return hit && hit.template.element === element ? hit.template : undefined;
  };
  const directions = lib.templates.direction || [];
  const designs = [];
  for (const { file, value } of lib.identities) {
    const say = (message) => out.push({ file, id: value.id, message });
    for (const d of directions.map((t) => t.id)) {
      const selections = {};
      for (const e of ELEMENTS) selections[e] = { template: e === 'direction' ? d : value.templates[e] };
      const dirValue = find('direction', d) && find('direction', d).tokens.direction.$value;
      const language = LANGUAGE_OF[dirValue] || d;
      let identity;
      try {
        identity = resolve.resolve({ name: value.name.en, selections }, data);
      } catch (e) {
        say(`cannot be built in ${language}: ${e.message}`);
        continue;
      }
      const verdict = rules.identity(identity, find);
      for (const p of verdict.problems)
        say(
          `in ${language}, the ${p.rule} rule blocks ${p.element}${p.template ? ` "${p.template}"` : ''}${p.role ? ` (${p.role} font)` : ''}${p.mode ? ` (${p.mode} mode)` : ''}${p.text ? `: ${p.text} on ${p.on}` : ''}`
        );
      if (d === value.templates.direction) {
        designs.push({ file, id: value.id, md: generate.designMd(identity) });
        counts.identitiesBuilt++;
      }
    }
  }
  lintDesignMd(designs.map((x) => x.md)).forEach((r, i) => {
    const { file, id } = designs[i];
    if (r.error) out.push({ file, id, message: `the official DESIGN.md check stopped: ${r.error}` });
    else if (r.summary.errors || r.summary.warnings)
      out.push({
        file,
        id,
        message: `its DESIGN.md has ${r.summary.errors} error(s) and ${r.summary.warnings} warning(s) in the official check: ${r.findings.join('; ')}`
      });
  });
  return out;
}

/* ---------- two-axis difference (task 3.3) ---------- */

const checkAxes = validate.compile({
  type: 'object',
  additionalProperties: false,
  required: ELEMENTS,
  properties: Object.fromEntries(
    ELEMENTS.map((e) => [
      e,
      {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['id', 'name', 'compare'],
          properties: {
            id: SCHEMAS.template.$defs.id,
            name: SCHEMAS.template.properties.name,
            path: { type: 'string', pattern: '^/', maxLength: 200 },
            items: { type: 'string', pattern: '^/', maxLength: 200 },
            reduce: { enum: ['max', 'minPositive'] },
            // The value this one falls back to: a pointer, or a list of them (the first that exists).
            unlessEqual: {
              anyOf: [
                { type: 'string', pattern: '^/', maxLength: 200 },
                { type: 'array', minItems: 1, items: { type: 'string', pattern: '^/', maxLength: 200 } }
              ]
            },
            css: {
              type: 'object',
              additionalProperties: false,
              required: ['selector', 'properties', 'states'],
              properties: {
                selector: { type: 'string', pattern: '^\\.[a-z][a-z0-9-]*$' },
                properties: { type: 'array', minItems: 1, items: { type: 'string', pattern: '^[a-z-]+$' } },
                states: { type: 'boolean' }
              }
            },
            compare: { enum: ['exact', 'set', 'number', 'dimension', 'color', 'shadow'] },
            tolerance: { type: 'number', minimum: 0 },
            weight: { enum: [1, 2] }
          }
        }
      }
    ])
  )
});

// JSON pointer (RFC 6901) into a value; undefined when it leads nowhere.
function pointer(value, ptr) {
  let v = value;
  for (const raw of ptr.split('/').slice(1)) {
    const k = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (v === null || typeof v !== 'object' || !Object.prototype.hasOwnProperty.call(v, k)) return undefined;
    v = v[k];
  }
  return v;
}

// The same value written another way is the same value: object keys in any order, "$description" ignored.
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (isObject(v))
    return `{${Object.keys(v)
      .filter((k) => k !== '$description')
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
      .join(',')}}`;
  return JSON.stringify(v);
}

// A length in px: a number as is, { value, unit } in px or rem (16px), else undefined.
function toPx(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (!isObject(v) || typeof v.value !== 'number' || !Number.isFinite(v.value)) return undefined;
  return v.unit === 'px' ? v.value : v.unit === 'rem' ? v.value * 16 : undefined;
}

// CSS rules with nesting: [{ selector, decls, at }] where at is the enclosing conditional at-rule ("@media (...)")
// or ''. Comments are dropped first; @layer and @supports wrap rules without making them conditional on a state of
// the element, so they are see-through.
const SEE_THROUGH_AT = /^@(layer|supports)\b/i;
function cssRules(css) {
  const out = [];
  const walk = (text, at) => {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf('{', i);
      if (open === -1) break;
      const head = text
        .slice(i, open)
        .replace(/^[\s;}]+/, '')
        .trim();
      let depth = 1;
      let j = open + 1;
      while (j < text.length && depth) {
        if (text[j] === '{') depth++;
        else if (text[j] === '}') depth--;
        j++;
      }
      const body = text.slice(open + 1, j - 1);
      if (SEE_THROUGH_AT.test(head)) walk(body, at);
      else if (head.startsWith('@')) walk(body, (at ? at + ' ' : '') + head.replace(/\s+/g, ' '));
      else
        for (const b of blocks(`${head}{${body}}`))
          out.push({ selector: b.selector.replace(/\s+/g, ' '), decls: b.decls, at });
      i = j;
    }
  };
  walk(css.replace(/\/\*[\s\S]*?(\*\/|$)/g, ''), '');
  return out;
}

// Split a CSS value into words, keeping "var(...)" and other functions whole.
function cssWords(v) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of v) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (/\s/.test(ch) && depth === 0) {
      if (cur) out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

const BORDER_STYLES = new Set([
  'none',
  'hidden',
  'dotted',
  'dashed',
  'solid',
  'double',
  'groove',
  'ridge',
  'inset',
  'outset'
]);
// Which part of a border a word is: style, width or color.
function borderPart(w) {
  if (BORDER_STYLES.has(w)) return 'style';
  if (
    /^([\d.]+(px|rem|em)?|thin|medium|thick|calc\(.*\))$/.test(w) ||
    /^var\(--[a-z0-9-]*(width|space)[a-z0-9-]*\)$/.test(w)
  )
    return 'width';
  return 'color';
}
// A border shorthand → its three parts; what it leaves out is reset, as in the browser.
function borderParts(prefix, value) {
  const parts = { width: 'medium', style: 'none', color: 'currentcolor' };
  for (const w of cssWords(value)) parts[borderPart(w)] = w;
  return Object.entries(parts).map(([k, v]) => [`${prefix}-${k}`, v]);
}
// Up to four values → [block-start, inline-end, block-end, inline-start] (the shorthand order).
function fourSides(value) {
  const w = cssWords(value);
  const [a, b = a, c = a, d = b] = w;
  return [a, b, c, d];
}
// One declaration → the longhands it sets, so that two spellings of the same thing compare equal.
function longhands(p, value) {
  if (p === 'background') return [['background-color', value]];
  if (p === 'border') return borderParts('border', value);
  if (/^border-(width|style|color)$/.test(p)) return [[p, value]];
  if (/^border-(inline|block)-(start|end)$/.test(p)) return borderParts(p, value);
  if (p === 'padding') {
    const [bs, ie, be, is] = fourSides(value);
    return [
      ['padding-block-start', bs],
      ['padding-inline-end', ie],
      ['padding-block-end', be],
      ['padding-inline-start', is]
    ];
  }
  if (p === 'padding-block' || p === 'padding-inline') {
    const w = cssWords(value);
    return [
      [`${p}-start`, w[0]],
      [`${p}-end`, w[1] || w[0]]
    ];
  }
  return [[p, value]];
}

// The value of a css axis: for each state of the element (base, :hover, @media ...), every longhand the axis's
// properties set, resolved as in the browser (!important, then the later declaration), written one way.
function cssAxisValue(axis, css) {
  const S = axis.css.selector;
  const states = new Map(); // state -> longhand -> { value, important }
  for (const r of cssRules(css)) {
    let state = null;
    if (r.selector === S) state = '';
    else if (r.selector.startsWith(S) && /[^a-z0-9_-]/i.test(r.selector[S.length])) state = r.selector.slice(S.length);
    if (state === null) continue;
    state = (r.at ? r.at + ' ' : '') + state;
    if (state && !axis.css.states) continue;
    const m = states.get(state) || new Map();
    for (const [p, raw] of Object.entries(r.decls)) {
      if (!axis.css.properties.includes(p)) continue;
      const important = IMPORTANT.test(raw);
      const value = plainValue(raw).toLowerCase().replace(/\s+/g, ' ');
      for (const [k, v] of longhands(p, value)) {
        const old = m.get(k);
        if (!old || important || !old.important) m.set(k, { value: v, important });
      }
    }
    states.set(state, m);
  }
  const out = [];
  for (const [state, m] of states) for (const [k, d] of m) out.push(`${state}|${k}=${d.value}`);
  return out.sort();
}

// The value of one axis for one template.
function axisValue(axis, t) {
  if (axis.css) return t.recipe ? cssAxisValue(axis, t.recipe.css) : undefined;
  const v = pointer(t, axis.path);
  // A value that only repeats the one it falls back to (numerals = the Arabic family, or the Latin one in a
  // Latin-only font; a heading family = the body's) is not a choice of its own. Missing means the same: resolve.js
  // falls back to it (task 3.8: missing is never a value of its own, or a font without Latin would count twice).
  if (axis.unlessEqual) {
    if (v === undefined) return '=';
    const other = []
      .concat(axis.unlessEqual)
      .map((p) => pointer(t, p))
      .find((x) => x !== undefined);
    if (other !== undefined && canonical(v) === canonical(other)) return '=';
  }
  if (!axis.reduce) return v;
  if (!isObject(v) && !Array.isArray(v)) return undefined;
  const nums = Object.values(v)
    .map((x) => toPx(axis.items ? pointer(x, axis.items) : x))
    .filter((x) => x !== undefined);
  if (axis.reduce === 'max') return nums.length ? Math.max(...nums) : undefined;
  const pos = nums.filter((x) => x > 0);
  return pos.length ? Math.min(...pos) : undefined;
}

// What an axis with a fallback ("unlessEqual") resolves to: its own value, or the value it falls back to.
function axisResolved(axis, t) {
  const v = pointer(t, axis.path);
  if (v !== undefined) return v;
  return []
    .concat(axis.unlessEqual)
    .map((p) => pointer(t, p))
    .find((x) => x !== undefined);
}

const HEX = /^#[0-9a-f]{6}$/i;
const EPS = 1e-9; // 1.75 - 1.7 is 0.05000000000000004: a tolerance includes its edge
const SHADOW_ALPHA = 0.02;
function oklab(hex) {
  const c = color.toOklch(hex);
  const h = (c.H * Math.PI) / 180;
  return [c.L, c.C * Math.cos(h), c.C * Math.sin(h)];
}
const near = (a, b, tol) => a !== undefined && b !== undefined && Math.abs(a - b) <= tol + EPS;
const sameColor = (a, b, tol) => {
  if (typeof a !== 'string' || typeof b !== 'string' || !HEX.test(a) || !HEX.test(b)) return a === b;
  const [x, y] = [oklab(a), oklab(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]) <= tol + EPS;
};

// Do two shadow values (lists of layers) look the same: same layers, lengths within the tolerance, alpha within 0.02?
function sameShadow(a, b, tol) {
  if (!Array.isArray(a) || !Array.isArray(b)) return canonical(a) === canonical(b);
  if (a.length !== b.length) return false;
  // Layers in any order: sort both lists by what they draw.
  const key = (l) => (isObject(l) ? [toPx(l.offsetY), toPx(l.blur), toPx(l.spread), toPx(l.offsetX)] : []);
  const order = (list) =>
    list.slice().sort((p, q) => {
      const [x, y] = [key(p), key(q)];
      for (let i = 0; i < 4; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0);
      return 0;
    });
  const [A, B] = [order(a), order(b)];
  return A.every((x, i) => {
    const y = B[i];
    if (!isObject(x) || !isObject(y)) return canonical(x) === canonical(y);
    const cx = isObject(x.color) ? x.color : {};
    const cy = isObject(y.color) ? y.color : {};
    const alpha = (c) => (typeof c.alpha === 'number' ? c.alpha : 1);
    return (
      ['offsetX', 'offsetY', 'blur', 'spread'].every((k) => near(toPx(x[k]), toPx(y[k]), tol)) &&
      Boolean(x.inset) === Boolean(y.inset) &&
      sameColor(cx.hex, cy.hex, 0.02) &&
      near(alpha(cx), alpha(cy), SHADOW_ALPHA)
    );
  });
}

// Do two values of an axis count as the same?
function same(axis, a, b) {
  if (axis.compare === 'number' && typeof a === 'number' && typeof b === 'number') return near(a, b, axis.tolerance);
  if (axis.compare === 'dimension' && toPx(a) !== undefined && toPx(b) !== undefined)
    return near(toPx(a), toPx(b), axis.tolerance);
  if (axis.compare === 'color') return sameColor(a, b, axis.tolerance);
  if (axis.compare === 'shadow') return sameShadow(a, b, axis.tolerance);
  if (axis.compare === 'set' && Array.isArray(a) && Array.isArray(b)) {
    const k = (l) => JSON.stringify(l.map(canonical).sort());
    return k(a) === k(b);
  }
  return canonical(a) === canonical(b);
}

function axesProblems(libraryDir, valid, add, counts) {
  const raw = [];
  const file = path.join(libraryDir, 'axes.json');
  if (!fs.existsSync(file))
    return add('axes', 'axes.json', null, 'missing: every element needs its fixed list of axes');
  const axes = build.readJson(file, raw);
  raw.splice(0).forEach((p) => add('axes', 'axes.json', null, p));
  if (axes === undefined) return;
  const r = checkAxes(axes);
  r.errors.forEach((e) => add('axes', 'axes.json', null, `${e.instancePath || '/'} ${e.message}`));
  if (!r.valid) return;
  let sound = true;
  for (const e of ELEMENTS) {
    const ids = new Set();
    for (const a of axes[e]) {
      const say = (m) => {
        add('axes', 'axes.json', `${e}/${a.id}`, m);
        sound = false;
      };
      if (ids.has(a.id)) say(`axis "${a.id}" is listed twice`);
      ids.add(a.id);
      if (!a.path === !a.css) say('an axis has either "path" or "css"');
      if ((a.reduce || a.items) && !(a.path && a.reduce)) say('"items" and "reduce" go with "path"');
      if (a.reduce && a.compare !== 'dimension' && a.compare !== 'number') say('"reduce" gives a number or a length');
      if (a.unlessEqual && !a.path) say('"unlessEqual" goes with "path"');
      if (['number', 'dimension', 'color', 'shadow'].includes(a.compare) !== (a.tolerance !== undefined))
        say('"tolerance" goes with a "number", "dimension", "color" or "shadow" axis, and only there');
      if (a.css && a.compare !== 'exact') say('a "css" axis compares "exact"');
      nameProblems(a.name).forEach(say);
    }
  }
  if (!sound) return;

  for (const e of ELEMENTS) {
    const list = valid.filter((v) => v.t.element === e);
    const total = axes[e].reduce((n, a) => n + (a.weight || 1), 0);
    const needed = Math.min(2, total);
    const values = list.map((v) => axes[e].map((a) => axisValue(a, v.t)));
    const resolved = list.map((v) => axes[e].map((a) => (a.unlessEqual ? axisResolved(a, v.t) : undefined)));
    for (let j = 1; j < list.length; j++) {
      for (let i = 0; i < j; i++) {
        counts.comparisons++;
        // An axis with a fallback differs only when it is a choice of its own in one of the two AND what it
        // resolves to differs: a missing heading family and an explicit one naming the same font draw the same
        // headings (task 3.8, independent review).
        const differ = axes[e].filter(
          (a, k) => !same(a, values[i][k], values[j][k]) && !(a.unlessEqual && same(a, resolved[i][k], resolved[j][k]))
        );
        const weight = differ.reduce((n, a) => n + (a.weight || 1), 0);
        if (weight >= needed) continue;
        const a = list[i].t.id;
        const what = differ.length
          ? `differs from "${a}" (${list[i].file}) only in ${differ.map((x) => x.name.en).join(', ')}`
          : `has the same values as "${a}" (${list[i].file}) on every axis`;
        add('axes', list[j].file, list[j].label, `${what}; two templates of one element must differ in ${needed} axes`);
      }
    }
  }
}

/* ---------- licenses and sources (task 3.2) ---------- */

// The shapes of sources.json and licenses.json live in notices.js, which also refuses to render without them.
const { checkSources, checkLicenses, OWN_ID } = notices;
const ICONIFY = /iconify|icones\.js\.org/i;
// System font names a font stack may end with: they name the device's own font and ship nothing.
const SYSTEM_FONTS = new Set(['apple color emoji', 'blinkmacsystemfont', 'segoe ui emoji', 'segoe ui symbol']);

// Lower-case words: "Remix-Design/RemixIcon" → " remix design remixicon ". Keywords match whole words, so "SF Pro"
// is found in "SF Pro Text" and "Apple" in "developer.apple.com", but "apple" is not in "Pineapple".
const words = (v) =>
  ' ' +
  String(v)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim() +
  ' ';

// The copyright line of the project's LICENSE.
function ownCopyright() {
  try {
    return (fs.readFileSync(path.join(ROOT, 'LICENSE'), 'utf8').match(/^Copyright .+$/m) || [''])[0];
  } catch {
    return '';
  }
}

// The forbidden source a text names, or null. Each keyword is matched inside each text on its own; an id (an icon
// library or Iconify prefix such as "ri") only when the whole id-like value is that id.
function forbiddenIn(texts, forbidden, ids = []) {
  for (const f of forbidden) {
    const keys = f.match.map(words).filter((k) => k.trim().length >= 3);
    for (const text of texts) {
      if (typeof text !== 'string' || !text) continue;
      const w = words(text);
      if (keys.some((k) => w.includes(k))) return f.name;
    }
    const exact = (f.ids || []).map((x) => x.toLowerCase());
    if (ids.some((v) => typeof v === 'string' && exact.includes(v.toLowerCase()))) return f.name;
  }
  return null;
}

// An Iconify copy (its sites, its @iconify-json packages on npm or a CDN, its icon-sets repository): not the set's
// own repository, so its license label is not to be trusted (spec.md §9).
const iconify = (url) => typeof url === 'string' && ICONIFY.test(url);

// Extras that are not names: the copied SVG samples and free text, which may mention a forbidden source in passing.
const PROSE = new Set(['samples', 'viewBox', 'note', 'notes', 'description']);
const systemFont = (f) => f.startsWith('-') || SYSTEM_FONTS.has(f.trim().toLowerCase());

// Every name a template gives for where it comes from: source, address, every text in extras (icon library, font
// names, palette name, ...; not the copied SVG samples), font families. System font names are left out.
function originTexts(t) {
  const out = [t.source.name, t.source.url];
  const stack = [isObject(t.extras) ? t.extras : {}];
  while (stack.length) {
    const v = stack.pop();
    if (typeof v === 'string') {
      if (!systemFont(v)) out.push(v);
    } else if (Array.isArray(v)) stack.push(...v);
    else if (isObject(v)) for (const [k, x] of Object.entries(v)) if (!PROSE.has(k)) stack.push(x);
  }
  const fonts = isObject(t.tokens) && isObject(t.tokens.font) ? t.tokens.font : {};
  for (const tok of Object.values(fonts)) {
    if (!isObject(tok)) continue;
    const v = tok.$value;
    out.push(...(Array.isArray(v) ? v : [v]).filter((f) => typeof f === 'string' && !systemFont(f)));
  }
  return out;
}
// The id-like values of a template: its icon library and the source ids it names.
function originIds(t) {
  const x = isObject(t.extras) ? t.extras : {};
  return [x.library].concat(Array.isArray(x.sources) ? x.sources : []);
}

function licenseProblems(libraryDir, valid, add, counts) {
  const raw = [];
  const read = (name) => {
    const file = path.join(libraryDir, name);
    if (!fs.existsSync(file)) {
      add('license', name, null, 'missing');
      return undefined;
    }
    const v = build.readJson(file, raw);
    raw.splice(0).forEach((p) => add('license', name, null, p));
    return v;
  };
  const sources = read('sources.json');
  const licenses = read('licenses.json');
  let sourcesOk = sources !== undefined;
  let licensesOk = licenses !== undefined;
  if (sourcesOk) {
    const r = checkSources(sources);
    r.errors.forEach((e) => add('license', 'sources.json', null, `${e.instancePath || '/'} ${e.message}`));
    sourcesOk = r.valid;
  }
  if (licensesOk) {
    const r = checkLicenses(licenses);
    r.errors.forEach((e) => add('license', 'licenses.json', null, `${e.instancePath || '/'} ${e.message}`));
    licensesOk = r.valid;
  }
  if (!sourcesOk || !licensesOk) {
    // Without both files no template can be judged: say so once for each, never pass them silently.
    valid.forEach(({ file, label }) =>
      add('license', file, label, 'cannot be checked: sources.json or licenses.json is not sound')
    );
    return;
  }
  counts.sources = sources.length;

  const allowed = new Map();
  licenses.allowed.forEach((l, i) => {
    if (allowed.has(l.id)) add('license', 'licenses.json', l.id, `allowed[${i}]: "${l.id}" is listed twice`);
    if (l.text && l.text.join('').replace(/\s/g, '').length < 200)
      add('license', 'licenses.json', l.id, 'the license text is too short to be the full text');
    allowed.set(l.id, l);
  });
  const forbidden = licenses.forbiddenSources;

  const byName = new Map();
  const byId = new Map();
  const used = new Set();
  let own = 0;
  for (const s of sources) {
    const say = (m) => add('license', 'sources.json', s.id, m);
    if (byId.has(s.id)) say(`id "${s.id}" is listed twice`);
    if (byName.has(s.name)) say(`name "${s.name}" is listed twice`);
    byId.set(s.id, s);
    byName.set(s.name, s);
    // Only the project's own entry may be "own" (left out of the notices), and it must say so.
    if (s.own) own++;
    if (s.own && s.id !== OWN_ID)
      say(`only the project's own entry ("${OWN_ID}") may be "own"; this one is third-party`);
    if (!s.own && s.id === OWN_ID) say('the project\'s own entry must have "own": true');
    if (s.own && s.id === OWN_ID && !(s.name === 'Hawiya' && s.license === 'MIT' && s.copyright[0] === ownCopyright()))
      say("the project's own entry must be named Hawiya, under MIT, with the copyright line of LICENSE");
    for (const k of ['url', 'licenseFile'])
      if (iconify(s[k])) say(`${k} is an Iconify page; record the set's own repository and license file`);
    const parts = [{ license: s.license, where: '' }].concat(
      (s.also || []).map((a, i) => ({ license: a.license, where: ` (also[${i}])` }))
    );
    for (const p of parts) {
      const l = allowed.get(p.license);
      if (!l) say(`license "${p.license}"${p.where} is not on the allowed list of licenses.json`);
      else if (!s.own && !l.text)
        say(`license "${p.license}"${p.where} has no text in licenses.json, so the notices cannot print it`);
    }
    const hit = forbiddenIn([s.id, s.name, s.url, s.licenseFile], forbidden, [s.id]);
    if (hit) say(`is the forbidden source "${hit}" (licenses.json)`);
  }
  if (own > 1) add('license', 'sources.json', null, 'only the project itself is "own"');

  for (const { file, label, t } of valid) {
    const say = (m) => add('license', file, label, m);
    const src = byName.get(t.source.name);
    if (!allowed.has(t.source.license))
      say(`license "${t.source.license}" is not on the allowed list of licenses.json`);
    if (!src) say(`source "${t.source.name}" is not in sources.json (record it after reading its license file)`);
    else {
      used.add(src.id);
      if (t.source.url !== src.url) say(`source address ${t.source.url} differs from sources.json (${src.url})`);
      if (t.source.license !== src.license)
        say(`license "${t.source.license}" differs from sources.json ("${src.license}")`);
    }
    const extra = isObject(t.extras) ? t.extras.sources : undefined;
    if (extra !== undefined) {
      if (!Array.isArray(extra) || !extra.every((x) => typeof x === 'string'))
        say('extras.sources must be a list of source ids');
      else
        for (const id of extra) {
          if (!byId.has(id)) say(`extras.sources: "${id}" is not in sources.json`);
          else used.add(id);
        }
    }
    if (iconify(t.source.url)) say("source address is an Iconify page; name the set's own repository");
    const hit = forbiddenIn(originTexts(t), forbidden, originIds(t));
    if (hit) say(`comes from the forbidden source "${hit}" (licenses.json)`);
  }
  for (const s of sources) {
    if (!used.has(s.id) && !s.own)
      add('license', 'sources.json', s.id, 'no template uses this source; remove it or use it');
  }
}

// undefined: could not render (sources or licenses not sound); '' : matches; else the problem.
function noticesProblem(libraryDir, noticesFile) {
  let want;
  try {
    const { sources, licenses } = notices.load(libraryDir);
    want = notices.render(sources, licenses);
  } catch (e) {
    if (e instanceof notices.NoticesError) return undefined;
    throw e;
  }
  let have;
  try {
    have = fs.readFileSync(noticesFile, 'utf8');
  } catch {
    return 'missing; run npm run notices';
  }
  return have === want ? '' : 'differs from what sources.json and licenses.json give; run npm run notices';
}

// The JSON a generated data file carries (its last argument), or undefined.
function dataList(text) {
  const at = text.lastIndexOf("typeof self !== 'undefined' ? self : this, ");
  if (at === -1 || !text.endsWith(');\n')) return undefined;
  try {
    return JSON.parse(text.slice(at + "typeof self !== 'undefined' ? self : this, ".length, -3));
  } catch {
    return undefined;
  }
}

// Which templates (or identities) differ between the built file and the committed one, by id.
function changedIds(want, have) {
  const a = dataList(want);
  const b = dataList(have);
  if (!Array.isArray(a) || !Array.isArray(b)) return null;
  const index = (list) => new Map(list.filter(isObject).map((x) => [x.id, JSON.stringify(x)]));
  const A = index(a);
  const B = index(b);
  const out = [];
  for (const [id, v] of A)
    out.push(
      ...(!B.has(id)
        ? [[id, 'missing from picker/data']]
        : B.get(id) !== v
          ? [[id, 'changed since the last build']]
          : [])
    );
  for (const id of B.keys())
    if (!A.has(id)) out.push([id, 'in picker/data but not published by the library (removed or now a draft)']);
  return out;
}

function dataProblems(files, dataDir) {
  const out = [];
  const hint = 'run npm run build';
  let have;
  try {
    have = fs.readdirSync(dataDir).filter((n) => !n.startsWith('.'));
  } catch {
    return [{ file: dataDir, template: null, message: `cannot read the page data folder; ${hint}` }];
  }
  for (const name of Object.keys(files)) {
    const file = `picker/data/${name}`;
    if (!have.includes(name)) {
      out.push({ file, template: null, message: `missing; ${hint}` });
      continue;
    }
    let bytes;
    try {
      bytes = fs.readFileSync(path.join(dataDir, name));
    } catch (e) {
      out.push({ file, template: null, message: `cannot read (${e.code || e.message}); ${hint}` });
      continue;
    }
    if (bytes.equals(Buffer.from(files[name]))) continue;
    const ids = changedIds(files[name], bytes.toString('utf8'));
    if (ids && ids.length) ids.forEach(([id, why]) => out.push({ file, template: id, message: `${why}; ${hint}` }));
    else out.push({ file, template: null, message: `differs from what the library builds to; ${hint}` });
  }
  for (const name of have)
    if (!own(files, name))
      out.push({
        file: `picker/data/${name}`,
        template: null,
        message: 'not made by the build; remove it or run npm run build'
      });
  return out;
}

const KINDS = [
  'structure',
  'schema',
  'tokens',
  'id',
  'tags',
  'names',
  'contrast',
  'reduced-motion',
  'logical',
  'recipe',
  'identity',
  'license',
  'axes',
  'notices',
  'data'
];

function report(result) {
  const { problems, counts } = result;
  const rel = (p) => path.relative(process.cwd(), p) || '.';
  const lines = [`hawiya check: ${rel(result.libraryDir)} and ${rel(result.dataDir)}`];
  const scope = `${counts.templates} templates (${counts.reviewed} reviewed, ${counts.drafts} drafts), ${counts.identities} identities`;
  if (!problems.length) {
    lines.push(`  checked: ${KINDS.join(', ')}`);
    lines.push(`  ${counts.pairs} contrast checks; ${counts.sources} sources, licenses allowed, none forbidden`);
    lines.push(`  لا تكرار — no duplicates: ${counts.comparisons} comparisons, every two templates differ in two axes`);
    lines.push(
      `  ${counts.identitiesBuilt} ready identities built in Arabic, English and both: the blocking rules pass in light and dark; each DESIGN.md passes the official check`
    );
    lines.push(
      `  THIRD_PARTY_NOTICES.md matches sources.json; picker/data matches the library (${counts.dataFiles} files)`
    );
    lines.push(
      `نجاح: فُحص ${counts.templates} تمبلت (${counts.reviewed} مراجَع، ${counts.drafts} مسودة) و ${counts.identities} هوية بلا أي مخالفة`
    );
    lines.push(`success: ${scope} checked, no problem`);
    return lines.join('\n');
  }
  const sorted = problems.slice().sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind));
  for (const p of sorted) {
    const where = [p.file, p.template].filter(Boolean).join(' › ');
    lines.push(`  ✗ [${p.kind}] ${where ? where + ': ' : ''}${p.message}`);
  }
  if (!result.noticesChecked)
    lines.push('  (THIRD_PARTY_NOTICES.md is compared once sources.json and licenses.json are sound)');
  if (!result.dataChecked) lines.push('  (picker/data is compared with the library once the library has no problem)');
  lines.push(`فشل: ${problems.length} مخالفة (فُحص ${counts.templates} تمبلت و ${counts.identities} هوية)`);
  lines.push(`failed: ${problems.length} problem(s) in ${scope}`);
  return lines.join('\n');
}

function main(argv) {
  const opts = {
    libraryDir: path.join(ROOT, 'library'),
    dataDir: path.join(ROOT, 'picker', 'data'),
    noticesFile: path.join(ROOT, 'THIRD_PARTY_NOTICES.md')
  };
  const flags = { '--library': 'libraryDir', '--data': 'dataDir', '--notices': 'noticesFile' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (own(flags, a) && argv[i + 1]) opts[flags[a]] = path.resolve(argv[++i]);
    else {
      process.stderr.write(
        `hawiya check: unknown option ${a}\nusage: node tools/check.js [--library <dir>] [--data <dir>] [--notices <file>]\n`
      );
      return 2;
    }
  }
  const result = check(opts);
  const text = report(result) + '\n';
  if (result.problems.length) {
    process.stderr.write(text);
    return 1;
  }
  process.stdout.write(text);
  return 0;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = {
  KINDS,
  check,
  report,
  main,
  blocks,
  tokenProblems,
  recipePairs,
  lintDesignMd,
  motionIn,
  stills,
  same,
  nameProblems,
  physicalCss
};
