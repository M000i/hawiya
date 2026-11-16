'use strict';
// Task 2.5 (R-031): the browser storage layer. Nothing saved is lost; nothing read back is used unchecked.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const storage = require('../picker/js/ui/storage.js');
const validate = require('../picker/js/core/validate.js');
const resolve = require('../picker/js/core/resolve.js');
const build = require('../tools/build.js');

const DATA = build.select(build.load(path.join(__dirname, '..', 'library'))).data;
const KEYS = storage.KEYS;

class FakeStore {
  constructor(entries = {}) {
    this.map = new Map(Object.entries(entries));
    this.fail = null; // (op, key) => Error | null
  }
  getItem(k) {
    const e = this.fail && this.fail('get', k);
    if (e) throw e;
    return this.map.has(k) ? this.map.get(k) : null;
  }
  setItem(k, v) {
    const e = this.fail && this.fail('set', k);
    if (e) throw e;
    this.map.set(k, String(v));
  }
  removeItem(k) {
    this.map.delete(k);
  }
}
const quota = () => Object.assign(new Error('full'), { name: 'QuotaExceededError', code: 22 });
const security = () => Object.assign(new Error('denied'), { name: 'SecurityError', code: 18 });

function make(store, clock = { t: 1700000000000 }) {
  return storage.create(store, {
    check: (x) => validate.check('identity', x).valid,
    resolve: (c) => resolve.resolve(c, DATA),
    now: () => clock.t
  });
}
function choices(id = 'calm-corporate', name) {
  const ready = DATA.identities.find((i) => i.id === id);
  const selections = {};
  for (const e of resolve.ELEMENTS) selections[e] = { template: ready.templates[e] };
  return { name: name || ready.name.ar, selections };
}
const identity = (c) => resolve.resolve(c, DATA);
const savedRaw = (store) => JSON.parse(store.map.get(KEYS.saved));
const backups = (store, key) => [...store.map.keys()].filter((k) => k.startsWith(key + '.unreadable-'));

test('the draft round trip gives back the same choices, and the same identity when rebuilt', () => {
  const store = new FakeStore();
  const s = make(store);
  assert.deepEqual(s.readDraft(), { status: 'none' });
  const c = choices();
  c.selections.colors.overrides = { primary: '#0f766e' };
  c.project = { type: 'dashboard', contrast: 'AAA' };
  c.motion = 'none';
  c.leaveToAI = ['illustrations'];
  const id = identity(c);
  assert.deepEqual(s.writeDraft(id), { ok: true });
  const back = s.readDraft();
  assert.equal(back.status, 'ok');
  assert.deepEqual(identity(back.choices), id);
});

test('stored values are never used directly: the identity is rebuilt from its choices', () => {
  const store = new FakeStore();
  const s = make(store);
  const id = identity(choices());
  const tampered = JSON.parse(JSON.stringify(id));
  tampered.tokens.color.light.primary = '#000000'; // still a valid identity, but not what the choices give
  store.setItem(KEYS.draft, JSON.stringify({ format: 1, savedAt: 1, identity: tampered }));
  const back = s.readDraft();
  assert.equal(back.status, 'ok');
  assert.equal(identity(back.choices).tokens.color.light.primary, '#2563eb');
});

