#!/usr/bin/env node
'use strict';
/*
 * Icon samples for every confirmed icon library (task 3.5, R-047; begun in task 2.12).
 *
 *   node tools/icons-extract.js             fills extras.viewBox and extras.samples of every icons template
 *   node tools/icons-extract.js --list      extracts the regular outline sample of every confirmed library and
 *                                           prints it (writes nothing)
 *
 * The same 14 meanings come from each library, so the page shows real icons with no request to the internet: every
 * icons template gets extras.viewBox and extras.samples { <fill>: [{ meaning, body }] } for each fill its library
 * offers in that weight (all 14 icons, or that fill is left out). Sources are the @iconify-json packages (dev only);
 * each library's license is the one read from its own repository or page (library/sources.json, same id as the
 * library), never the Iconify label. Bodies are checked against a small allow-list of SVG shapes and attributes;
 * anything else stops the tool, and so do an icon that is missing, drawn by a flipped or rotated alias, or of
 * another size than the rest. Output is stable: same packages, same file.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'library', 'elements', 'icons.json');

// The sample: one icon per meaning, in this order, for every library. Mirroring follows the meaning (identity
// extensions.rtl, R-093): arrow, chevron and undo mirror in RTL; check, clock and play never do.
const MEANINGS = [
  'arrow',
  'chevron',
  'undo',
  'search',
  'home',
  'settings',
  'user',
  'bell',
  'plus',
  'close',
  'menu',
  'check',
  'clock',
  'play'
];
const FILLS = ['outline', 'filled', 'duotone'];

/*
 * The confirmed libraries of the project file (a source with its license read: «مؤكد»). For each: its package, the
 * icon name for every meaning (MEANINGS order), and how a template's weight and fill name the icon: "{}" is the name;
 * a list tries each pattern in turn. A stroke library (stroke: its own width) draws every weight from its outline
 * icons, with the template's stroke width.
 */
