'use strict';

/*
 * Seeded random variations of JSON documents, shared by the checker tests (tests/validate.test.js, task 1.7) and the
 * Python checker parity test (tests/server/python-validate.test.js, task 1.13). Same seed, same variations.
 */

function getAt(doc, p) {
  return p.reduce((n, k) => n[k], doc);
}

function addOwnKey(obj, key, value) {
  Object.defineProperty(obj, key, { value, enumerable: true, writable: true, configurable: true });
}

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = s;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const EMOJI = '\u{1F3A8}';
const POOL = [
  null, true, false, 0, -0, 1, -1, 0.5, 1.5, 2, 2.5, 3, 4, 6, 7, 8, 9, 10, 11, 12, 13, 16, 32, 33, 64, 65, 128, 129, 200, 201, 256, 257,
  9999, 10000, 10001, -10000, -10001, -64, -65, 1e21, 0.1, 0.9999,
  '', ' ', 'a', 'A', 'ar', 'en', 'ar+en', 'rtl', 'ltr', 'both', 'web', 'AA', 'AAA', 'n/a', 'web-app', 'landing', 'minimal', 'colors',
  'type-scale', 'buttons', 'draft', 'reviewed', 'numeric', 'composite', 'curated', 'setting', '2026-11-15', '2026-13-01', '2026-02-30',
  'https://example.com/x', 'http://example.com', 'https://a b', 'MIT', 'Apache-2.0', '-MIT', '#ffffff', '#FFFFFF', '#fff', '#12345g',
  'system-ui', 'serif', 'IBM Plex Sans Arabic', 'Cairo', '"Cairo"', 'a--b', 'a-', '-a', 'a1-b2', 'constructor', 'prototype', '__proto__',
  'x'.repeat(64), 'x'.repeat(65), 'x'.repeat(80), 'x'.repeat(81), EMOJI.repeat(80), EMOJI.repeat(81), 'a<b', 'a‮b', '​', ' a ',
  '\ud800', 'a\ud800b', '١٢', 'light', 'dark', 'outline', 'gregory', 'latn', 'arab', 'subtle', 'none', 'circle',
  [], [1], ['a'], ['a', 'a'], ['colors'], ['colors', 'colors'], ['minimal'], ['web'], ['system-ui'], [1, 2, 3], [[]], [{}],
  {}, { a: 1 }, { x: 0, y: 0, blur: 0, spread: 0, color: '#000000', alpha: 0.5 }, { template: 'x' }, { state: 'draft' },
  { state: 'reviewed', reviewedAt: '2026-01-01' }, { html: 'a', css: 'b' }, { arabic: 'Cairo', fallback: ['serif'] }
];
const UNKNOWN_KEYS = ['zz', 'Name', '', 'constructor', '__proto__', 'toString', 'reviewedAt', 'recipe', 'notes', 'inset', 'latin', 'colors', 'x-y', 'a'.repeat(65)];
const SUFFIXES = [' ', 'A', '-', '0', '<', EMOJI, '‮', '\ud800', 'x'.repeat(70), '-x', '--'];

function allPaths(node, at = []) {
  const out = [at];
  if (node && typeof node === 'object') {
    for (const k of Object.keys(node)) out.push(...allPaths(node[k], at.concat(Array.isArray(node) ? Number(k) : k)));
  }
  return out;
}

const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const clone = (v) => (v === undefined ? v : structuredClone(v));

function setAt(doc, p, value) {
  if (p.length === 0) return value;
  const parent = getAt(doc, p.slice(0, -1));
  const k = p[p.length - 1];
  if (k === '__proto__' && !Array.isArray(parent)) addOwnKey(parent, k, value);
  else parent[k] = value;
  return doc;
}

function mutate(r, doc) {
  const paths = allPaths(doc);
  const p = pick(r, paths);
  const cur = getAt(doc, p);
  const op = Math.floor(r() * 9);
  if (op === 0 && p.length > 0) {
    const parent = getAt(doc, p.slice(0, -1));
    if (Array.isArray(parent)) parent.splice(p[p.length - 1], 1);
    else delete parent[p[p.length - 1]];
    return doc;
  }
  if (op === 1) return setAt(doc, p, clone(pick(r, POOL)));
  if (op === 2 && cur && typeof cur === 'object' && !Array.isArray(cur)) {
    addOwnKey(cur, pick(r, UNKNOWN_KEYS), clone(r() < 0.5 ? pick(r, POOL) : getAt(doc, pick(r, paths))));
    return doc;
  }
  if (op === 3 && Array.isArray(cur) && cur.length) {
    cur.push(clone(pick(r, cur)));
    return doc;
  }
  if (op === 4) return setAt(doc, p, clone(getAt(doc, pick(r, paths)))); // a value from elsewhere in the document
  if (op === 5 && typeof cur === 'string') return setAt(doc, p, r() < 0.5 ? cur + pick(r, SUFFIXES) : pick(r, SUFFIXES) + cur);
  if (op === 6 && typeof cur === 'number') return setAt(doc, p, pick(r, [cur + 1, cur - 1, cur * 10, cur + 0.5, -cur, 0, cur / 3]));
  if (op === 7 && Array.isArray(cur)) return setAt(doc, p, r() < 0.5 ? [] : cur.slice(0, 1));
  if (op === 8 && cur && typeof cur === 'object' && !Array.isArray(cur)) {
    // rename a key (often to a known key of another object)
    const keys = Object.keys(cur);
    if (keys.length) {
      const k = pick(r, keys);
      const v = cur[k];
      delete cur[k];
      addOwnKey(cur, pick(r, UNKNOWN_KEYS.concat(keys)), v);
    }
    return doc;
  }
  return setAt(doc, p, clone(pick(r, POOL)));
}

module.exports = { rng, mutate, getAt, addOwnKey, allPaths, EMOJI };
