#!/usr/bin/env node
'use strict';
/*
 * Icon samples for the icons gallery (task 2.12, early part of task 3.5). Usage: node tools/icons-extract.js
 *
 * Copies the same 14 meanings from each icon set into library/elements/icons.json, so the page shows real icons
 * with no request to the internet: every icons template gets extras.viewBox and extras.samples
 * { <fill>: [{ meaning, body }] } for the fills its set offers in that weight. Sources are the @iconify-json
 * packages (dev only); each set's license is the one read from its own repository (library/sources.json), not the
 * Iconify label. Bodies are checked against a small allow-list of SVG shapes and attributes; anything else stops
 * the tool. Output is stable: same packages, same file.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'library', 'elements', 'icons.json');

// Meaning -> icon name in each set. Mirroring follows the meaning (identity extensions.rtl, R-093):
// arrow, chevron and undo mirror in RTL; check, clock and play never do.
const MEANINGS = [
  ['arrow', 'arrow-right', 'arrow-right', 'arrow-right'],
  ['chevron', 'chevron-right', 'chevron-right', 'caret-right'],
  ['undo', 'undo-2', 'arrow-back-up', 'arrow-counter-clockwise'],
  ['search', 'search', 'search', 'magnifying-glass'],
  ['home', 'house', 'home', 'house'],
  ['settings', 'settings', 'settings', 'gear'],
  ['user', 'user', 'user', 'user'],
  ['bell', 'bell', 'bell', 'bell'],
  ['plus', 'plus', 'plus', 'plus'],
  ['close', 'x', 'x', 'x'],
  ['menu', 'menu', 'menu-2', 'list'],
  ['check', 'check', 'check', 'check'],
  ['clock', 'clock', 'clock', 'clock'],
  ['play', 'play', 'player-play', 'play']
];
const SETS = { lucide: { pkg: 'lucide', col: 1 }, tabler: { pkg: 'tabler', col: 2 }, phosphor: { pkg: 'ph', col: 3 } };

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

function iconBody(set, name, where) {
  const icon = set.icons[name] || (set.aliases && set.aliases[name] && set.icons[set.aliases[name].parent]);
  if (!icon) throw new Error(`${where}: ${name} is missing`);
  return check(icon.body, `${where} ${name}`);
}

// Which icon names a template uses for a fill: Phosphor has a variant per weight and per fill; the stroke sets
// (Lucide, Tabler) draw every weight from the same outline icons with a different stroke width.
function variant(lib, weight, fill, name) {
  if (lib !== 'phosphor') return fill === 'outline' ? name : null;
  if (weight === 'regular') return fill === 'outline' ? name : fill === 'filled' ? `${name}-fill` : `${name}-duotone`;
  return fill === 'outline' ? `${name}-${weight}` : null;
}

function extract() {
  const templates = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  for (const t of templates) {
    const lib = t.extras && t.extras.library;
    const setInfo = SETS[lib];
    if (!setInfo) throw new Error(`${t.id}: no icon set for library "${lib}"`);
    const set = require(`@iconify-json/${setInfo.pkg}/icons.json`);
    const size = set.width || set.height || 24;
    const samples = {};
    for (const fill of ['outline', 'filled', 'duotone']) {
      const list = [];
      for (const row of MEANINGS) {
        const name = variant(lib, t.extras.weight, fill, row[setInfo.col]);
        if (!name) break;
        list.push({ meaning: row[0], body: iconBody(set, name, t.id) });
      }
      if (list.length === MEANINGS.length) samples[fill] = list;
    }
    if (!samples.outline) throw new Error(`${t.id}: no outline samples`);
    t.extras.viewBox = `0 0 ${size} ${size}`;
    t.extras.samples = samples;
  }
  fs.writeFileSync(FILE, JSON.stringify(templates, null, 2) + '\n');
  return templates.map(
    (t) => `${t.id}: ${Object.keys(t.extras.samples).join(', ')} (${t.extras.samples.outline.length} icons)`
  );
}

if (require.main === module) {
  try {
    console.log(extract().join('\n'));
  } catch (e) {
    console.error('icons-extract: ' + e.message);
    process.exit(1);
  }
}

module.exports = { MEANINGS, check, extract };