const LIBRARIES = {
  lucide: {
    pkg: 'lucide',
    stroke: 2,
    names: [
      'arrow-right',
      'chevron-right',
      'undo-2',
      'search',
      'house',
      'settings',
      'user',
      'bell',
      'plus',
      'x',
      'menu',
      'check',
      'clock',
      'play'
    ],
    weights: { any: { outline: '{}' } }
  },
  tabler: {
    pkg: 'tabler',
    stroke: 2,
    names: [
      'arrow-right',
      'chevron-right',
      'arrow-back-up',
      'search',
      'home',
      'settings',
      'user',
      'bell',
      'plus',
      'x',
      'menu-2',
      'check',
      'clock',
      'player-play'
    ],
    weights: { any: { outline: '{}' } }
  },
  phosphor: {
    pkg: 'ph',
    names: [
      'arrow-right',
      'caret-right',
      'arrow-counter-clockwise',
      'magnifying-glass',
      'house',
      'gear',
      'user',
      'bell',
      'plus',
      'x',
      'list',
      'check',
      'clock',
      'play'
    ],
    weights: {
      thin: { outline: '{}-thin' },
      light: { outline: '{}-light' },
      regular: { outline: '{}', filled: '{}-fill', duotone: '{}-duotone' },
      bold: { outline: '{}-bold' }
    }
  },
  'material-symbols': {
    pkg: 'material-symbols',
    names: [
      'arrow-forward',
      'chevron-right',
      'undo',
      'search',
      'home',
      'settings',
      'person',
      'notifications',
      'add',
      'close',
      'menu',
      'check',
      'schedule',
      'play-arrow'
    ],
    // The plain name is the filled style; an icon without an -outline variant is the same in both.
    weights: { regular: { outline: ['{}-outline', '{}'], filled: '{}' } }
  },
  fluent: {
    pkg: 'fluent',
    names: [
      'arrow-right',
      'chevron-right',
      'arrow-undo',
      'search',
      'home',
      'settings',
      'person',
      'alert',
      'add',
      'dismiss',
      'navigation',
      'checkmark',
      'clock',
      'play'
    ],
    weights: { regular: { outline: '{}-24-regular', filled: '{}-24-filled' } }
  },
  hugeicons: {
    pkg: 'hugeicons',
    stroke: 1.5,
    names: [
      'arrow-right-02',
      'arrow-right-01',
      'undo-02',
      'search-01',
      'home-01',
      'settings-02',
      'user',
      'notification-01',
      'add-01',
      'cancel-01',
      'menu-01',
      'tick-02',
      'clock-01',
      'play'
    ],
    weights: { any: { outline: '{}' } }
  },
  iconoir: {
    pkg: 'iconoir',
    stroke: 1.5,
    names: [
      'arrow-right',
      'nav-arrow-right',
      'undo',
      'search',
      'home',
      'settings',
      'user',
      'bell',
      'plus',
      'xmark',
      'menu',
      'check',
      'clock',
      'play'
    ],
    weights: { any: { outline: '{}', filled: '{}-solid' } }
  },
  heroicons: {
    pkg: 'heroicons',
    stroke: 1.5,
    names: [
      'arrow-right',
      'chevron-right',
      'arrow-uturn-left',
      'magnifying-glass',
      'home',
      'cog-6-tooth',
      'user',
      'bell',
      'plus',
      'x-mark',
      'bars-3',
      'check',
      'clock',
      'play'
    ],
    weights: { any: { outline: '{}', filled: '{}-solid' } }
  },
  mingcute: {
    pkg: 'mingcute',
    names: [
      'arrow-right',
      'right',
      'back-2',
      'search',
      'home-4',
      'settings-3',
      'user-3',
      'notification',
      'add',
      'close',
      'menu',
      'check',
      'time',
      'play'
    ],
    weights: { regular: { outline: '{}-line', filled: '{}-fill' } }
  },
  carbon: {
    pkg: 'carbon',
    names: [
      'arrow-right',
      'chevron-right',
      'undo',
      'search',
      'home',
      'settings',
      'user',
      'notification',
      'add',
      'close',
      'menu',
      'checkmark',
      'time',
      'play'
    ],
    weights: { regular: { outline: '{}', filled: '{}-filled' } }
  },
  bootstrap: {
    pkg: 'bi',
    names: [
      'arrow-right',
      'chevron-right',
      'arrow-counterclockwise',
      'search',
      'house',
      'gear',
      'person',
      'bell',
      'plus',
      'x',
      'list',
      'check',
      'clock',
      'play'
    ],
    weights: { regular: { outline: '{}', filled: '{}-fill' } }
  },
  solar: {
    pkg: 'solar',
    names: [
      'arrow-right',
      'alt-arrow-right',
      'undo-left',
      'magnifer',
      'home-2',
      'settings',
      'user',
      'bell',
      'add',
      'close',
      'hamburger-menu',
      'check',
      'clock-circle',
      'play'
    ],
    weights: { regular: { outline: '{}-linear', filled: '{}-bold', duotone: '{}-bold-duotone' } }
  },
  streamline: {
    pkg: 'streamline',
    stroke: 1,
    // Streamline's free core set only (one family, 14px grid): its names describe the icon at length.
    names: [
      'interface-arrows-right-arrow-right-keyboard',
      'interface-arrows-button-right-arrow-right-keyboard',
      'interface-arrows-turn-backward-arrow-bend-curve-change-direction-return-left-back-backward',
      'interface-search-glass-search-magnifying',
      'interface-home-3-home-house-map-roof',
      'interface-setting-cog-work-loading-cog-gear-settings-machine',
      'interface-user-single-close-geometric-human-person-single-up-user',
      'interface-alert-alarm-bell-2-alert-bell-ring-notification-alarm',
      'interface-add-1-expand-cross-buttons-button-more-remove-plus-add',
      'interface-delete-2-remove-bold-add-button-buttons-delete',
      'interface-setting-menu-1-button-parallel-horizontal-lines-menu-navigation-three-hamburger',
      'interface-validation-check-check-form-validation-checkmark-success-add-addition',
      'interface-time-clock-circle-clock-loading-measure-time-circle',
      'entertainment-control-button-play-button-television-buttons-movies-play-tv-video-controls'
    ],
    weights: { any: { outline: '{}' } }
  },
  iconamoon: {
    pkg: 'iconamoon',
    names: [
      'arrow-right-1',
      'arrow-right-2',
      'do-undo',
      'search',
      'home',
      'settings',
      'profile',
      'notification',
      'sign-plus',
      'close',
      'menu-burger-horizontal',
      'check',
      'clock',
      'player-play'
    ],
    weights: {
      thin: { outline: '{}-thin' },
      light: { outline: '{}-light' },
      regular: { outline: '{}', filled: '{}-fill', duotone: '{}-duotone' },
      bold: { outline: '{}-bold' }
    }
  },
  basil: {
    pkg: 'basil',
    // Basil has no undo icon; its reply arrow (curved, pointing back) carries the same meaning.
    names: [
      'arrow-right',
      'caret-right',
      'reply',
      'search',
      'home',
      'settings',
      'user',
      'notification',
      'plus',
      'cross',
      'menu',
      'check',
      'clock',
      'play'
    ],
    weights: { regular: { outline: '{}-outline', filled: '{}-solid' } }
  }
};

