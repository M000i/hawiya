// Ranking the ready identities for a project (picker/js/core/fit.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const fit = require('../picker/js/core/fit.js');

const LIB = path.join(__dirname, '..', 'library');
const identities = fs
  .readdirSync(path.join(LIB, 'identities'))
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => JSON.parse(fs.readFileSync(path.join(LIB, 'identities', f), 'utf8')));
const colors = JSON.parse(fs.readFileSync(path.join(LIB, 'elements', 'colors.json'), 'utf8'));
const palette = {};
(Array.isArray(colors) ? colors : colors.templates).forEach((t) => (palette[t.id] = t));
const primaryOf = (i) => {
  const t = palette[i.templates.colors];
  return t ? t.tokens.color.primary.$value.hex.toLowerCase() : null;
};
const ids = (r) => r.map((x) => x.id);

test('without a session the library order stays and nothing scores', () => {
  const r = fit.rank(identities, null, primaryOf);
  assert.deepEqual(ids(r), ids(identities));
  assert.ok(r.every((x) => x.score === 0 && x.reasons.length === 0));
});

test('points: sector 4 then 3 (+1 for the same main sector), 2 per shared tag, 1 for the type; reasons in that weight order', () => {
  const a = { id: 'a', tags: ['corporate', 'data-dense'], sectors: ['finance', 'professional'], types: ['dashboard'] };
  const b = { id: 'b', tags: ['soft'], sectors: ['health'], types: ['website'] };
  const s = { type: 'dashboard', language: 'ar', tags: ['data-dense', 'soft'], sectors: ['finance', 'professional'] };
  const r = fit.rank([b, a], s, () => null);
  assert.deepEqual(ids(r), ['a', 'b']);
  assert.equal(r[0].score, 4 + 3 + 1 + 2 + 1);
  assert.deepEqual(r[0].reasons, [
    { kind: 'sector', values: ['finance', 'professional'] },
    { kind: 'tags', values: ['data-dense'] },
    { kind: 'type', values: ['dashboard'] }
  ]);
  assert.equal(r[1].score, 2);
});

test('equal scores keep the library order, and the same input gives the same order', () => {
  const list = ['x', 'y', 'z'].map((id) => ({ id, tags: ['minimal'], sectors: ['media'], types: ['website'] }));
  const s = { type: 'website', language: 'en', tags: ['minimal'] };
  assert.deepEqual(ids(fit.rank(list, s, () => null)), ['x', 'y', 'z']);
  assert.deepEqual(
    fit.rank(list, s, () => null),
    fit.rank(list, s, () => null)
  );
});

test('brand color: near hue 2 points, close 1, far or gray 0', () => {
  const one = [{ id: 'blue', tags: ['minimal'] }];
  const at = (brand, primary) =>
    fit.rank(one, { type: 'website', language: 'en', tags: ['vivid'], brandColors: [brand] }, () => primary)[0];
  assert.equal(at('#2563eb', '#1d4ed8').score, 2); // two blues
  assert.deepEqual(at('#2563eb', '#1d4ed8').reasons, [{ kind: 'brand', values: [] }]);
  assert.equal(at('#2563eb', '#dc2626').score, 0); // blue against red
  assert.equal(at('#6b7280', '#1d4ed8').score, 0); // a gray brand says nothing
  assert.equal(fit.hueGap('#2563eb', 'not a color'), null);
});

test('every library identity lists the sectors and project types it suits', () => {
  const schema = require('../picker/js/core/schemas.js').session;
  const sectors = schema.$defs.sector.enum;
  const types = schema.properties.type.enum;
  for (const i of identities) {
    assert.ok(Array.isArray(i.sectors) && i.sectors.length > 0, `${i.id}: no sectors`);
    assert.ok(Array.isArray(i.types) && i.types.length > 0, `${i.id}: no types`);
    i.sectors.forEach((s) => assert.ok(sectors.includes(s), `${i.id}: unknown sector ${s}`));
    i.types.forEach((t) => assert.ok(types.includes(t), `${i.id}: unknown type ${t}`));
  }
  // Every sector is listed by at least one identity, so no project is left without a fit.
  sectors.forEach((s) =>
    assert.ok(
      identities.some((i) => i.sectors.includes(s)),
      `no identity for ${s}`
    )
  );
});

test('typical projects get the identity a person would pick first', () => {
  const cases = [
    [{ type: 'dashboard', language: 'ar', tags: ['corporate', 'data-dense'], sectors: ['finance'] }, 'sober-finance'],
    [{ type: 'web-app', language: 'ar', tags: ['soft', 'minimal'], sectors: ['health'] }, 'clean-health'],
    [{ type: 'website', language: 'ar', tags: ['corporate', 'minimal'], sectors: ['government'] }, 'government'],
    [{ type: 'landing', language: 'ar+en', tags: ['playful', 'vivid'], sectors: ['kids'] }, 'playful-colorful'],
    [{ type: 'dashboard', language: 'en', tags: ['technical', 'data-dense'], sectors: ['technology'] }, 'dark-tech'],
    [{ type: 'landing', language: 'ar', tags: ['luxury'], sectors: ['fashion'] }, 'luxury'],
    [{ type: 'website', language: 'ar', tags: ['editorial'], sectors: ['media'] }, 'editorial'],
    [{ type: 'website', language: 'ar', tags: ['soft', 'retro'], sectors: ['nature', 'food'] }, 'earthy-natural']
  ];
  for (const [session, first] of cases) {
    const r = fit.rank(identities, session, primaryOf);
    assert.equal(r[0].id, first, `${session.sectors} ${session.type}: got ${ids(r).slice(0, 3)}`);
    assert.equal(r.length, identities.length, 'every identity is still shown');
  }
});