test('an unreadable draft is kept aside before it is replaced', () => {
  const cases = {
    'not JSON': '{bad',
    'not the draft format': JSON.stringify({ identity: identity(choices()) }),
    'fails the identity check': JSON.stringify({ format: 1, identity: { ...identity(choices()), name: '<x>' } }),
    'template left the library': JSON.stringify({
      format: 1,
      identity: {
        ...identity(choices()),
        selections: { ...identity(choices()).selections, radius: { template: 'radius-gone' } }
      }
    }),
    '__proto__ inside': JSON.stringify({ format: 1, identity: identity(choices()) }).replace(
      '"selections":{',
      '"selections":{"__proto__":{"template":"x"},'
    )
  };
  for (const [label, raw] of Object.entries(cases)) {
    const store = new FakeStore({ [KEYS.draft]: raw });
    const s = make(store);
    assert.equal(s.readDraft().status, 'unreadable', label);
    assert.deepEqual(s.writeDraft(identity(choices())), { ok: true }, label);
    const kept = backups(store, KEYS.draft);
    assert.equal(kept.length, 1, label);
    assert.equal(store.map.get(kept[0]), raw, `${label}: kept byte for byte`);
    assert.equal(s.readDraft().status, 'ok', label);
    // Once the draft is readable again, later writes keep no more copies.
    s.writeDraft(identity(choices()));
    assert.equal(backups(store, KEYS.draft).length, 1, label);
  }
  assert.equal({}.template, undefined, 'no prototype pollution');
});

test('save, list, open, update, and save as a new copy', () => {
  const store = new FakeStore();
  const clock = { t: 1000 };
  const s = make(store, clock);
  assert.deepEqual(s.list(), []);
  const a = choices('calm-corporate', 'مشروعي');
  const r1 = s.save(identity(a));
  assert.deepEqual(r1, { ok: true, id: (1000).toString(36), created: true, updatedAt: 1000 });
  assert.deepEqual(s.list(), [{ id: r1.id, name: 'مشروعي', updatedAt: 1000, schemaVersion: 1, status: 'ok' }]);
  const opened = s.open(r1.id);
  assert.equal(opened.ok, true);
  assert.deepEqual(identity(opened.choices), identity(a));

  clock.t = 2000;
  const b = { ...a, selections: { ...a.selections, radius: { template: 'radius-round' } } };
  assert.equal(opened.updatedAt, 1000);
  const r2 = s.save(identity(b), r1.id, opened.updatedAt); // the version this page opened (task 3.0b)
  assert.deepEqual(r2, { ok: true, id: r1.id, created: false, updatedAt: 2000 });
  assert.equal(s.list().length, 1);
  assert.equal(s.list()[0].updatedAt, 2000);
  assert.equal(s.open(r1.id).choices.selections.radius.template, 'radius-round');

  const r3 = s.save(identity(b), null);
  assert.equal(r3.created, true);
  assert.notEqual(r3.id, r1.id, 'same clock tick still gives a new id');
  assert.equal(s.list().length, 2);
  assert.deepEqual(s.open('nope'), { ok: false, reason: 'gone' });
});

test('entries in another format version or damaged stay exactly as they were and cannot be opened', () => {
  const good = identity(choices());
  const older = { id: 'old1', name: 'قديمة', updatedAt: 5, identity: { ...good, schemaVersion: 0, legacyField: true } };
  const newer = { id: 'new1', name: 'Newer', updatedAt: 6, identity: { schemaVersion: 2, whatever: [1, 2] } };
  const damaged = [
    { id: 'bad1', name: '<img src=x onerror=alert(1)>', updatedAt: 7, identity: { ...good, name: '' } },
    { id: 'BAD ID', name: 'x', identity: good },
    'just text',
    null,
    {
      id: 'bad2',
      name: 'missing',
      identity: { ...good, selections: { ...good.selections, cards: { template: 'card-gone' } } }
    }
  ];
  const items = [older, newer, ...damaged];
  const raw = JSON.stringify({ format: 1, items });
  const store = new FakeStore({ [KEYS.saved]: raw });
  const s = make(store);
  const listed = s.list();
  assert.deepEqual(
    listed.map((x) => [x.id, x.status]),
    [
      ['old1', 'older'],
      ['new1', 'newer'],
      ['bad1', 'damaged'],
      [null, 'damaged'],
      [null, 'damaged'],
      [null, 'damaged'],
      ['bad2', 'ok']
    ]
  );
  assert.equal(listed[0].schemaVersion, 0);
  assert.deepEqual(s.open('old1'), { ok: false, reason: 'older' });
  assert.deepEqual(s.open('new1'), { ok: false, reason: 'newer' });
  assert.deepEqual(s.open('bad1'), { ok: false, reason: 'damaged' });
  // A current entry whose templates left the library is listed, but explains why it cannot open.
  assert.deepEqual(s.open('bad2'), { ok: false, reason: 'missing' });

  // Saving, even "updating" the older entry's id, never touches them.
  const r = s.save(good, 'old1');
  assert.equal(r.created, true);
  const after = savedRaw(store).items;
  assert.equal(after.length, items.length + 1);
  assert.deepEqual(after.slice(0, items.length), items, 'every earlier entry kept byte for byte, in order');
  s.save(good, 'bad1');
  assert.deepEqual(savedRaw(store).items.slice(0, items.length), items);
});