// What the gallery may draw: plain shapes and their paint attributes. No scripts, links, styles or events.
const ELEMENTS = new Set(['path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse', 'g']);
const ATTRS = new Set([
  'd',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'width',
  'height',
  'points',
  'fill',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'opacity',
  'fill-opacity',
  'fill-rule',
  'clip-rule'
]);

function check(body, where) {
  const tags = [...body.matchAll(/<\/?([a-zA-Z][\w:-]*)([^>]*)>/g)];
  if (!tags.length) throw new Error(`${where}: empty icon`);
  const rest = body.replace(/<\/?([a-zA-Z][\w:-]*)([^>]*)>/g, '').trim();
  if (rest) throw new Error(`${where}: text outside the shapes`);
  for (const [, tag, attrs] of tags) {
    if (!ELEMENTS.has(tag)) throw new Error(`${where}: <${tag}> is not allowed`);
    for (const [, name, value] of attrs.matchAll(/([\w:-]+)="([^"]*)"/g)) {
      if (!ATTRS.has(name)) throw new Error(`${where}: attribute ${name} is not allowed`);
      if (/url\(|javascript:|[<>]/i.test(value)) throw new Error(`${where}: value of ${name} is not allowed`);
    }
    const leftover = attrs.replace(/([\w:-]+)="([^"]*)"/g, '').replace(/[\s/]/g, '');
    if (leftover) throw new Error(`${where}: unexpected "${leftover}"`);
  }
  return body;
}

const sets = new Map();
function iconSet(lib) {
  if (!sets.has(lib)) sets.set(lib, require(`@iconify-json/${LIBRARIES[lib].pkg}/icons.json`));
  return sets.get(lib);
}

// An icon of a set: its body and size. An alias that flips or rotates its parent would draw another shape.
function icon(set, name) {
  let entry = set.icons[name];
  let alias = {};
  if (!entry && set.aliases && set.aliases[name]) {
    alias = set.aliases[name];
    const changes = Object.keys(alias).filter((k) => !['parent', 'width', 'height'].includes(k));
    if (changes.length) return { problem: `${name} is an alias that changes its icon (${changes.join(', ')})` };
    entry = set.icons[alias.parent];
  }
  if (!entry) return null;
  const width = alias.width || entry.width || set.width || 16;
  const height = alias.height || entry.height || set.height || 16;
  return { body: entry.body, size: `0 0 ${width} ${height}` };
}

