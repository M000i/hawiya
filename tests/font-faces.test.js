'use strict';

// Task 6.1 (R-104): `npm run fonts` (tools/font-faces.js). No test reaches the internet: every answer from Google
// Fonts is a saved one (tests/fixtures/font-faces/eb-garamond-600.css, a real answer for EB Garamond 600) or made here.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const fonts = require('../tools/font-faces.js');
const build = require('../tools/build.js');

const ROOT = path.join(__dirname, '..');
const REAL = fs.readFileSync(path.join(__dirname, 'fixtures', 'font-faces', 'eb-garamond-600.css'), 'utf8');

// A Google-style answer for `family` at `weight`, from the real one: same subsets, same shape.
const answer = (family, weight) =>
  REAL.replace(/font-family: 'EB Garamond'/g, `font-family: '${family}'`).replace(
    /font-weight: 600/g,
    `font-weight: ${weight}`
  );

const tmpDirs = [];
test.after(() => tmpDirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true })));
function library() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hawiya-fonts-'));
  tmpDirs.push(d);
  const lib = path.join(d, 'library');
  fs.cpSync(path.join(ROOT, 'library'), lib, { recursive: true });
  return lib;
}

test('a real answer: only the normal latin-ext and latin faces are kept, with their range and woff2 file', () => {
  const faces = fonts.parse(REAL, 'EB Garamond', 600);
  assert.deepEqual(
    faces.map((f) => [f.weight, f.subset]),
    [
      [600, 'latin-ext'],
      [600, 'latin']
    ]
  );
  const latin = faces[1];
  assert.match(latin.unicodeRange, /^U\+0000-00FF, U\+0131, /);
  assert.match(latin.url, /^https:\/\/fonts\.gstatic\.com\/s\/ebgaramond\/v\d+\/[\w-]+\.woff2$/);
  assert.ok(REAL.includes(latin.url) && REAL.includes(latin.unicodeRange), 'copied as Google wrote them');
  // An italic face of a recorded subset is left out too.
  const italic = REAL.replace(
    /\/\* latin \*\/\n@font-face \{\n {2}font-family: 'EB Garamond';\n {2}font-style: normal;/,
    (m) => m.replace('normal', 'italic')
  );
  assert.deepEqual(
    fonts.parse(italic, 'EB Garamond', 600).map((f) => f.subset),
    ['latin-ext']
  );
});

test('the request asks css2 for one family and one weight, with a Chrome user agent (woff2)', () => {
  assert.equal(
    fonts.requestUrl('Plus Jakarta Sans', 600),
    'https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@600&display=swap'
  );
  assert.match(fonts.USER_AGENT, /Chrome\/\d+/);
});

// Task 7.1 (R-108): every family a fonts template names, not only the size-adjusted Latin ones.
test('every family a fonts template names is asked for (Arabic, Latin, heading, numerals), drafts too', () => {
  const names = fonts.families(path.join(ROOT, 'library'));
  const all = JSON.parse(fs.readFileSync(path.join(ROOT, 'library', 'elements', 'fonts.json'), 'utf8'));
  const expected = [
    ...new Set(
      all.flatMap((t) =>
        ['arabic', 'latin', 'numeralsFont', 'headingArabic', 'headingLatin'].map((k) => t.extras[k]).filter(Boolean)
      )
    )
  ].sort();
  assert.deepEqual(names, expected);
  assert.equal(names.length, 54);
  for (const f of ['Amiri', 'EB Garamond', 'Cairo', 'Marhey', 'IBM Plex Mono', 'Geist Mono'])
    assert.ok(names.includes(f), f);
  assert.deepEqual(build.templateFamilies(all.find((t) => t.id === 'pair-cairo')), ['Cairo']);
  assert.deepEqual(build.templateFamilies({ element: 'colors', extras: { arabic: 'A' } }), []);
  // The size-adjusted Latin family (task 6.2) is still only the Latin one of a two-family pair.
  assert.equal(build.adjustableLatin(all.find((t) => t.id === 'pair-cairo')), null);
  assert.equal(
    build.adjustableLatin({ element: 'fonts', extras: { latin: 'Geist', headingLatin: 'Geist Mono' } }),
    null
  );
  assert.equal(build.adjustableLatin({ element: 'colors', extras: { arabic: 'A', latin: 'B' } }), null);
});

test('run: the record of every family, weights Google lacks left out; the same answers give the same bytes', async () => {
  const lib = library();
  const asked = [];
  const get = async (url) => {
    asked.push(url);
    const m = /family=([^:]+):wght@(\d+)/.exec(url);
    const family = decodeURIComponent(m[1].replace(/\+/g, ' '));
    if (family === 'Lora' && m[2] === '600') return null; // as Google answers 400 for a missing weight
    return answer(family, Number(m[2]));
  };
  const r = await fonts.run({ libraryDir: lib, get });
  const file = path.join(lib, 'font-faces.json');
  const first = fs.readFileSync(file);
  const value = JSON.parse(first);
  const names = fonts.families(lib);
  assert.equal(r.families, names.length);
  assert.equal(asked.length, names.length * 3, 'one request per family and weight');
  assert.deepEqual(Object.keys(value.families), names, 'families sorted');
  assert.deepEqual(value.families.Lora.weights, [400, 700]);
  assert.deepEqual(
    value.families.Lora.faces.map((f) => `${f.weight} ${f.subset}`),
    ['400 latin-ext', '400 latin', '700 latin-ext', '700 latin']
  );
  assert.deepEqual(build.fontFacesProblems(value), []);
  await fonts.run({ libraryDir: lib, get });
  assert.ok(fs.readFileSync(file).equals(first), 'same answers, same bytes');
});

test('anything unexpected stops the run and leaves the file as it was', async () => {
  const lib = library();
  const file = path.join(lib, 'font-faces.json');
  const before = fs.readFileSync(file);
  const fam = (url) => decodeURIComponent(/family=([^:]+)/.exec(url)[1].replace(/\+/g, ' '));
  const weight = (url) => Number(/wght@(\d+)/.exec(url)[1]);
  const cases = [
    [
      'Google Fonts fails',
      async () => {
        throw new fonts.FontFacesError('Google Fonts answered 503');
      }
    ],
    [
      'a file outside fonts.gstatic.com',
      async (url) =>
        answer(fam(url), weight(url)).replace(
          /https:\/\/fonts\.gstatic\.com\/s\/ebgaramond/g,
          'https://example.com/s/ebgaramond'
        )
    ],
    [
      'a face that is not woff2',
      async (url) => answer(fam(url), weight(url)).replace(/format\('woff2'\)/g, "format('truetype')")
    ],
    ['a family without 400', async (url) => (weight(url) === 400 ? null : answer(fam(url), weight(url)))],
    ['an answer for another family', async () => answer('Other Font', 400)],
    ['an answer with no rule', async () => '/* nothing */'],
    [
      'a range that could leave CSS',
      async (url) =>
        answer(fam(url), weight(url)).replace('unicode-range: U+0000-00FF', "unicode-range: U+0000-00FF, url('x')")
    ]
  ];
  for (const [what, get] of cases) {
    await assert.rejects(fonts.run({ libraryDir: lib, get }), fonts.FontFacesError, what);
    assert.ok(fs.readFileSync(file).equals(before), `${what}: file unchanged`);
  }
  assert.deepEqual(
    fs.readdirSync(lib).filter((n) => n.includes('.tmp')),
    [],
    'no temporary file left'
  );
});

test('fetchCss: 200 gives the text, 400 means the weight is missing, any other answer stops', async () => {
  const real = global.fetch;
  try {
    const seen = [];
    global.fetch = async (url, opts) => {
      seen.push(opts.headers['User-Agent']);
      if (url.includes('ok')) return { status: 200, text: async () => 'css' };
      if (url.includes('missing')) return { status: 400, text: async () => '' };
      return { status: 503, text: async () => '' };
    };
    assert.equal(await fonts.fetchCss('https://fonts.googleapis.com/css2?ok'), 'css');
    assert.equal(await fonts.fetchCss('https://fonts.googleapis.com/css2?missing'), null);
    await assert.rejects(fonts.fetchCss('https://fonts.googleapis.com/css2?down'), /answered 503/);
    global.fetch = async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
    };
    await assert.rejects(
      fonts.fetchCss('https://fonts.googleapis.com/css2?x'),
      /cannot reach Google Fonts \(ENOTFOUND\)/
    );
    assert.ok(seen.every((ua) => ua === fonts.USER_AGENT));
  } finally {
    global.fetch = real;
  }
});

