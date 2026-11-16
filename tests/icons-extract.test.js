'use strict';
// Task 3.5 (R-047): the icon sample tool gives every confirmed library the same 14 meanings, and each library's
// license is the one read from its own repository or page (sources.json), never the Iconify label.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const icons = require('../tools/icons-extract.js');

const ROOT = path.join(__dirname, '..');
const read = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, 'library', f), 'utf8'));

// The confirmed icon sources of the project file («مؤكد»): eleven, and four more under CC BY with the source named.
const CONFIRMED = [
  'lucide',
  'phosphor',
  'tabler',
  'material-symbols',
  'fluent',
  'hugeicons',
  'iconoir',
  'heroicons',
  'mingcute',
  'carbon',
  'bootstrap',
  'solar',
  'streamline',
  'iconamoon',
  'basil'
];
const ICONIFY = /iconify|icones\.js\.org/i;

test('the tool gives every confirmed library the same 12 to 16 meanings, as plain SVG shapes (task 3.5)', () => {
  assert.deepEqual(Object.keys(icons.LIBRARIES).sort(), [...CONFIRMED].sort());
  assert.ok(icons.MEANINGS.length >= 12 && icons.MEANINGS.length <= 16);
  for (const m of ['arrow', 'search', 'settings', 'check', 'clock', 'play']) assert.ok(icons.MEANINGS.includes(m), m);
  const all = icons.libraries();
  assert.deepEqual(
    all.map((l) => l.library),
    Object.keys(icons.LIBRARIES)
  );
  for (const l of all) {
    assert.deepEqual(l.meanings, icons.MEANINGS, l.library);
    assert.match(l.viewBox, /^0 0 \d+ \d+$/, l.library);
    // Fourteen different icons: no meaning drawn twice.
    assert.equal(new Set(l.list.map((x) => x.body)).size, l.list.length, `${l.library}: an icon is repeated`);
    for (const x of l.list) icons.check(x.body, `${l.library} ${x.meaning}`);
  }
  // From the command line too, writing nothing.
  const before = fs.readFileSync(path.join(ROOT, 'library/elements/icons.json'));
  const out = spawnSync(process.execPath, [path.join(ROOT, 'tools/icons-extract.js'), '--list'], { encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  assert.equal(out.stdout.trim().split('\n').length, CONFIRMED.length);
  for (const line of out.stdout.trim().split('\n')) assert.match(line, /: 14 icons \(arrow, chevron, undo, search/);
  assert.ok(before.equals(fs.readFileSync(path.join(ROOT, 'library/elements/icons.json'))));
});

test("each library's license is recorded from its own repository or page, with its text, never from Iconify", () => {
  const sources = new Map(read('sources.json').map((s) => [s.id, s]));
  const allowed = new Map(read('licenses.json').allowed.map((l) => [l.id, l]));
  for (const lib of CONFIRMED) {
    const s = sources.get(lib);
    assert.ok(s, `${lib}: no entry in sources.json`);
    for (const k of ['url', 'licenseFile']) assert.doesNotMatch(s[k], ICONIFY, `${lib} ${k}`);
    assert.match(s.licenseFile, /^https:\/\/(github\.com\/[^/]+\/[^/]+\/blob\/|www\.figma\.com\/community\/file\/)/);
    assert.match(s.licenseReadAt, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(allowed.get(s.license) && allowed.get(s.license).text.length > 10, `${lib}: ${s.license} text`);
    // CC BY asks for the source to be named: the notice says who and how.
    if (s.license === 'CC-BY-4.0') assert.match(s.note || '', /^Attribution \(CC BY 4\.0\): /, lib);
  }
  // The notices print each, with the full text of every license used.
  const notices = fs.readFileSync(path.join(ROOT, 'THIRD_PARTY_NOTICES.md'), 'utf8');
  for (const lib of CONFIRMED) assert.ok(notices.includes(`## ${sources.get(lib).name}\n`), lib);
  for (const id of ['MIT', 'ISC', 'Apache-2.0', 'CC-BY-4.0']) assert.ok(notices.includes(`(\`${id}\`)\n\n`), id);
  assert.match(notices, /TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION/);
  assert.match(notices, /Creative Commons Attribution 4\.0 International Public License/);
});

test('every icons template is from a confirmed library, and its samples are what the tool extracts now', () => {
  const sources = new Map(read('sources.json').map((s) => [s.id, s]));
  const templates = read('elements/icons.json');
  const libs = new Set(templates.map((t) => t.extras.library));
  for (const lib of CONFIRMED) assert.ok(libs.has(lib), `${lib}: no template to review it in`);
  for (const t of templates) {
    assert.ok(CONFIRMED.includes(t.extras.library), t.id);
    assert.equal(t.source.name, sources.get(t.extras.library).name, t.id);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hawiya-icons-'));
  try {
    const file = path.join(dir, 'icons.json');
    fs.copyFileSync(path.join(ROOT, 'library/elements/icons.json'), file);
    icons.extract(file);
    assert.ok(
      fs.readFileSync(file).equals(fs.readFileSync(path.join(ROOT, 'library/elements/icons.json'))),
      'icons.json is out of date: run node tools/icons-extract.js'
    );
    // A weight the library does not offer stops the tool.
    const list = JSON.parse(fs.readFileSync(file, 'utf8'));
    list.find((t) => t.extras.library === 'carbon').extras.weight = 'thin';
    fs.writeFileSync(file, JSON.stringify(list));
    assert.throws(() => icons.extract(file), /weight "thin" is not offered by carbon/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the tool stops on a flipped alias, an icon of another size, a missing icon or an unknown library', () => {
  const L = icons.LIBRARIES.lucide;
  const fake = () => ({
    width: 24,
    height: 24,
    icons: Object.fromEntries(L.names.map((n, i) => [n, { body: `<path d="M${i} 0"/>` }])),
    aliases: {}
  });
  assert.equal(icons.sample('lucide', 'regular', 'outline', 't', fake()).list.length, 14);
  let set = fake();
  delete set.icons.x;
  set.aliases.x = { parent: 'plus', rotate: 1 };
  assert.throws(() => icons.sample('lucide', 'regular', 'outline', 't', set), /alias that changes its icon \(rotate\)/);
  set = fake();
  set.icons.search.width = 20;
  assert.throws(
    () => icons.sample('lucide', 'regular', 'outline', 't', set),
    /search is 0 0 20 24, the others 0 0 24 24/
  );
  set = fake();
  delete set.icons.bell;
  assert.throws(() => icons.sample('lucide', 'regular', 'outline', 't', set), /bell is missing/);
  set = fake();
  set.icons.menu.body = '<path d="M0" onload="x()"/>';
  assert.throws(() => icons.sample('lucide', 'regular', 'outline', 't', set), /onload is not allowed/);
  for (const bad of ['__proto__', 'constructor', 'remixicon', undefined])
    assert.throws(() => icons.sample(bad, 'regular', 'outline', 't'), /no icon set for library/);
  // A fill the library lacks for one meaning is left out, not half-drawn.
  const P = icons.LIBRARIES.phosphor;
  const ph = {
    width: 256,
    height: 256,
    icons: Object.fromEntries(
      P.names.flatMap((n) => [n, `${n}-fill`]).map((n) => [n, { body: `<path d="M${n.length}"/>` }])
    )
  };
  delete ph.icons['clock-fill'];
  assert.equal(icons.sample('phosphor', 'regular', 'filled', 't', ph), null);
  assert.equal(icons.sample('phosphor', 'bold', 'filled', 't', ph), null);
});