test('a saved list that cannot be read is kept aside before anything new is written', () => {
  for (const raw of ['[[[', JSON.stringify({ format: 2, items: [] }), JSON.stringify([1, 2]), '"text"']) {
    const store = new FakeStore({ [KEYS.saved]: raw });
    const s = make(store);
    assert.deepEqual(s.list(), []);
    assert.equal(store.map.get(KEYS.saved), raw, 'reading changes nothing');
    assert.equal(s.save(identity(choices())).ok, true);
    const kept = backups(store, KEYS.saved);
    assert.equal(kept.length, 1);
    assert.equal(store.map.get(kept[0]), raw);
    assert.equal(s.list().length, 1);
  }
  // If the copy cannot be made, nothing is replaced.
  const store = new FakeStore({ [KEYS.saved]: '[[[' });
  store.fail = (op, k) => (op === 'set' && k.includes('.unreadable-') ? quota() : null);
  const s = make(store);
  assert.deepEqual(s.save(identity(choices())), { ok: false, reason: 'full' });
  assert.equal(store.map.get(KEYS.saved), '[[[');
  // Two copies made in the same millisecond do not overwrite each other.
  const twice = new FakeStore({ [KEYS.draft]: 'one' });
  const t2 = make(twice, { t: 9 });
  t2.writeDraft(identity(choices()));
  twice.map.set(KEYS.draft, 'two');
  t2.writeDraft(identity(choices()));
  assert.deepEqual(
    backups(twice, KEYS.draft)
      .map((k) => twice.map.get(k))
      .sort(),
    ['one', 'two']
  );
});

test('full storage: the change is refused, and what was saved stays', () => {
  const store = new FakeStore();
  const s = make(store);
  s.writeDraft(identity(choices()));
  s.save(identity(choices()));
  const before = new Map(store.map);
  store.fail = (op) => (op === 'set' ? quota() : null);
  assert.deepEqual(s.writeDraft(identity(choices('warm-friendly'))), { ok: false, reason: 'full' });
  assert.deepEqual(s.save(identity(choices('warm-friendly'))), { ok: false, reason: 'full' });
  assert.equal(s.available(), false);
  assert.deepEqual(store.map, before);
  assert.equal(s.readDraft().status, 'ok');
});

test('no storage, or storage that throws on every call: nothing breaks', () => {
  for (const store of [null, Object.assign(new FakeStore(), { fail: () => security() })]) {
    const s = make(store);
    assert.equal(s.available(), false);
    assert.deepEqual(s.readDraft(), { status: 'none' });
    assert.deepEqual(s.writeDraft(identity(choices())), { ok: false, reason: 'unavailable' });
    assert.deepEqual(s.list(), []);
    assert.deepEqual(s.save(identity(choices())), { ok: false, reason: 'unavailable' });
    assert.deepEqual(s.open('x'), { ok: false, reason: 'gone' });
  }
});

test('choicesOf copies, so editing the choices never changes the identity they came from', () => {
  const c = choices();
  c.selections.colors.overrides = { primary: '#111111' };
  const id = identity(c);
  const back = storage.choicesOf(id);
  back.selections.colors.overrides.primary = '#222222';
  back.leaveToAI.push('x');
  assert.equal(id.selections.colors.overrides.primary, '#111111');
  assert.deepEqual(id.leaveToAI, []);
});