test('npm run fonts is wired to tools/font-faces.js; the committed record passes its own check', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.fonts, 'node tools/font-faces.js');
  const value = JSON.parse(fs.readFileSync(path.join(ROOT, 'library', 'font-faces.json'), 'utf8'));
  assert.deepEqual(build.fontFacesProblems(value), []);
  assert.deepEqual(Object.keys(value.families), fonts.families(path.join(ROOT, 'library')));
  assert.equal(fonts.render(value), fs.readFileSync(path.join(ROOT, 'library', 'font-faces.json'), 'utf8'));
});

// Review of 6.1: a change in Google's format never drops a face unseen; an unknown family is named; a bad record is
// replaced by the command instead of blocking it; a failed write is a clear error.
test('a face without its subset comment or its style stops the run instead of being dropped', () => {
  const noComment = REAL.replace('/* latin-ext */\n', '');
  assert.throws(
    () => fonts.parse(noComment, 'EB Garamond', 600),
    /1 @font-face rule\(s\) without a \/\* subset \*\/ comment/
  );
  const renamed = REAL.replace('/* latin-ext */', '/* latinext */');
  assert.deepEqual(
    fonts.parse(renamed, 'EB Garamond', 600).map((f) => f.subset),
    ['latin'],
    'an unknown subset name is simply not recorded…'
  );
  // …and refused when Google names it so at one weight only (task 7.1: every weight has the subsets of 400).
  const record = {
    source: fonts.SOURCE,
    weights: build.FONT_FACE_WEIGHTS,
    subsets: build.FONT_FACE_SUBSETS,
    families: {
      'EB Garamond': {
        weights: [400, 600],
        faces: [
          ...fonts.parse(REAL, 'EB Garamond', 600).map((f) => ({ ...f, weight: 400 })),
          ...fonts.parse(renamed, 'EB Garamond', 600)
        ]
      }
    }
  };
  assert.deepEqual(
    build.fontFacesProblems(record),
    ['EB Garamond: weight 600 has no face for the latin-ext subset'],
    '…and then refused'
  );
  const noStyle = REAL.replace(
    /(\/\* latin \*\/\n@font-face \{\n {2}font-family: 'EB Garamond';\n) {2}font-style: normal;\n/,
    '$1'
  );
  assert.throws(() => fonts.parse(noStyle, 'EB Garamond', 600), /the latin face names no font-style/);
});

// Task 7.1 (R-108): Arabic families. Google answers with an arabic face first; some families lack latin-ext (Tajawal)
// or a weight (Amiri has no 600); a family with emoji (Playpen Sans Arabic) also gets numbered slices without a
// subset comment, which are left out by their file name only.
const ARABIC = `/* arabic */
@font-face {
  font-family: 'Amiri';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/amiri/v30/J7aRnpd8CGxBHpUrtLMA7w.woff2) format('woff2');
  unicode-range: U+0600-06FF, U+0750-077F, U+200C-200E, U+2010-2011, U+FB50-FDFF, U+FE70-FE74, U+FE76-FEFC;
}
/* latin */
@font-face {
  font-family: 'Amiri';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/amiri/v30/J7aRnpd8CGxBHpUgtLMA7w.woff2) format('woff2');
  unicode-range: U+0000-00FF, U+0131, U+0152-0153;
}
`;
const SLICE = `@font-face {
  font-family: 'Amiri';
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(https://fonts.gstatic.com/s/amiri/v30/J7aRnpd8CGxBHpUrtLMA7w.1.woff2) format('woff2');
  unicode-range: U+200d, U+2620, U+1f308;
}
`;

test('an Arabic family: its arabic and latin faces are kept in Google order; numbered emoji slices are left out', () => {
  assert.deepEqual(
    fonts.parse(ARABIC, 'Amiri', 400).map((f) => f.subset),
    ['arabic', 'latin']
  );
  assert.deepEqual(fonts.parse(SLICE + SLICE + ARABIC, 'Amiri', 400), fonts.parse(ARABIC, 'Amiri', 400));
  // Only a numbered file is a slice: any other block without a comment still stops the run.
  const loose = SLICE.replace('.1.woff2', '.woff2');
  assert.throws(
    () => fonts.parse(loose + ARABIC, 'Amiri', 400),
    /1 @font-face rule\(s\) without a \/\* subset \*\/ comment/
  );
});

test('collect: a family without 600 and without latin-ext is recorded as Google serves it', async () => {
  const value = await fonts.collect(['Amiri'], async (url) =>
    url.includes('wght@600') ? null : ARABIC.replace(/font-weight: 400/g, `font-weight: ${/wght@(\d+)/.exec(url)[1]}`)
  );
  assert.deepEqual(value.families.Amiri.weights, [400, 700]);
  assert.deepEqual(
    value.families.Amiri.faces.map((f) => `${f.weight} ${f.subset}`),
    ['400 arabic', '400 latin', '700 arabic', '700 latin']
  );
  assert.deepEqual(build.fontFacesProblems(value), []);
  // Google dropping the arabic face at one weight is refused.
  await assert.rejects(
    fonts.collect(['Amiri'], async (url) =>
      url.includes('wght@600')
        ? null
        : url.includes('wght@700')
          ? ARABIC.replace(/font-weight: 400/g, 'font-weight: 700').replace(/\/\* arabic \*\/[\s\S]*?\}\n/, '')
          : ARABIC
    ),
    /Amiri: weight 700 has no face for the arabic subset/
  );
});