// The icon name for a meaning in a weight and fill, or null when the library does not offer that weight or fill.
function variant(L, weight, fill, name, set) {
  const style = (Object.hasOwn(L.weights, weight) && L.weights[weight]) || L.weights.any;
  const pattern = style && Object.hasOwn(style, fill) && style[fill];
  if (!pattern) return null;
  const names = [].concat(pattern).map((p) => p.replace('{}', name));
  return names.find((n) => set.icons[n] || (set.aliases && set.aliases[n])) || names[0];
}

// The 14 icons of a library in a weight and fill: { viewBox, list } or null when that weight or fill is not offered
// (or not for every meaning). Throws when an icon is unsafe, changed by an alias, or of another size than the rest.
// `set` replaces the library's package (tests).
function sample(lib, weight, fill, where, set) {
  if (typeof lib !== 'string' || !Object.hasOwn(LIBRARIES, lib))
    throw new Error(`${where}: no icon set for library "${lib}"`);
  const L = LIBRARIES[lib];
  set = set || iconSet(lib);
  const list = [];
  let viewBox = null;
  for (let i = 0; i < MEANINGS.length; i++) {
    const name = variant(L, weight, fill, L.names[i], set);
    if (!name) return null;
    const found = icon(set, name);
    if (found && found.problem) throw new Error(`${where}: ${found.problem}`);
    if (!found) {
      if (fill === 'outline') throw new Error(`${where}: ${name} is missing`);
      return null; // this fill is not complete in the library: left out
    }
    if (viewBox && found.size !== viewBox) throw new Error(`${where}: ${name} is ${found.size}, the others ${viewBox}`);
    viewBox = found.size;
    list.push({ meaning: MEANINGS[i], body: check(found.body, `${where} ${name}`) });
  }
  return { viewBox, list };
}

function extract(file = FILE) {
  const templates = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const t of templates) {
    const x = t.extras || {};
    const samples = {};
    let viewBox = null;
    for (const fill of FILLS) {
      const s = sample(x.library, x.weight, fill, t.id);
      if (!s) continue;
      if (viewBox && s.viewBox !== viewBox) throw new Error(`${t.id}: ${fill} icons are ${s.viewBox}, not ${viewBox}`);
      viewBox = s.viewBox;
      samples[fill] = s.list;
    }
    if (!samples.outline) throw new Error(`${t.id}: weight "${x.weight}" is not offered by ${x.library}`);
    if (!samples[x.fill]) throw new Error(`${t.id}: fill "${x.fill}" is not offered by ${x.library} ${x.weight}`);
    t.extras.viewBox = viewBox;
    t.extras.samples = samples;
  }
  fs.writeFileSync(file, JSON.stringify(templates, null, 2) + '\n');
  return templates.map(
    (t) => `${t.id}: ${Object.keys(t.extras.samples).join(', ')} (${t.extras.samples.outline.length} icons)`
  );
}

// Every confirmed library, regular weight, outline: the same meanings for each (writes nothing).
function libraries() {
  return Object.keys(LIBRARIES).map((lib) => {
    const s = sample(lib, 'regular', 'outline', lib);
    return { library: lib, viewBox: s.viewBox, meanings: s.list.map((x) => x.meaning), list: s.list };
  });
}

if (require.main === module) {
  const args = process.argv.slice(2);
  try {
    if (args.length === 1 && args[0] === '--list') {
      for (const l of libraries()) console.log(`${l.library}: ${l.meanings.length} icons (${l.meanings.join(', ')})`);
    } else if (args.length) {
      console.error('usage: node tools/icons-extract.js [--list]');
      process.exit(2);
    } else console.log(extract().join('\n'));
  } catch (e) {
    console.error('icons-extract: ' + e.message);
    process.exit(1);
  }
}

module.exports = { MEANINGS, LIBRARIES, check, sample, extract, libraries };