test('review fixes: failed reads never lead to overwrites; checked names; opened entry; unreadable list', () => {
  // A read that fails is not "nothing stored".
  const store = new FakeStore();
  const s = make(store);
  s.save(identity(choices('calm-corporate', 'one')));
  s.writeDraft(identity(choices()));
  const before = new Map(store.map);
  store.fail = (op) => (op === 'get' ? security() : null);
  assert.deepEqual(s.save(identity(choices('calm-corporate', 'two'))), { ok: false, reason: 'unavailable' });
  assert.deepEqual(s.writeDraft(identity(choices('warm-friendly'))), { ok: false, reason: 'unavailable' });
  assert.deepEqual(store.map, before);
  assert.equal(s.listUnreadable(), false, 'a failed read is not an unreadable list');
  store.fail = null;

  // The list shows the checked identity's name; a label beside it cannot change what is shown.
  const good = identity(choices('calm-corporate', 'Real'));
  const raw = JSON.stringify({
    format: 1,
    items: [
      { id: 'a1', name: 'Fake', identity: good },
      { id: 'b2', name: 'Bad‮eman‬' + 'x'.repeat(200), identity: { schemaVersion: 0 } }
    ]
  });
  const s2 = make(new FakeStore({ [KEYS.saved]: raw }));
  const listed = s2.list();
  assert.equal(listed[0].name, 'Real');
  assert.equal(listed[1].name, 'Bademan' + 'x'.repeat(73));

  // The draft remembers which saved entry it was opened from (a valid id only).
  const s3store = new FakeStore();
  const s3 = make(s3store);
  s3.writeDraft(identity(choices()), 'abc123');
  assert.equal(s3.readDraft().openedId, 'abc123');
  s3.writeDraft(identity(choices()), '<bad id>');
  assert.equal('openedId' in s3.readDraft(), false);

  // An unreadable list is reported until it has been kept aside.
  const s4store = new FakeStore({ [KEYS.saved]: JSON.stringify({ format: 2, items: [{ id: 'x' }] }) });
  const s4 = make(s4store);
  assert.equal(s4.listUnreadable(), true);
  s4.save(identity(choices()));
  assert.equal(s4.listUnreadable(), false);
});

/* ---------- task 3.0b (CHG-1, R-101): a draft per project from the save server; saved identities shared ---------- */

function makeFor(store, project) {
  return storage.create(store, {
    check: (x) => validate.check('identity', x).valid,
    resolve: (c) => resolve.resolve(c, DATA),
    now: () => 1700000000000,
    project
  });
}
const A = '0123456789abcdef';
const B = 'fedcba9876543210';

test('3.0b: each project keeps its own draft; the saved identities are one list for all', () => {
  const store = new FakeStore();
  const a = makeFor(store, A);
  const b = makeFor(store, B);
  assert.equal(a.writeDraft(identity(choices('warm-friendly'))).ok, true);
  assert.equal(b.readDraft().status, 'none', 'project B does not see project A’s draft');
  assert.equal(a.readDraft().choices.selections.buttons.template, 'button-soft');
  assert.deepEqual(a.draftSelections().buttons, { template: 'button-soft' });
  assert.deepEqual(b.draftSelections(), {});
  assert.ok(store.map.has(KEYS.draft + '.' + A));
  assert.equal(store.map.has(KEYS.draft), false, 'the general draft is not written');
  // Saved in project A, listed in project B.
  const saved = a.save(identity(choices('warm-friendly', 'Shared')));
  assert.equal(saved.ok, true);
  assert.deepEqual(
    b.list().map((i) => i.name),
    ['Shared']
  );
  assert.equal(b.open(saved.id).ok, true);
});

