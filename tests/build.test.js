'use strict';

// Task 2.1 (R-061): library -> picker/data, reviewed templates only.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const builder = require('../tools/build.js');
const { launch } = require('./helpers/chrome.js');

const ROOT = path.join(__dirname, '..');
const FIXTURE = path.join(__dirname, 'fixtures', 'library');
const TOOL = path.join(ROOT, 'tools', 'build.js');
const LS = String.fromCharCode(0x2028);

const tmpDirs = [];
function tmp(prefix = 'hawiya-build-') {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(d);
  return d;
}
test.after(() => tmpDirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

function copyFixture() {
  const d = tmp('hawiya-lib-');
  fs.cpSync(FIXTURE, d, { recursive: true });
  return d;
}
const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const writeJson = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2) + '\n');
const sourceTemplates = (lib, el) => readJson(path.join(lib, 'elements', `${el}.json`));

// Run the generated scripts the way a browser does (plain scripts, shared global), return window.Hawiya.data.
function loadData(outDir) {
  const ctx = vm.createContext({});
  ctx.self = ctx;
  for (const f of fs.readdirSync(outDir).sort()) vm.runInContext(fs.readFileSync(path.join(outDir, f), 'utf8'), ctx, { filename: f });
  return ctx.Hawiya.data;
}
const plain = (x) => JSON.parse(JSON.stringify(x));

test('drafts never reach the output; reviewed templates arrive unchanged', () => {
  const out = tmp();
  const { summary } = builder.build({ libraryDir: FIXTURE, outDir: out });
  const data = loadData(out);
  for (const el of builder.ELEMENTS) {
    const file = path.join(FIXTURE, 'elements', `${el}.json`);
    const expected = fs.existsSync(file) ? readJson(file).filter((t) => t.status.state === 'reviewed') : [];
    assert.deepEqual(plain(data.templates[el]), expected, el);
    for (const t of data.templates[el]) assert.equal(t.status.state, 'reviewed');
  }
  assert.deepEqual(plain(data.templates.radius.map((t) => t.id)), ['radius-soft']);
  assert.deepEqual(plain(data.templates.buttons.map((t) => t.id)), ['button-solid']);
  // The draft ids and the word "draft" appear nowhere in the written bytes.
  for (const f of fs.readdirSync(out)) {
    const text = fs.readFileSync(path.join(out, f), 'utf8');
    for (const banned of ['radius-sharp', 'button-ghost', '"draft"', 'draft)']) assert.ok(!text.includes(banned), `${f} contains ${banned}`);
  }
  assert.deepEqual(summary.totals, { published: 11, drafts: 2 });
  assert.deepEqual(summary.elements.radius, { published: 1, drafts: 1, file: true });
  assert.deepEqual(summary.elements.buttons, { published: 1, drafts: 1, file: true });
});

test('one data file per element plus identities.js, starter.js and font-faces.js; an element with no file gives an empty list and is reported', () => {
  const lib = copyFixture();
  fs.rmSync(path.join(lib, 'elements', 'colors.json'));
  const out = tmp();
  const { summary } = builder.build({ libraryDir: lib, outDir: out });
  assert.deepEqual(summary.elements.colors, { published: 0, drafts: 0, file: false });
  assert.match(builder.report(summary, { libraryDir: lib, outDir: out }), /colors\s+published\s+0\s+drafts left out\s+0\s+\(no file\)/);
  const expectedFiles = [...builder.ELEMENTS.map((e) => `${e}.js`), 'identities.js', 'starter.js', 'font-faces.js'].sort();
  assert.deepEqual(fs.readdirSync(out).sort(), expectedFiles);
  assert.equal(builder.ELEMENTS.length, 11);
  const data = loadData(out);
  assert.deepEqual(plain(data.templates.colors), []);
  assert.deepEqual(Object.keys(data.templates).sort(), builder.ELEMENTS.slice().sort());
  assert.ok(Object.isFrozen(data.templates.radius) && Object.isFrozen(data.templates.radius[0].name), 'data is read-only');
});

