'use strict';

/*
 * Matching (task 2.17, R-025/R-033): cases with known results, the session's tags, settings left out, and the
 * same order for the same input.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const match = require('../picker/js/core/match.js');
const build = require('../tools/build.js');

const data = build.select(build.load(path.join(__dirname, '..', 'library'))).data;
const find = (element, id) => (data.templates[element] || []).find((t) => t.id === id) || null;
const first = require('./helpers/first-library.js').firstLibrary(data);
const findFirst = (element, id) => (first.templates[element] || []).find((t) => t.id === id) || null;
const selectionsOf = (id) => {
  const ready = data.identities.find((i) => i.id === id);
  const out = {};
  for (const [element, template] of Object.entries(ready.templates)) out[element] = { template };
  return out;
};

// A tiny library with hand-computable numbers.
const T = (id, tags, metrics, kind = 'composite') => ({ id, kind, tags, metrics });
const tiny = {
  a: [T('a1', ['soft', 'playful'], { roundness: 0.8, density: 0.5, intensity: 0.4 })],
  b: [T('b1', ['soft'], { roundness: 0.6, density: 0.5, intensity: 0.6 })],
  s: [T('s1', ['minimal'], { roundness: 0, density: 0, intensity: 0 }, 'setting')]
};
const tinyFind = (e, id) => (tiny[e] || []).find((t) => t.id === id) || null;
const tinySel = { a: { template: 'a1' }, b: { template: 'b1' }, s: { template: 's1' } };

test('profile: tags and mean values of the other elements; settings and zero values left out', () => {
  const p = match.profile('x', tinySel, tinyFind);
  assert.deepEqual(p.tags, { soft: 2, playful: 1 }); // minimal (a setting) does not vote
  assert.deepEqual(p.session, []);
  assert.deepEqual(p.metrics, { roundness: 0.7, density: 0.5, intensity: 0.5 });
  // The element being scored does not vote for itself.
  assert.deepEqual(match.profile('a', tinySel, tinyFind).tags, { soft: 1 });
  // Templates that cannot be found are skipped.
  assert.deepEqual(match.profile('x', { a: { template: 'missing' } }, tinyFind), {
    tags: {},
    session: [],
    metrics: { roundness: null, density: null, intensity: null }
  });
});

test('score: 0.6 × tags + 0.4 × values, computed by hand', () => {
  const p = match.profile('x', tinySel, tinyFind); // soft 2, playful 1; values 0.7 / 0.5 / 0.5
  // tags: (2 + 1) / (2 × 2) = 0.75; values: 1 − (0.1 + 0 + 0.1) / 3 = 0.933333; 0.6×0.75 + 0.4×0.933333
  assert.equal(match.score(T('x', ['soft', 'playful'], { roundness: 0.8, density: 0.5, intensity: 0.4 }), p), 0.823333);
  // No shared tag; values identical to the profile: 0.4.
  assert.equal(match.score(T('y', ['brutalist'], { roundness: 0.7, density: 0.5, intensity: 0.5 }), p), 0.4);
  // No value to compare (all "not applicable"): tags only, (2) / (1 × 2) = 1.
  assert.equal(match.score(T('z', ['soft'], { roundness: 0, density: 0, intensity: 0 }), p), 1);
  // Nothing in common at all: 0.
  assert.equal(match.score(T('w', ['luxury'], { roundness: 0, density: 0, intensity: 0 }), p), 0);
});

test('the session tags weigh as much as all current choices together (R-033); no session works too', () => {
  const p = match.profile('x', tinySel, tinyFind, { tags: ['luxury', 'luxury'] });
  assert.deepEqual(p.tags, { soft: 2, playful: 1 });
  assert.deepEqual(p.session, ['luxury']);
  const list = [
    T('lux', ['luxury'], { roundness: 0.7, density: 0.5, intensity: 0.5 }),
    T('soft', ['soft'], { roundness: 0.7, density: 0.5, intensity: 0.5 })
  ];
  // lux: tags (0 + 1) / 2 = 0.5; soft: tags (1 + 0) / 2 = 0.5; values 1 for both → 0.7 each; id order decides.
  assert.deepEqual(match.rank(list, p), [
    { id: 'lux', score: 0.7 },
    { id: 'soft', score: 0.7 }
  ]);
  // Without the session: soft 1, lux 0.4.
  assert.deepEqual(match.rank(list, match.profile('x', tinySel, tinyFind)), [
    { id: 'soft', score: 1 },
    { id: 'lux', score: 0.4 }
  ]);
  assert.deepEqual(match.profile('x', tinySel, tinyFind, null), match.profile('x', tinySel, tinyFind));
  assert.deepEqual(match.profile('x', tinySel, tinyFind, { tags: 'oops' }), match.profile('x', tinySel, tinyFind));
});

test('ready identities: the marked template is the expected one for each element', () => {
  const calm = selectionsOf('calm-corporate');
  const warm = selectionsOf('warm-friendly');
  // On the first library, where the expected marks were computed (task 3.14).
  const bestOf = (sel, e) => match.best(e, first.templates[e], sel, findFirst);
  assert.deepEqual(
    Object.fromEntries(
      Object.keys(first.templates)
        .sort()
        .map((e) => [e, bestOf(calm, e)])
    ),
    {
      buttons: 'button-solid',
      cards: 'card-bordered',
      colors: 'palette-blue',
      direction: null,
      fonts: 'pair-plex-arabic-plex-sans',
      icons: 'icons-lucide-outline',
      modes: null,
      radius: 'radius-medium',
      shadows: 'shadow-soft',
      spacing: 'spacing-comfortable',
      'type-scale': 'scale-major-third'
    }
  );
  assert.equal(bestOf(warm, 'buttons'), 'button-soft');
  assert.equal(bestOf(warm, 'radius'), 'radius-round');
  assert.equal(bestOf(warm, 'icons'), 'icons-phosphor-regular');
  // A session asking for a playful identity moves the calm identity's button suggestion.
  assert.equal(match.best('buttons', data.templates.buttons, calm, find, { tags: ['playful', 'soft'] }), 'button-soft');
});

test('best: skips templates the rules do not allow, and marks nothing when nothing fits', () => {
  const calm = selectionsOf('calm-corporate');
  assert.equal(
    match.best('buttons', data.templates.buttons, calm, find, null, (t) => t.id !== 'button-solid'),
    match.rank(data.templates.buttons, match.profile('buttons', calm, find)).find((r) => r.id !== 'button-solid').id
  );
  assert.equal(
    match.best('buttons', data.templates.buttons, calm, find, null, () => false),
    null
  );
  assert.equal(
    match.best('x', [T('w', ['luxury'], { roundness: 0, density: 0, intensity: 0 })], tinySel, tinyFind),
    null
  );
  assert.equal(match.best('x', [], tinySel, tinyFind), null);
});

test('same input, same order: key order and repeated runs do not change the ranking', () => {
  const calm = selectionsOf('calm-corporate');
  const reversed = Object.fromEntries(Object.entries(calm).reverse());
  for (const e of Object.keys(data.templates)) {
    const a = match.rank(data.templates[e], match.profile(e, calm, find));
    const b = match.rank([...data.templates[e]].reverse(), match.profile(e, reversed, find));
    assert.deepEqual(a, b, e);
    for (const r of a) assert.ok(r.score >= 0 && r.score <= 1, `${e} ${r.id} ${r.score}`);
  }
});

test('loads as a plain browser script', () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const sandbox = { self: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'picker', 'js', 'core', 'match.js'), 'utf8'), sandbox);
  assert.equal(typeof sandbox.self.Hawiya.match.best, 'function');
});