test('3.0b: the old general draft is never read, replaced or deleted from a project page', () => {
  const store = new FakeStore();
  const general = make(store);
  general.writeDraft(identity(choices('warm-friendly')));
  const before = store.map.get(KEYS.draft);
  const a = makeFor(store, A);
  assert.equal(a.readDraft().status, 'none', 'another project’s (or the file page’s) draft is not opened here');
  a.writeDraft(identity(choices()));
  assert.equal(store.map.get(KEYS.draft), before);
  assert.equal(general.readDraft().choices.selections.buttons.template, 'button-soft');
});

test('3.0b: an unreadable project draft is kept aside under its own name; other drafts are untouched', () => {
  const store = new FakeStore({ [KEYS.draft + '.' + A]: '{not json', [KEYS.draft + '.' + B]: 'b' });
  const a = makeFor(store, A);
  assert.equal(a.readDraft().status, 'unreadable');
  assert.equal(a.writeDraft(identity(choices())).ok, true);
  const kept = [...store.map.keys()].filter((k) => k.startsWith(KEYS.draft + '.' + A + '.unreadable-'));
  assert.equal(kept.length, 1);
  assert.equal(store.map.get(kept[0]), '{not json');
  assert.equal(store.map.get(KEYS.draft + '.' + B), 'b');
});

test('3.0b: a project id that is not 16 lowercase hex digits is not used as a key', () => {
  for (const bad of ['', 'ABCDEF0123456789', '0123', '../hawiya.saved', 'saved', null, 7]) {
    const store = new FakeStore();
    makeFor(store, bad).writeDraft(identity(choices()));
    assert.deepEqual([...store.map.keys()], [KEYS.draft], String(bad));
  }
});

test('3.0b review: an entry changed since this page opened it is never replaced; the new version is a copy', () => {
  const store = new FakeStore();
  const clock = { t: 1700000000000 };
  const mk = (project) =>
    storage.create(store, {
      check: (x) => validate.check('identity', x).valid,
      resolve: (c) => resolve.resolve(c, DATA),
      now: () => clock.t,
      project
    });
  const a = mk(A);
  const b = mk(B);
  // Project A saves "Brand" and its draft remembers it.
  const first = a.save(identity(choices('calm-corporate', 'Brand')));
  a.writeDraft(identity(choices('calm-corporate', 'Brand')), first.id, first.updatedAt);
  // Later, project B opens it, changes it and saves over it (it knows the right version).
  clock.t += 1000;
  const opened = b.open(first.id);
  assert.equal(opened.updatedAt, first.updatedAt);
  const fromB = b.save(identity(choices('warm-friendly', 'Brand')), first.id, opened.updatedAt);
  assert.deepEqual([fromB.created, fromB.conflict], [false, undefined]);
  // Back in project A: its draft still points at the old version; Save keeps B's and adds a copy.
  clock.t += 1000;
  const d = a.readDraft();
  assert.deepEqual([d.openedId, d.openedAt], [first.id, first.updatedAt]);
  const fromA = a.save(identity(choices('calm-corporate', 'Brand')), d.openedId, d.openedAt);
  assert.deepEqual([fromA.ok, fromA.created, fromA.conflict], [true, true, true]);
  assert.notEqual(fromA.id, first.id);
  const items = savedRaw(store).items;
  assert.equal(items.length, 2);
  assert.equal(items.find((i) => i.id === first.id).identity.selections.buttons.template, 'button-soft');
  // With the right version, Save updates in place, again and again.
  const again = a.save(identity(choices('calm-corporate', 'Brand 2')), fromA.id, fromA.updatedAt);
  assert.deepEqual([again.id, again.created, again.conflict], [fromA.id, false, undefined]);
  // An older draft that never recorded the version (before this change) gets a copy too.
  const legacy = a.save(identity(choices('calm-corporate', 'Brand 3')), fromA.id);
  assert.deepEqual([legacy.created, legacy.conflict], [true, true]);
});

test('3.0b review: from the save server without a valid project id, a draft of its own, never the general one', () => {
  const store = new FakeStore();
  makeFor(store, 'unknown').writeDraft(identity(choices()));
  assert.deepEqual([...store.map.keys()], [KEYS.draft + '.unknown']);
});