test('starter.js holds exactly the templates the published identities use, per element, never a draft', () => {
  const out = tmp();
  builder.build({ libraryDir: FIXTURE, outDir: out });
  const data = loadData(out);
  const starter = plain(data.starter);
  assert.deepEqual(Object.keys(starter), builder.ELEMENTS);
  const calm = readJson(path.join(FIXTURE, 'identities', 'calm.json'));
  for (const e of builder.ELEMENTS) {
    assert.deepEqual(starter[e].map((t) => t.id), [calm.templates[e]], e);
    // The same objects as in the element's own file.
    assert.deepEqual(starter[e][0], plain(data.templates[e].find((t) => t.id === calm.templates[e])));
  }
  assert.ok(Object.isFrozen(data.starter) && Object.isFrozen(data.starter.radius[0].name), 'read-only');
  const text = fs.readFileSync(path.join(out, 'starter.js'), 'utf8');
  for (const banned of ['radius-sharp', 'button-ghost', '"draft"']) assert.ok(!text.includes(banned), banned);
  // An identity that is left out adds nothing; two identities sharing a template list it once, in file order.
  const lib = copyFixture();
  const radius = readJson(path.join(lib, 'elements', 'radius.json'));
  radius.push({ ...radius[0], id: 'radius-extra', status: { state: 'reviewed', reviewedAt: '2026-11-16' } });
  writeJson(path.join(lib, 'elements', 'radius.json'), radius);
  writeJson(path.join(lib, 'identities', 'second.json'), { ...calm, id: 'second', templates: { ...calm.templates, radius: 'radius-extra' } });
  writeJson(path.join(lib, 'identities', 'third.json'), { ...calm, id: 'third' });
  const out2 = tmp();
  builder.build({ libraryDir: lib, outDir: out2 });
  const s2 = plain(loadData(out2).starter);
  assert.deepEqual(s2.radius.map((t) => t.id), ['radius-soft', 'radius-extra']);
  assert.deepEqual(s2.colors.map((t) => t.id), [calm.templates.colors]);
  assert.ok(!JSON.stringify(s2).includes('radius-sharp'), 'uses-draft.json is left out, so its draft is not listed');
});

test('a ready identity is published only when every template it uses is published and of that element', () => {
  const out = tmp();
  const { summary } = builder.build({ libraryDir: FIXTURE, outDir: out });
  const data = loadData(out);
  assert.deepEqual(plain(data.identities.map((i) => i.id)), ['calm']);
  assert.deepEqual(plain(data.identities[0]), readJson(path.join(FIXTURE, 'identities', 'calm.json')));
  assert.deepEqual(
    summary.identities.excluded.map((x) => [x.file, x.reasons]),
    [
      ['missing.json', ['buttons: "button-nope" does not exist']],
      ['uses-draft.json', ['radius: "radius-sharp" is a draft']]
    ]
  );
  // A reviewed template of another element is not accepted either.
  const lib = copyFixture();
  const calm = readJson(path.join(lib, 'identities', 'calm.json'));
  writeJson(path.join(lib, 'identities', 'wrong-element.json'), { ...calm, id: 'wrong-element', templates: { ...calm.templates, radius: 'button-solid' } });
  // A ready identity is complete: one template for every element.
  const partial = { ...calm.templates };
  delete partial.icons;
  delete partial.spacing;
  writeJson(path.join(lib, 'identities', 'partial.json'), { ...calm, id: 'partial', templates: partial });
  const r = builder.build({ libraryDir: lib, outDir: tmp() });
  assert.deepEqual(r.summary.identities.excluded.find((x) => x.id === 'wrong-element').reasons, ['radius: "button-solid" is a buttons template']);
  assert.deepEqual(r.summary.identities.excluded.find((x) => x.id === 'partial').reasons, ['icons: no template chosen', 'spacing: no template chosen']);
  assert.equal(r.summary.identities.published, 1);
});