test('a family Google Fonts does not know is named', async () => {
  await assert.rejects(
    fonts.collect(['Not A Font'], async () => null),
    /Google Fonts has none of the weights 400, 600, 700 of "Not A Font" \(is the name right\?\)/
  );
});

test('npm run fonts replaces a bad record instead of being stopped by it', async () => {
  const lib = library();
  const file = path.join(lib, 'font-faces.json');
  const bad = JSON.parse(fs.readFileSync(file, 'utf8'));
  bad.families.Lora.faces[0].url = 'https://example.com/a.woff2';
  fs.writeFileSync(file, JSON.stringify(bad));
  assert.throws(() => build.load(lib), build.LibraryError, 'the build refuses it');
  const get = async (url) => {
    const m = /family=([^:]+):wght@(\d+)/.exec(url);
    return answer(decodeURIComponent(m[1].replace(/\+/g, ' ')), Number(m[2]));
  };
  await fonts.run({ libraryDir: lib, get });
  assert.deepEqual(build.fontFacesProblems(JSON.parse(fs.readFileSync(file, 'utf8'))), []);
  build.load(lib);
});

test('a failed write is a clear error, not a crash', async () => {
  const lib = library();
  const get = async (url) => {
    const m = /family=([^:]+):wght@(\d+)/.exec(url);
    return answer(decodeURIComponent(m[1].replace(/\+/g, ' ')), Number(m[2]));
  };
  const file = path.join(lib, 'font-faces.json');
  fs.rmSync(file);
  fs.mkdirSync(file); // a folder where the file goes: the rename fails
  await assert.rejects(
    fonts.run({ libraryDir: lib, get }),
    (e) => e instanceof fonts.FontFacesError && /cannot write/.test(e.message)
  );
  assert.deepEqual(
    fs.readdirSync(lib).filter((n) => n.includes('.tmp')),
    [],
    'no temporary file left'
  );
});