test('same library, same bytes (build twice, in two places, at two times)', () => {
  const a = tmp();
  const b = tmp();
  builder.build({ libraryDir: FIXTURE, outDir: a });
  const r = spawnSync(process.execPath, [TOOL, '--library', FIXTURE, '--out', b], { env: { ...process.env, TZ: 'Pacific/Kiritimati' }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  for (const f of fs.readdirSync(a)) assert.equal(fs.readFileSync(path.join(a, f), 'utf8'), fs.readFileSync(path.join(b, f), 'utf8'), f);
  builder.build({ libraryDir: FIXTURE, outDir: a }); // again over the same folder
  for (const f of fs.readdirSync(a)) assert.equal(fs.readFileSync(path.join(a, f), 'utf8'), fs.readFileSync(path.join(b, f), 'utf8'), f);
  assert.deepEqual(fs.readdirSync(a).filter((f) => f.endsWith('.tmp')), []);
});

test('output is ASCII with "<" escaped, and text survives exactly (Arabic, emoji, </script>, U+2028, lone surrogate)', () => {
  const lib = copyFixture();
  const list = sourceTemplates(lib, 'buttons');
  const solid = list.find((t) => t.id === 'button-solid');
  solid.name.ar = 'زر </script><script>alert(1)</script> ' + LS + ' 😀 ' + String.fromCharCode(0xd800);
  solid.recipe.html = '<button class="hw-btn" type="button">{label}</button>'; // "<" in the data, escaped
  writeJson(path.join(lib, 'elements', 'buttons.json'), list);
  const out = tmp();
  builder.build({ libraryDir: lib, outDir: out });
  for (const f of fs.readdirSync(out)) {
    const text = fs.readFileSync(path.join(out, f), 'utf8');
    assert.ok(/^[\x09\x0a\x20-\x7e]*$/.test(text), `${f} is not plain ASCII`);
    const body = text.slice(text.indexOf('*/') + 2); // the header comment mentions no "<"; the data has none raw
    assert.ok(!body.includes('<'), `${f} has a raw "<"`);
  }
  const data = loadData(out);
  assert.equal(data.templates.buttons[0].name.ar, solid.name.ar);
  assert.equal(data.templates.buttons[0].recipe.html, solid.recipe.html);
});

function expectRefused(mutate, pattern) {
  const lib = copyFixture();
  mutate(lib);
  const out = path.join(tmp(), 'data');
  assert.throws(
    () => builder.build({ libraryDir: lib, outDir: out }),
    (e) => e instanceof builder.LibraryError && pattern.test([e.message, ...(e.problems || [])].join('\n'))
  );
  assert.equal(fs.existsSync(out), false, 'nothing may be written when the library has a problem');
}

test('a library with any problem is refused and nothing is written', () => {
  const el = (lib, name) => path.join(lib, 'elements', name);
  const cases = [
    ['template fails the schema', (lib) => writeJson(el(lib, 'radius.json'), [{ ...sourceTemplates(lib, 'radius')[0], name: { ar: '' } }]), /radius\.json \[0\]\/name/],
    ['"reviewed" without a review date', (lib) => writeJson(el(lib, 'radius.json'), [{ ...sourceTemplates(lib, 'radius')[0], status: { state: 'reviewed' } }]), /\[0\]\/status/],
    ['state spelled "Reviewed"', (lib) => writeJson(el(lib, 'radius.json'), [{ ...sourceTemplates(lib, 'radius')[1], status: { state: 'Reviewed', reviewedAt: '2026-11-15' } }]), /\[0\]\/status\/state/],
    ['a draft with a review date', (lib) => writeJson(el(lib, 'radius.json'), [{ ...sourceTemplates(lib, 'radius')[1], status: { state: 'draft', reviewedAt: '2026-11-15' } }]), /\[0\]\/status/],
    [
      'a draft and a reviewed template share an id',
      (lib) => {
        const r = sourceTemplates(lib, 'radius');
        r[1].id = 'radius-soft';
        writeJson(el(lib, 'radius.json'), r);
      },
      /id "radius-soft" is already used/
    ],
    [
      'the same id in two element files',
      (lib) => {
        const b = sourceTemplates(lib, 'buttons');
        b[0].id = 'radius-soft';
        writeJson(el(lib, 'buttons.json'), b);
      },
      /id "radius-soft" is already used in buttons\.json/
    ],
    ['a template in another element\'s file', (lib) => writeJson(el(lib, 'colors.json'), sourceTemplates(lib, 'radius')), /says element "radius" but is in colors\.json/],
    ['an unknown element file', (lib) => writeJson(el(lib, 'logos.json'), []), /"logos" is not an element/],
    ['a key written twice', (lib) => fs.writeFileSync(el(lib, 'fonts.json'), fs.readFileSync(el(lib, 'fonts.json'), 'utf8').replace('"kind"', '"status": {"state": "reviewed", "reviewedAt": "2026-11-15"}, "kind"')), /"status" appears twice/],
    ['not an array', (lib) => writeJson(el(lib, 'fonts.json'), sourceTemplates(lib, 'fonts')[0]), /expected a JSON array/],
    ['not JSON', (lib) => fs.writeFileSync(el(lib, 'fonts.json'), '[{]'), /not valid JSON/],
    ['a folder named like a file', (lib) => fs.mkdirSync(el(lib, 'extra.json')), /extra\.json: not a plain file/],
    ['a misnamed element file (upper case)', (lib) => fs.renameSync(el(lib, 'radius.json'), el(lib, 'radius.JSON')), /radius\.JSON: unexpected file/],
    ['a left-over backup file', (lib) => fs.copyFileSync(el(lib, 'fonts.json'), el(lib, 'fonts.json.bak')), /fonts\.json\.bak: unexpected file/],
    ['a stray file among identities', (lib) => fs.writeFileSync(path.join(lib, 'identities', 'notes.txt'), 'x'), /notes\.txt: unexpected file/],
    [
      'text that is not UTF-8 (Windows-1256 Arabic)',
      (lib) => {
        const text = fs.readFileSync(el(lib, 'fonts.json'), 'utf8');
        const i = text.indexOf('"ar": "') + 7;
        const j = text.indexOf('"', i);
        fs.writeFileSync(el(lib, 'fonts.json'), Buffer.concat([Buffer.from(text.slice(0, i)), Buffer.from([0xe1, 0xc7, 0xcf]), Buffer.from(text.slice(j))]));
      },
      /fonts\.json: not valid UTF-8 text/
    ],
    [
      '"__proto__" inside tokens (would set a prototype in the page script)',
      (lib) => {
        const r = sourceTemplates(lib, 'radius');
        fs.writeFileSync(el(lib, 'radius.json'), JSON.stringify(r).replace('"tokens":{', '"tokens":{"__proto__":{"evil":{"$value":1}},'));
      },
      /the key "__proto__" is not allowed \(at \/0\/tokens\/__proto__\)/
    ],
    ['"__proto__" written with escapes', (lib) => fs.writeFileSync(el(lib, 'radius.json'), JSON.stringify(sourceTemplates(lib, 'radius')).replace('"extras":', '"x":').replace('"tokens":{', '"tokens":{"\\u005f_proto__":null,')), /"__proto__" is not allowed/],
    ['identity without name and templates', (lib) => writeJson(path.join(lib, 'identities', 'bad.json'), { id: 'bad' }), /bad\.json: must have property "templates"/],
    ['identity with an unknown element', (lib) => writeJson(path.join(lib, 'identities', 'bad.json'), { id: 'bad', name: { ar: 'أ', en: 'a' }, templates: { logo: 'x' } }), /property name "logo" is invalid/],
    ['identity with a bad id', (lib) => writeJson(path.join(lib, 'identities', 'bad.json'), { id: '../x', name: { ar: 'أ', en: 'a' }, templates: { radius: 'radius-soft' } }), /bad\.json\/id: must match pattern/],
    [
      'identity carrying a copy of a draft template',
      (lib) => {
        const calm = readJson(path.join(lib, 'identities', 'calm.json'));
        writeJson(path.join(lib, 'identities', 'calm.json'), { ...calm, copy: sourceTemplates(lib, 'radius')[1] });
      },
      /calm\.json: unknown property "copy"/
    ],
    ['two identities with one id', (lib) => writeJson(path.join(lib, 'identities', 'zz.json'), { ...readJson(path.join(lib, 'identities', 'calm.json')) }), /identity id "calm" is already used in calm\.json/],
    ['no library at all', (lib) => fs.rmSync(path.join(lib, 'elements'), { recursive: true }), /no library found/]
  ];
  for (const [name, mutate, pattern] of cases) {
    try {
      expectRefused(mutate, pattern);
    } catch (e) {
      throw new Error(`${name}: ${e.message}`);
    }
  }
});

test('a refused library leaves the previous page data untouched', () => {
  const out = tmp();
  builder.build({ libraryDir: FIXTURE, outDir: out });
  const before = Object.fromEntries(fs.readdirSync(out).map((f) => [f, fs.readFileSync(path.join(out, f), 'utf8')]));
  const lib = copyFixture();
  const r = sourceTemplates(lib, 'radius');
  r[1].status = { state: 'reviewed' }; // invalid
  writeJson(path.join(lib, 'elements', 'radius.json'), r);
  assert.throws(() => builder.build({ libraryDir: lib, outDir: out }), builder.LibraryError);
  for (const [f, text] of Object.entries(before)) assert.equal(fs.readFileSync(path.join(out, f), 'utf8'), text, f);
});

test('a write that fails leaves the previous page data untouched and no temp files', { skip: process.platform === 'win32' || process.getuid?.() === 0 }, () => {
  const out = tmp();
  builder.build({ libraryDir: FIXTURE, outDir: out });
  const before = Object.fromEntries(fs.readdirSync(out).map((f) => [f, fs.readFileSync(path.join(out, f), 'utf8')]));
  const lib = copyFixture();
  const r = sourceTemplates(lib, 'radius');
  r[1].status = { state: 'reviewed', reviewedAt: '2026-11-16' }; // a real change, so new bytes would differ
  writeJson(path.join(lib, 'elements', 'radius.json'), r);
  fs.chmodSync(out, 0o555); // the folder cannot take new files
  try {
    assert.throws(() => builder.build({ libraryDir: lib, outDir: out }), (e) => e instanceof builder.WriteError && /left as it was/.test(e.message));
  } finally {
    fs.chmodSync(out, 0o755);
  }
  assert.deepEqual(fs.readdirSync(out).sort(), Object.keys(before).sort());
  for (const [f, text] of Object.entries(before)) assert.equal(fs.readFileSync(path.join(out, f), 'utf8'), text, f);
  // Fail on the last file, after eleven temp files were written: they must all be removed, nothing replaced.
  const blocker = path.join(out, `.identities.js.${process.pid}.tmp`);
  fs.mkdirSync(blocker);
  assert.throws(() => builder.build({ libraryDir: lib, outDir: out }), builder.WriteError);
  fs.rmdirSync(blocker);
  assert.deepEqual(fs.readdirSync(out).sort(), Object.keys(before).sort());
  for (const [f, text] of Object.entries(before)) assert.equal(fs.readFileSync(path.join(out, f), 'utf8'), text, f);
  const cli = spawnSync(process.execPath, [TOOL, '--library', lib, '--out', path.join(out, 'identities.js', 'x')], { encoding: 'utf8' });
  assert.equal(cli.status, 1, 'a write error is a clean exit 1, not a crash');
  assert.match(cli.stderr, /cannot write/);
});

test('system files such as .DS_Store in the library folders are ignored', () => {
  const lib = copyFixture();
  fs.writeFileSync(path.join(lib, 'elements', '.DS_Store'), Buffer.from([0, 0, 0, 1, 0xff]));
  fs.writeFileSync(path.join(lib, 'identities', '.DS_Store'), Buffer.from([0, 0, 0, 1, 0xff]));
  const a = builder.build({ libraryDir: lib, dryRun: true });
  const b = builder.build({ libraryDir: FIXTURE, dryRun: true });
  assert.deepEqual(a.files, b.files);
});

test('command line: counts printed, --dry-run writes nothing, problems exit 1, bad option exits 2', () => {
  const out = path.join(tmp(), 'data');
  let r = spawnSync(process.execPath, [TOOL, '--library', FIXTURE, '--out', out, '--dry-run'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /radius\s+published\s+1\s+drafts left out\s+1/);
  assert.match(r.stdout, /total: 11 templates published, 2 drafts left out; 1 identities published, 2 left out/);
  assert.match(r.stdout, /left out uses-draft\.json: radius: "radius-sharp" is a draft/);
  assert.equal(fs.existsSync(out), false);

  r = spawnSync(process.execPath, [TOOL, '--library', FIXTURE, '--out', out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(fs.readdirSync(out).length, 14);

  const lib = copyFixture();
  fs.writeFileSync(path.join(lib, 'elements', 'fonts.json'), '[{]');
  r = spawnSync(process.execPath, [TOOL, '--library', lib, '--out', path.join(tmp(), 'x')], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /nothing was written/);
  assert.match(r.stderr, /fonts\.json: not valid JSON/);

  r = spawnSync(process.execPath, [TOOL, '--bogus'], { encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown option --bogus/);
});

test('npm run build is wired to tools/build.js', () => {
  assert.equal(readJson(path.join(ROOT, 'package.json')).scripts.build, 'node tools/build.js');
});

test('a real browser loads the data from file:// (page opened as a file)', async (t) => {
  const c = await launch();
  if (!c) return t.skip('Chrome not installed');
  try {
    const dir = tmp('hawiya-page-');
    const out = path.join(dir, 'data');
    builder.build({ libraryDir: FIXTURE, outDir: out });
    const scripts = fs.readdirSync(out).sort().map((f) => `<script src="data/${f}"></script>`).join('');
    // No charset declared on purpose: the data must not depend on it.
    fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html><title>t</title>${scripts}`);
    await c.open('file://' + path.join(dir, 'index.html'));
    const got = await c.eval(
      'JSON.stringify({ radius: Hawiya.data.templates.radius.map(function (t) { return [t.id, t.name.ar]; }), ids: Hawiya.data.identities.map(function (i) { return i.id; }), n: Object.keys(Hawiya.data.templates).length })'
    );
    const soft = sourceTemplates(FIXTURE, 'radius')[0];
    assert.deepEqual(JSON.parse(got), { radius: [['radius-soft', soft.name.ar]], ids: ['calm'], n: 11 });
    assert.deepEqual(c.errors(), []);
  } finally {
    c.close();
  }
});

// Task 6.1 (R-104), task 7.1 (R-108): font-faces.js carries the record's @font-face rules for every family the
// published fonts templates name, nothing else; a record that breaks its strict shape stops the build.
test('font-faces.js holds the rules of the families the published templates name; a bad record stops the build', () => {
  const face = (weight, subset) => ({
    weight,
    subset,
    unicodeRange: subset === 'latin' ? 'U+0000-00FF, U+2000-206F' : subset === 'arabic' ? 'U+0600-06FF' : 'U+0100-02BA',
    url: `https://fonts.gstatic.com/s/test/v1/${subset}${weight}.woff2`
  });
  const entry = {
    weights: [400, 700],
    faces: [face(400, 'latin-ext'), face(400, 'latin'), face(700, 'latin-ext'), face(700, 'latin')]
  };
  const arabicEntry = { weights: [400], faces: [face(400, 'arabic'), face(400, 'latin')] };
  const record = {
    source: 'https://fonts.googleapis.com/css2',
    weights: [400, 600, 700],
    subsets: ['arabic', 'latin-ext', 'latin'],
    families: { 'IBM Plex Sans': entry, 'IBM Plex Sans Arabic': arabicEntry, 'Unused Sans': entry }
  };

  // No record: an empty object (npm run check is the one that requires it).
  let out = tmp();
  builder.build({ libraryDir: FIXTURE, outDir: out });
  assert.deepEqual(plain(loadData(out).fontFaces), {});

  const lib = copyFixture();
  // The fixture's pair predates the family names in extras (task 3.8): give it the two, as the real library has.
  const fontsFile = path.join(lib, 'elements', 'fonts.json');
  const fonts = readJson(fontsFile);
  fonts[0].extras = { ...fonts[0].extras, arabic: 'IBM Plex Sans Arabic', latin: 'IBM Plex Sans' };
  writeJson(fontsFile, fonts);
  writeJson(path.join(lib, 'font-faces.json'), record);
  out = tmp();
  const { summary } = builder.build({ libraryDir: lib, outDir: out });
  const data = loadData(out);
  assert.deepEqual(
    plain(data.fontFaces),
    { 'IBM Plex Sans': entry, 'IBM Plex Sans Arabic': arabicEntry },
    'the Arabic and the Latin family of the published template, not the unused one'
  );
  assert.ok(Object.isFrozen(data.fontFaces['IBM Plex Sans'].faces[0]));
  assert.equal(summary.fontFaces, 2);
  assert.match(builder.report(summary, { libraryDir: lib, outDir: out }), /font faces\s+2 families with @font-face rules/);

  const bad = [
    ['a quote in a range', (r) => (r.families['IBM Plex Sans'].faces[0].unicodeRange = "U+0000-00FF; } body { color: red")],
    ['a file outside fonts.gstatic.com', (r) => (r.families['IBM Plex Sans'].faces[1].url = 'https://example.com/s/x/v1/a.woff2')],
    ['a family name with a quote', (r) => (r.families['Bad" Sans'] = entry)],
    ['no 400', (r) => (r.families['IBM Plex Sans'] = { weights: [700], faces: [face(700, 'latin')] })],
    ['a weight without latin', (r) => (r.families['IBM Plex Sans'] = { weights: [400, 700], faces: [face(400, 'latin'), face(700, 'latin-ext')] })],
    ['a face twice', (r) => r.families['IBM Plex Sans'].faces.push(face(400, 'latin'))],
    ['700 without the latin-ext that 400 has', (r) => (r.families['IBM Plex Sans'].faces = r.families['IBM Plex Sans'].faces.filter((f) => !(f.weight === 700 && f.subset === 'latin-ext')))],
    ['700 with an arabic subset that 400 lacks', (r) => r.families['IBM Plex Sans'].faces.push(face(700, 'arabic'))],
    ['400 with neither arabic nor latin', (r) => (r.families['Unused Sans'] = { weights: [400], faces: [face(400, 'latin-ext')] })],
    ['an unknown subset', (r) => r.families['IBM Plex Sans'].faces.push({ ...face(400, 'latin'), subset: 'greek' })],
    ['an unlisted weight', (r) => r.families['IBM Plex Sans'].faces.push(face(600, 'latin'))]
  ];
  // Valid shapes Google serves: a family without latin-ext (Tajawal), an Arabic family without 600 (Amiri).
  const fine = plain(record);
  fine.families['IBM Plex Sans'].faces = fine.families['IBM Plex Sans'].faces.filter((f) => f.subset === 'latin');
  assert.deepEqual(builder.fontFacesProblems(fine), []);
  for (const [what, change] of bad) {
    const r = plain(record);
    change(r);
    writeJson(path.join(lib, 'font-faces.json'), r);
    assert.throws(() => builder.build({ libraryDir: lib, outDir: tmp() }), builder.LibraryError, what);
  }
});

test('the real library: font-faces.js has every family the published fonts templates name', () => {
  const out = tmp();
  builder.build({ libraryDir: path.join(ROOT, 'library'), outDir: out });
  const data = loadData(out);
  const families = new Set(data.templates.fonts.flatMap(builder.templateFamilies));
  assert.ok(families.size >= 54, `${families.size} families`);
  assert.deepEqual(Object.keys(data.fontFaces).sort(), [...families].sort());
  for (const [family, e] of Object.entries(plain(data.fontFaces))) {
    assert.ok(e.weights.includes(400) && e.weights.includes(700), family);
    for (const f of e.faces) assert.match(f.url, /^https:\/\/fonts\.gstatic\.com\/s\/[a-z0-9]+\/v\d+\/[\w-]+\.woff2$/, family);
  }
});
