'use strict';
// Task 3.1 (R-062, R-092): `npm run check` finds every kind of problem in the library, names the template, and
// passes on the real library.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const check = require('../tools/check.js');
const build = require('../tools/build.js');
const notices = require('../tools/notices.js');

const ROOT = path.join(__dirname, '..');
const LIB = path.join(ROOT, 'library');
const TOOL = path.join(ROOT, 'tools', 'check.js');

// A copy of the real library with its own freshly built page data: { dir, lib, data, edit, run }.
function copy() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hawiya-check-'));
  const lib = path.join(dir, 'library');
  const data = path.join(dir, 'data');
  fs.cpSync(LIB, lib, { recursive: true });
  build.build({ libraryDir: lib, outDir: data });
  const noticesFile = path.join(dir, 'NOTICES.md');
  const n = notices.load(lib);
  fs.writeFileSync(noticesFile, notices.render(n.sources, n.licenses));
  const edit = (rel, fn) => {
    const file = path.join(lib, rel);
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    const out = fn(value);
    fs.writeFileSync(file, JSON.stringify(out === undefined ? value : out, null, 2) + '\n');
  };
  const find = (list, id) => list.find((t) => t.id === id);
  const args = ['--library', lib, '--data', data, '--notices', noticesFile];
  return {
    dir,
    lib,
    data,
    noticesFile,
    args,
    edit,
    find,
    run: (more = {}) => check.check({ libraryDir: lib, dataDir: data, noticesFile, ...more })
  };
}
const clean = (c) => fs.rmSync(c.dir, { recursive: true, force: true });
const hex = (h) => ({
  colorSpace: 'srgb',
  components: [1, 3, 5].map((i) => +(parseInt(h.slice(i, i + 2), 16) / 255).toFixed(4)),
  hex: h
});
const has = (problems, kind, template, re) =>
  problems.some(
    (p) => p.kind === kind && (template === undefined || p.template === template) && (!re || re.test(p.message))
  );
const show = (problems) => problems.map((p) => `[${p.kind}] ${p.file} › ${p.template}: ${p.message}`).join('\n');

test('the real library and picker/data pass', () => {
  const r = check.check();
  assert.deepEqual(r.problems, [], show(r.problems));
  assert.equal(r.dataChecked, true);
  assert.ok(r.counts.templates >= 37 && r.counts.identities >= 2, JSON.stringify(r.counts));
});

test('a fresh copy passes; the tool prints «نجاح» with the count and exits 0', () => {
  const c = copy();
  try {
    assert.deepEqual(c.run().problems, []);
    const out = spawnSync(process.execPath, [TOOL, ...c.args], { encoding: 'utf8' });
    assert.equal(out.status, 0, out.stderr);
    const n = c.run().counts.templates; // every template, drafts too
    assert.ok(n >= 49, String(n));
    assert.match(out.stdout, new RegExp(`نجاح: فُحص ${n} تمبلت`));
    assert.match(out.stdout, new RegExp(`success: ${n} templates`));
  } finally {
    clean(c);
  }
});

// One library with a problem of every kind; each is found and named by its template (or file).
function addRemix(c) {
  c.edit(
    'sources.json',
    (l) =>
      void l.push({
        id: 'remix',
        name: 'Remix Icon',
        url: 'https://github.com/Remix-Design/RemixIcon',
        license: 'MIT',
        licenseFile: 'https://github.com/Remix-Design/RemixIcon/blob/master/License',
        licenseReadAt: '2026-11-16',
        copyright: ['Copyright (c) Remix Design'],
        use: 'Icon set.'
      })
  );
  c.edit(
    'elements/icons.json',
    (l) =>
      void (c.find(l, 'icons-tabler-outline').source = {
        name: 'Remix Icon',
        url: 'https://github.com/Remix-Design/RemixIcon',
        license: 'MIT'
      })
  );
}

const CASES = [
  [
    'structure',
    'palette-blue',
    (c) => c.edit('elements/colors.json', (l) => void (c.find(l, 'palette-blue').element = 'modes'))
  ],
  ['structure', undefined, (c) => fs.writeFileSync(path.join(c.lib, 'elements', 'notes.txt'), 'x')],
  [
    'schema',
    'direction-ltr',
    (c) => c.edit('elements/direction.json', (l) => void delete c.find(l, 'direction-ltr').platforms)
  ],
  [
    'tokens',
    'palette-teal',
    (c) =>
      c.edit(
        'elements/colors.json',
        (l) => void (c.find(l, 'palette-teal').tokens.color.primary.$value.components[0] = 0.9)
      ),
    /do not match/
  ],
  [
    'tokens',
    'radius-medium',
    (c) => c.edit('elements/radius.json', (l) => void (c.find(l, 'radius-medium').tokens.radius.md.$value.unit = 'em'))
  ],
  [
    'id',
    'radius-sharp',
    (c) => c.edit('elements/radius.json', (l) => void (c.find(l, 'radius-round').id = 'radius-sharp')),
    /already used/
  ],
  [
    'tags',
    'shadow-deep',
    (c) => c.edit('elements/shadows.json', (l) => void c.find(l, 'shadow-deep').tags.push('fancy'))
  ],
  ['tags', undefined, (c) => c.edit('tags.json', (l) => l.slice(1))],
  [
    'names',
    'spacing-airy',
    (c) => c.edit('elements/spacing.json', (l) => void (c.find(l, 'spacing-airy').name.ar = 'Airy')),
    /no Arabic letters/
  ],
  [
    'names',
    'spacing-balanced',
    (c) =>
      c.edit(
        'elements/spacing.json',
        (l) => void (c.find(l, 'spacing-balanced').name.ar = 'متوازن: undefined وundefined')
      ),
    /left over from a missing value/
  ],
  [
    'names',
    'spacing-grid-6',
    (c) => c.edit('elements/spacing.json', (l) => void (c.find(l, 'spacing-grid-6').name.en = 'Grid [object Object]')),
    /left over from a missing value/
  ],
  [
    'names',
    'spacing-compact',
    (c) => c.edit('elements/spacing.json', (l) => void delete c.find(l, 'spacing-compact').name.en)
  ],
  [
    'names',
    'type-scale-blank',
    (c) =>
      c.edit(
        'elements/type-scale.json',
        (l) =>
          void Object.assign(c.find(l, 'scale-minor-third'), { id: 'type-scale-blank', name: { ar: 'سلّم', en: '   ' } })
      ),
    /blank/
  ],
  [
    'contrast',
    'palette-rose',
    (c) =>
      c.edit(
        'elements/colors.json',
        // At AA every palette passes (button text is black or white, always 4.58:1 or more); a mid gray misses AAA.
        (l) => {
          const t = c.find(l, 'palette-rose');
          t.tokens.color.primary.$value = hex('#777777');
          t.a11y.contrast = 'AAA';
        }
      ),
    /declares AAA but in light mode onPrimary on primary is 4\.69:1 \(needs 7:1\)/
  ],
  [
    'contrast',
    'font-inter',
    (c) => c.edit('elements/fonts.json', (l) => void (c.find(l, 'font-inter').a11y.contrast = 'AA')),
    /declare "n\/a"/
  ],
  [
    'contrast',
    'card-filled',
    (c) =>
      c.edit('elements/cards.json', (l) => {
        const t = c.find(l, 'card-filled');
        t.recipe.css += '.hw-card:hover{color:var(--color-primary)}';
      }),
    /not a pair the contrast rule checks/
  ],
  [
    'reduced-motion',
    'button-outline',
    (c) => c.edit('elements/buttons.json', (l) => void (c.find(l, 'button-outline').a11y.reducedMotion = null)),
    /reducedMotion is null/
  ],
  [
    'reduced-motion',
    'button-soft',
    (c) =>
      c.edit(
        'elements/buttons.json',
        (l) => void (c.find(l, 'button-soft').a11y.reducedMotion = '.other{transition:none}')
      ),
    /does not turn off transition on \.hw-btn/
  ],
  [
    'logical',
    'card-bordered',
    (c) =>
      c.edit('elements/cards.json', (l) => void (c.find(l, 'card-bordered').recipe.css += '.hw-card{margin-left:4px}')),
    /margin-left/
  ],
  [
    'logical',
    'card-elevated',
    (c) =>
      c.edit(
        'elements/cards.json',
        (l) => void (c.find(l, 'card-elevated').recipe.css += '.hw-card{text-align:right}')
      ),
    /text-align:right/
  ],
  [
    'logical',
    'button-solid',
    (c) =>
      c.edit('elements/buttons.json', (l) => {
        const tok = c.find(l, 'button-solid').tokens.button;
        tok.paddingLeft = tok.paddingInline;
      }),
    /paddingLeft/
  ],
  [
    'recipe',
    'button-solid',
    (c) =>
      c.edit(
        'elements/buttons.json',
        (l) => void (c.find(l, 'button-solid').recipe.html = '<button class="hw-btn" onclick="x()">{label}</button>')
      )
  ],
  [
    'identity',
    'calm-corporate',
    (c) => c.edit('identities/calm-corporate.json', (v) => void (v.templates.buttons = 'button-missing')),
    /does not exist/
  ],
  [
    'identity',
    'warm-friendly',
    (c) => c.edit('identities/warm-friendly.json', (v) => void (v.templates.cards = 'button-solid')),
    /is a buttons template/
  ],
  [
    'tokens',
    'palette-blue',
    (c) =>
      c.edit(
        'elements/colors.json',
        (l) => void (c.find(l, 'palette-blue').tokens.color.primary.$value.hex = '#GGGGGG')
      ),
    /hex must be/
  ],
  [
    'contrast',
    'card-bordered',
    (c) =>
      c.edit('elements/cards.json', (l) => {
        const t = c.find(l, 'card-bordered');
        t.recipe.css = t.recipe.css.replace(
          'background:var(--color-surface)',
          'background:var(--color-primary);color:var(--color-on-primary)'
        );
      }),
    /on-surface on primary/
  ],
  [
    'contrast',
    'button-solid',
    (c) =>
      c.edit(
        'elements/buttons.json',
        (l) => void (c.find(l, 'button-solid').recipe.css += '.hw-btn{background-image:linear-gradient(#fff,#fff)}')
      ),
    /background-image/
  ],
  [
    'reduced-motion',
    'card-elevated',
    (c) =>
      c.edit(
        'elements/cards.json',
        (l) => void (c.find(l, 'card-elevated').recipe.css += '.hw-card{-webkit-transition:transform 1s}')
      ),
    /reducedMotion is null/
  ],
  [
    'reduced-motion',
    'shadow-soft',
    (c) => c.edit('elements/shadows.json', (l) => void (c.find(l, 'shadow-soft').a11y.reducedMotion = '  ')),
    /blank/
  ],
  [
    'schema',
    'button-plain',
    (c) =>
      c.edit('elements/buttons.json', (l) => {
        const t = JSON.parse(JSON.stringify(c.find(l, 'button-solid')));
        Object.assign(t, { id: 'button-plain', kind: 'setting', a11y: { contrast: 'n/a', reducedMotion: null } });
        delete t.recipe;
        l.push(t);
      }),
    /composite template with a recipe/
  ],
  [
    'axes',
    'spacing-copy',
    (c) =>
      c.edit('elements/spacing.json', (l) => {
        const t = JSON.parse(JSON.stringify(c.find(l, 'spacing-airy')));
        t.id = 'spacing-copy';
        t.tokens.spacing.scale['8'].$value.value = 160;
        l.push(t);
      }),
    /differs from "spacing-airy" \(spacing\.json\) only in Largest step/
  ],
  // Licenses and sources (task 3.2).
  [
    'license',
    'shadow-flat',
    (c) =>
      c.edit(
        'elements/shadows.json',
        (l) => void (c.find(l, 'shadow-flat').source.url = 'https://github.com/someone/else')
      ),
    /source address https:\/\/github\.com\/someone\/else differs from sources\.json/
  ],
  [
    'license',
    'palette-teal',
    (c) => c.edit('elements/colors.json', (l) => void (c.find(l, 'palette-teal').source.license = 'GPL-3.0')),
    /"GPL-3\.0" is not on the allowed list/
  ],
  ['license', 'icons-tabler-outline', addRemix, /forbidden source "Remix Icon"/],
  ['license', 'remix', addRemix, /forbidden source "Remix Icon"/],
  [
    'license',
    'icons-lucide-light',
    (c) => c.edit('elements/icons.json', (l) => void (c.find(l, 'icons-lucide-light').extras.library = 'remixicon')),
    /forbidden source "Remix Icon"/
  ],
  [
    'license',
    'font-inter',
    (c) =>
      c.edit(
        'elements/fonts.json',
        (l) => void c.find(l, 'font-inter').tokens.font.body.$value.splice(1, 0, 'SF Pro Text')
      ),
    /forbidden source "Apple assets/
  ],
  [
    'license',
    'radius-sharp',
    (c) => c.edit('elements/radius.json', (l) => void (c.find(l, 'radius-sharp').source.name = 'Somewhere')),
    /not in sources\.json/
  ],
  [
    'license',
    'spacing-comfortable',
    (c) => c.edit('elements/spacing.json', (l) => void delete c.find(l, 'spacing-comfortable').source)
  ],
  [
    'license',
    'pair-cairo',
    (c) => c.edit('elements/fonts.json', (l) => void c.find(l, 'pair-cairo').extras.sources.push('nowhere')),
    /extras\.sources: "nowhere"/
  ],
  [
    'license',
    'readex-pro',
    (c) => {
      // Readex Pro is used by two pairs (tasks 3.8, 5.2): pointing both elsewhere leaves its source unused.
      c.edit('elements/fonts.json', (l) => {
        const t = c.find(l, 'pair-readex-pro-outfit');
        t.source = { name: 'IBM Plex', url: 'https://github.com/IBM/plex', license: 'OFL-1.1' };
        t.extras.sources = ['plex', 'outfit'];
        // Task 5.2: a second pair uses Readex Pro.
        const u = c.find(l, 'pair-readex-pro-ibm-plex-sans');
        u.source = { name: 'IBM Plex', url: 'https://github.com/IBM/plex', license: 'OFL-1.1' };
        u.extras.sources = ['plex'];
      });
    },
    /no template uses this source/
  ],
  [
    'license',
    'tailwind',
    (c) =>
      c.edit('sources.json', (l) => {
        const t = l.find((x) => x.id === 'tailwind');
        t.license = 'CC0-1.0';
      }),
    /"CC0-1\.0" has no text/
  ],
  // Task 5.1 (B-078): every font a template names is listed by one of its sources in sources.json.
  [
    'license',
    'pair-zain-figtree',
    (c) =>
      c.edit(
        'elements/fonts.json',
        (l) => void (c.find(l, 'pair-zain-figtree').tokens.font.heading.$value = ['Cormorant Garamond', 'serif'])
      ),
    /font "Cormorant Garamond" is listed by no source/
  ],
  [
    'license',
    'pair-tajawal-manrope',
    (c) => c.edit('elements/fonts.json', (l) => void (c.find(l, 'pair-tajawal-manrope').extras.latin = 'Merriweather')),
    /font "Merriweather" is listed by no source/
  ],
  [
    'license',
    'pair-rubik',
    (c) =>
      c.edit(
        'elements/fonts.json',
        (l) => void (c.find(l, 'pair-rubik').tokens.font.body.$value = ['Inter', 'sans-serif'])
      ),
    /font "Inter" comes from "inter", which this template does not name/
  ],
  [
    'license',
    'onest',
    (c) => c.edit('sources.json', (l) => void l.find((x) => x.id === 'onest').fonts.push('Cairo')),
    /"Cairo" is also listed by "cairo"/
  ]
];

for (const [kind, template, mutate, re] of CASES) {
  test(`finds ${kind}${template ? ` in ${template}` : ''} on its own`, () => {
    const c = copy();
    try {
      mutate(c);
      const r = c.run();
      assert.ok(has(r.problems, kind, template, re), `expected [${kind}] ${template}:\n${show(r.problems)}`);
    } finally {
      clean(c);
    }
  });
}

test('one library with every kind of problem: each is found, named, and the tool exits 1', () => {
  const c = copy();
  try {
    for (const [, , mutate] of CASES) mutate(c);
    // The skill folder: one without SKILL.md (task 4.1).
    const r = c.run({ skillDir: c.dir });
    assert.ok(has(r.problems, 'skill', null, /^missing$/), show(r.problems));
    for (const [kind, template, , re] of CASES) {
      assert.ok(has(r.problems, kind, template, re), `missing [${kind}] ${template}:\n${show(r.problems)}`);
    }
    assert.deepEqual(
      check.KINDS.filter((k) => !['data', 'notices'].includes(k) && !r.problems.some((p) => p.kind === k)),
      [],
      'every kind but data and notices (checked once their inputs are sound) is represented'
    );
    assert.equal(r.dataChecked, false);
    const out = spawnSync(process.execPath, [TOOL, ...c.args], { encoding: 'utf8' });
    assert.equal(out.status, 1);
    for (const id of [
      'palette-teal',
      'palette-rose',
      'card-bordered',
      'button-outline',
      'shadow-deep',
      'spacing-airy'
    ]) {
      assert.match(out.stderr, new RegExp(`› ${id}: `), id);
    }
    assert.match(out.stderr, /فشل: \d+ مخالفة/);
  } finally {
    clean(c);
  }
});

test('picker/data out of date: each changed template is named; extra and missing files are found', () => {
  const c = copy();
  try {
    c.edit('elements/radius.json', (l) => void (c.find(l, 'radius-round').name.en = 'Rounder corners'));
    c.edit('elements/shadows.json', (l) => {
      const t = c.find(l, 'shadow-flat');
      t.status = { state: 'draft' };
    });
    fs.writeFileSync(path.join(c.data, 'old.js'), '');
    fs.rmSync(path.join(c.data, 'icons.js'));
    fs.writeFileSync(path.join(c.data, '.DS_Store'), ''); // dot files are not page data
    const r = c.run();
    assert.equal(r.dataChecked, true);
    assert.ok(has(r.problems, 'data', 'radius-round', /changed since the last build/), show(r.problems));
    assert.ok(has(r.problems, 'data', 'shadow-flat', /not published/), show(r.problems));
    assert.ok(
      r.problems.some((p) => p.kind === 'data' && p.file === 'picker/data/old.js'),
      show(r.problems)
    );
    assert.ok(
      r.problems.some((p) => p.kind === 'data' && p.file === 'picker/data/icons.js' && /missing/.test(p.message)),
      show(r.problems)
    );
    assert.ok(!r.problems.some((p) => /DS_Store/.test(p.file || '')), show(r.problems));
    assert.ok(
      r.problems.every((p) => p.kind === 'data'),
      show(r.problems)
    );
    // After the build the data matches again.
    fs.rmSync(path.join(c.data, 'old.js'));
    build.build({ libraryDir: c.lib, outDir: c.data });
    assert.deepEqual(c.run().problems, []);
  } finally {
    clean(c);
  }
});

test('a draft is checked like a reviewed template', () => {
  const c = copy();
  try {
    const drafts = c.run().counts.drafts;
    c.edit('elements/radius.json', (l) => {
      const t = c.find(l, 'radius-sharp');
      t.status = { state: 'draft' };
      t.recipe = undefined;
      t.tokens.radius.sm.$value.unit = 'pt';
    });
    const r = c.run();
    assert.ok(has(r.problems, 'tokens', 'radius-sharp', /unit/), show(r.problems));
    assert.equal(r.counts.drafts, drafts + 1);
  } finally {
    clean(c);
  }
});

test('motion: what moves and what turns it off', () => {
  assert.deepEqual(check.motionIn('.a{transition:none}.b{animation:0s}'), []);
  assert.deepEqual(check.motionIn('.a:hover{transition:color .2s}'), [{ selector: '.a:hover', family: 'transition' }]);
  assert.deepEqual(check.motionIn('.a{-webkit-transition:color .2s}'), [{ selector: '.a', family: 'transition' }]);
  assert.deepEqual(check.motionIn('@-webkit-keyframes k{from{opacity:0}}'), [
    { selector: '@keyframes', family: 'animation' }
  ]);
  assert.equal(check.stills('.a{transition:none}', '.a', 'transition'), true);
  assert.equal(check.stills('.a{-webkit-transition-duration:0s}', '.a', 'transition'), true);
  // A plain rule on the element loses to its :hover rule; only the same selector or !important turns it off.
  assert.equal(check.stills('.a{transition:none}', '.a:hover', 'transition'), false);
  assert.equal(check.stills('.a{transition:none !important}', '.a:hover', 'transition'), true);
  assert.equal(check.stills('.a{transition:none}', '.a', 'animation'), false);
});

test('recipe contrast follows the HTML: text on a parent fill, see-through children, images and inset shadows', () => {
  const card = '<article class="c"><h3 class="t">{title}</h3><p class="b">{body}</p></article>';
  const pairs = (html, css) => check.recipePairs(html, css).problems.join('\n');
  assert.equal(
    pairs(
      card,
      '.c{background:var(--color-surface)}.t{color:var(--color-on-surface)}.b{color:var(--color-muted-text)}'
    ),
    ''
  );
  // The reviewer's case: the card is filled with primary, its title and body keep the page text colors.
  assert.match(
    pairs(card, '.c{background:var(--color-primary);color:var(--color-on-primary)}.t{color:var(--color-on-surface)}'),
    /h3\.t: on-surface on primary/
  );
  // A transparent child shows its parent's fill.
  assert.match(
    pairs(card, '.c{background:var(--color-primary)}.t{background:transparent;color:var(--color-muted-text)}'),
    /h3\.t: muted-text on primary/
  );
  // No text color anywhere: the scene's text, readable on the page colors only.
  assert.match(
    pairs(card, '.c{background:var(--color-primary)}'),
    /article\.c: the scene's text on var\(--color-primary\)/
  );
  assert.equal(pairs(card, '.c{background:var(--color-surface)}'), '');
  // Hover on the card changes the fill under its children.
  assert.match(
    pairs(
      card,
      '.c{background:var(--color-surface)}.c:hover{background:var(--color-primary)}.t{color:var(--color-on-surface)}'
    ),
    /h3\.t:hover: on-surface on primary/
  );
  const btn = '<button class="hw-btn">{label}</button>';
  assert.match(
    pairs(
      btn,
      '.hw-btn{background:var(--color-primary);color:var(--color-on-primary);background-image:linear-gradient(#fff,#fff)}'
    ),
    /background-image/
  );
  assert.match(
    pairs(
      btn,
      '.hw-btn{background:var(--color-primary);color:var(--color-on-primary);box-shadow:inset 0 0 0 99px var(--color-surface)}'
    ),
    /box-shadow/
  );
  // Both change together on hover: a checked pair in each state.
  assert.equal(
    pairs(
      btn,
      '.hw-btn{background:var(--color-surface);color:var(--color-on-surface)}.hw-btn:hover{background:var(--color-primary);color:var(--color-on-primary)}'
    ),
    ''
  );
  // A selector for content placed in a placeholder is taken as a child of the outermost element.
  assert.match(
    pairs(
      btn,
      '.hw-btn{background:var(--color-primary);color:var(--color-on-primary)}.hw-icon{color:var(--color-accent-text)}'
    ),
    /\.hw-icon: accent-text on primary/
  );
});

test('recipe contrast resolves the cascade: specificity, !important, states together, background:none', () => {
  const pairs = (html, css) => check.recipePairs(html, css).problems.join('\n');
  const card = '<article class="hw-card"><p class="hw-card-body hw-x">{body}</p></article>';
  const body = '.hw-card{background:var(--color-surface)}.hw-card-body{color:var(--color-muted-text)}';
  // The more specific rule wins although it comes first.
  assert.match(
    pairs(
      card,
      body + '.hw-card-body.hw-x{background:var(--color-primary)}.hw-card-body{background:var(--color-surface)}'
    ),
    /muted-text on primary/
  );
  const btn = '<button class="hw-btn">{label}</button>';
  const solid = '.hw-btn{background:var(--color-primary);color:var(--color-on-primary)}';
  // !important wins although it comes first.
  assert.match(pairs(btn, '.hw-btn{background:var(--color-surface) !important}' + solid), /on-primary on surface/);
  // Hovered and focused together.
  assert.match(
    pairs(
      btn,
      solid +
        '.hw-btn:hover{background:var(--color-surface);color:var(--color-accent-text)}.hw-btn:focus-visible{color:var(--color-on-primary)}'
    ),
    /hw-btn:hover:focus-visible: on-primary on surface|hw-btn:focus-visible:hover: on-primary on surface/
  );
  // background:none shows the page.
  assert.equal(pairs(btn, '.hw-btn{background:none;color:var(--color-accent-text)}'), '');
  // A gradient in the shorthand is a fill the rule never checks.
  assert.match(
    pairs(btn, '.hw-btn{background:linear-gradient(red,blue);color:var(--color-on-primary)}'),
    /background-image/
  );
});

test('reduced motion: an ancestor rule does not still a descendant; a fade under 100ms is allowed', () => {
  assert.equal(
    check.stills('.hw-card{transition:none !important}', '.hw-card:hover .hw-card-title', 'transition'),
    false
  );
  assert.equal(
    check.stills('.hw-card .hw-card-title{transition:none !important}', '.hw-card:hover .hw-card-title', 'transition'),
    true
  );
  assert.deepEqual(check.motionIn('.a{transition:opacity 50ms}', { fades: true }), []);
  assert.equal(check.motionIn('.a{transition:opacity 150ms}', { fades: true }).length, 1);
  assert.equal(check.motionIn('.a{transition:transform 50ms}', { fades: true }).length, 1);
  assert.equal(check.motionIn('.a{transition:opacity 50ms}').length, 1); // in a recipe a fade is still motion
});

test('left / right: words split by "_", digits and camel case; "bright" is not "right"', () => {
  const t = (tokens) => check.tokenProblems(tokens).physical;
  const dim = { $type: 'dimension', $value: { value: 1, unit: 'px' } };
  assert.equal(t({ a: { inset_left: dim } }).length, 1);
  assert.equal(t({ a: { paddingRight: dim } }).length, 1);
  assert.equal(t({ a: { bright: dim } }).length, 0);
  assert.deepEqual(check.physicalCss('.a{--pad_left:1px}.b{filter:brightness(1.1)}'), ['--pad_left:1px']);
});

test('THIRD_PARTY_NOTICES: a stale or missing file is found; npm run notices makes it match', () => {
  const c = copy();
  try {
    c.edit('sources.json', (l) => void (l.find((x) => x.id === 'tailwind').use = 'Colors.'));
    let r = c.run();
    assert.ok(has(r.problems, 'notices', undefined, /run npm run notices/), show(r.problems));
    assert.ok(
      r.problems.every((p) => p.kind === 'notices'),
      show(r.problems)
    );
    const out = spawnSync(
      process.execPath,
      [path.join(ROOT, 'tools', 'notices.js'), '--library', c.lib, '--out', c.noticesFile],
      {
        encoding: 'utf8'
      }
    );
    assert.equal(out.status, 0, out.stderr);
    assert.match(
      fs.readFileSync(c.noticesFile, 'utf8'),
      /\| \[Tailwind CSS\]\(https:\/\/github\.com\/tailwindlabs\/tailwindcss\) \| MIT \| Colors\. \|/
    );
    assert.deepEqual(c.run().problems, []);
    fs.rmSync(c.noticesFile);
    r = c.run();
    assert.ok(has(r.problems, 'notices', undefined, /missing/), show(r.problems));
  } finally {
    clean(c);
  }
});

test('the committed THIRD_PARTY_NOTICES.md lists every third-party source with its copyright and every license text', () => {
  const text = fs.readFileSync(path.join(ROOT, 'THIRD_PARTY_NOTICES.md'), 'utf8');
  const sources = JSON.parse(fs.readFileSync(path.join(LIB, 'sources.json'), 'utf8'));
  const licenses = JSON.parse(fs.readFileSync(path.join(LIB, 'licenses.json'), 'utf8'));
  for (const s of sources) {
    if (s.own) {
      assert.doesNotMatch(text, new RegExp(`## ${s.name}\n`), 'the project itself is not third-party');
      continue;
    }
    assert.match(text, new RegExp(`\n## ${s.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\n`), s.name);
    for (const line of s.copyright.concat(...(s.also || []).map((a) => a.copyright)))
      assert.ok(text.includes(line), line);
  }
  // Lucide's icons from Feather keep Feather's MIT notice.
  assert.ok(text.includes('Copyright (c) 2013-present Cole Bemis'));
  for (const id of ['MIT', 'ISC', 'OFL-1.1']) {
    const l = licenses.allowed.find((x) => x.id === id);
    assert.ok(text.includes(l.text.join('\n')), `${id} full text`);
  }
  // Deterministic: the same files give the same bytes.
  const n = notices.load(LIB);
  assert.equal(notices.render(n.sources, n.licenses), text);
});

test('notices refuses a third-party license without text; nothing is written', () => {
  const c = copy();
  try {
    c.edit('licenses.json', (v) => void delete v.allowed.find((l) => l.id === 'ISC').text);
    const before = fs.readFileSync(c.noticesFile, 'utf8');
    const out = spawnSync(
      process.execPath,
      [path.join(ROOT, 'tools', 'notices.js'), '--library', c.lib, '--out', c.noticesFile],
      {
        encoding: 'utf8'
      }
    );
    assert.equal(out.status, 1);
    assert.match(out.stderr, /"ISC" has no text/);
    assert.equal(fs.readFileSync(c.noticesFile, 'utf8'), before);
    assert.ok(has(c.run().problems, 'license', 'lucide', /"ISC" has no text/));
  } finally {
    clean(c);
  }
});

test('"-apple-system" in a font stack is a CSS keyword, not an Apple asset', () => {
  const c = copy();
  try {
    c.edit(
      'elements/fonts.json',
      (l) => void c.find(l, 'font-inter').tokens.font.body.$value.splice(1, 0, '-apple-system')
    );
    assert.deepEqual(
      c.run().problems.filter((p) => p.kind === 'license'),
      []
    );
  } finally {
    clean(c);
  }
});

// Review of task 3.2: the ways a forbidden or unrecorded source could get in.
function addSource(c, src) {
  c.edit(
    'sources.json',
    (l) =>
      void l.push({
        licenseReadAt: '2026-11-16',
        copyright: ['Copyright (c) Someone'],
        use: 'Test.',
        license: 'MIT',
        ...src
      })
  );
}
function useSource(c, id, src, extras) {
  c.edit('elements/icons.json', (l) => {
    const t = c.find(l, id);
    t.source = { name: src.name, url: src.url, license: src.license || 'MIT' };
    Object.assign(t.extras, extras || {});
  });
}

test('Remix Icon through Iconify: its prefix "ri" and an Iconify address are refused', () => {
  const c = copy();
  try {
    const src = {
      id: 'ri',
      name: 'RI',
      url: 'https://icon-sets.iconify.design/ri/',
      licenseFile: 'https://icon-sets.iconify.design/ri/'
    };
    addSource(c, src);
    useSource(c, 'icons-tabler-outline', src, { library: 'ri' });
    const r = c.run();
    assert.ok(has(r.problems, 'license', 'icons-tabler-outline', /forbidden source "Remix Icon"/), show(r.problems));
    assert.ok(has(r.problems, 'license', 'icons-tabler-outline', /Iconify page/), show(r.problems));
    assert.ok(has(r.problems, 'license', 'ri', /url is an Iconify page/), show(r.problems));
    assert.ok(has(r.problems, 'license', 'ri', /forbidden source "Remix Icon"/), show(r.problems));
  } finally {
    clean(c);
  }
});

test('Hover.css through its repository address is refused', () => {
  const c = copy();
  try {
    const src = {
      id: 'fx',
      name: 'Effects',
      url: 'https://github.com/IanLunn/Hover',
      licenseFile: 'https://github.com/IanLunn/Hover/blob/master/license.txt'
    };
    addSource(c, src);
    useSource(c, 'icons-tabler-outline', src);
    const r = c.run();
    assert.ok(has(r.problems, 'license', 'fx', /forbidden source "Hover\.css"/), show(r.problems));
    assert.ok(has(r.problems, 'license', 'icons-tabler-outline', /forbidden source "Hover\.css"/), show(r.problems));
  } finally {
    clean(c);
  }
});

test('"own" belongs to the project only: a third-party source cannot hide from the notices', () => {
  const c = copy();
  try {
    c.edit('sources.json', (l) => {
      delete l.find((x) => x.id === 'hawiya').own;
      l.find((x) => x.id === 'tailwind').own = true;
    });
    const r = c.run();
    assert.ok(has(r.problems, 'license', 'tailwind', /only the project's own entry/), show(r.problems));
    assert.ok(has(r.problems, 'license', 'hawiya', /must have "own": true/), show(r.problems));
    // And the notices never drop a third-party source, whatever the flag says.
    const n = notices.load(c.lib);
    assert.match(notices.render(n.sources, n.licenses), /\n## Tailwind CSS\n/);
  } finally {
    clean(c);
  }
});

test('every text in extras is searched (not the SVG samples); system font names are not Apple assets', () => {
  const c = copy();
  try {
    c.edit(
      'elements/colors.json',
      (l) => void (c.find(l, 'palette-blue').extras = { palette: 'Apple system colors (SF Symbols)' })
    );
    c.edit(
      'elements/fonts.json',
      (l) => void c.find(l, 'font-inter').tokens.font.body.$value.push('Apple Color Emoji', 'BlinkMacSystemFont')
    );
    const r = c.run().problems.filter((p) => p.kind === 'license');
    assert.ok(has(r, 'license', 'palette-blue', /forbidden source "Apple/), show(r));
    assert.ok(!r.some((p) => p.template === 'font-inter'), show(r));
  } finally {
    clean(c);
  }
});

test('a blank license text is refused; npm run notices refuses broken files without crashing', () => {
  const c = copy();
  try {
    c.edit('licenses.json', (v) => void (v.allowed.find((l) => l.id === 'MIT').text = ['']));
    assert.ok(has(c.run().problems, 'license', 'MIT', /too short/));
    const tool = path.join(ROOT, 'tools', 'notices.js');
    for (const bad of [[null], [{ name: 'X', license: 'MIT', copyright: null }], {}]) {
      fs.writeFileSync(path.join(c.lib, 'sources.json'), JSON.stringify(bad));
      const out = spawnSync(process.execPath, [tool, '--library', c.lib, '--out', c.noticesFile], { encoding: 'utf8' });
      assert.equal(out.status, 1, out.stderr);
      assert.match(out.stderr, /sources\.json.*nothing was written/);
      assert.doesNotMatch(out.stderr, /TypeError/);
    }
  } finally {
    clean(c);
  }
});

test('Iconify copies on npm, a CDN or its own repository are refused as sources', () => {
  for (const url of [
    'https://www.npmjs.com/package/@iconify-json/ri',
    'https://cdn.jsdelivr.net/npm/@iconify-json/ri/',
    'https://github.com/iconify/icon-sets'
  ]) {
    const c = copy();
    try {
      const src = { id: 'lines', name: 'Lines', url, licenseFile: url };
      addSource(c, src);
      useSource(c, 'icons-tabler-outline', src, { library: 'r-line' });
      const r = c.run();
      assert.ok(has(r.problems, 'license', 'lines', /Iconify/), `${url}\n${show(r.problems)}`);
      assert.ok(has(r.problems, 'license', 'icons-tabler-outline', /Iconify/), `${url}\n${show(r.problems)}`);
    } finally {
      clean(c);
    }
  }
});

test('no false alarms: the Remix web framework, "Pineapple", and a note that mentions Apple', () => {
  const c = copy();
  try {
    const src = {
      id: 'remix',
      name: 'Remix',
      url: 'https://github.com/remix-run/remix',
      licenseFile: 'https://github.com/remix-run/remix/blob/main/LICENSE.md'
    };
    addSource(c, src);
    useSource(c, 'icons-tabler-outline', src);
    c.edit('elements/colors.json', (l) => void (c.find(l, 'palette-blue').extras = { palette: 'Pineapple yellow' }));
    c.edit(
      'elements/radius.json',
      (l) =>
        void (c.find(l, 'radius-round').extras = { note: 'iOS-like values written by this project, not Apple assets' })
    );
    const r = c.run().problems.filter((p) => p.kind === 'license' && /forbidden/.test(p.message));
    assert.deepEqual(r, [], show(r));
  } finally {
    clean(c);
  }
});

test('the own entry is the project: swapping ids cannot hide a third-party source', () => {
  const c = copy();
  try {
    c.edit('sources.json', (l) => {
      const own = l.find((x) => x.id === 'hawiya');
      const tw = l.find((x) => x.id === 'tailwind');
      own.id = 'project';
      delete own.own;
      tw.id = 'hawiya';
      tw.own = true;
    });
    const r = c.run();
    assert.ok(
      has(r.problems, 'license', 'hawiya', /must be named Hawiya, under MIT, with the copyright line of LICENSE/),
      show(r.problems)
    );
    // The project's entry with another copyright line is refused too.
    const d = copy();
    try {
      d.edit(
        'sources.json',
        (l) => void (l.find((x) => x.id === 'hawiya').copyright = ['Copyright (c) Tailwind Labs, Inc.'])
      );
      assert.ok(has(d.run().problems, 'license', 'hawiya', /copyright line of LICENSE/));
    } finally {
      clean(d);
    }
  } finally {
    clean(c);
  }
});

// Task 3.3: two templates of one element differ in at least two axes (library/axes.json).
function twin(c, file, id, newId, change) {
  c.edit(`elements/${file}`, (l) => {
    const t = JSON.parse(JSON.stringify(c.find(l, id)));
    t.id = newId;
    change(t);
    l.push(t);
  });
  return c.run().problems.filter((p) => p.kind === 'axes');
}
const axisCase = (file, id, change) => {
  const c = copy();
  try {
    return twin(c, file, id, 'twin', change);
  } finally {
    clean(c);
  }
};

test('axes: one axis apart is refused and both templates are named; two axes apart is accepted', () => {
  let p = axisCase('type-scale.json', 'scale-major-third', (t) => (t.tokens.typeScale.ratio.$value = 1.4));
  assert.equal(p.length, 1, show(p));
  assert.equal(p[0].template, 'twin');
  assert.match(
    p[0].message,
    /differs from "scale-major-third" \(type-scale\.json\) only in Ratio; .* must differ in 2 axes/
  );
  p = axisCase('type-scale.json', 'scale-major-third', (t) => {
    t.tokens.typeScale.ratio.$value = 1.4;
    t.tokens.lineHeight.en.$value = 1.6;
  });
  assert.deepEqual(p, []);
  // An exact copy is named as such.
  p = axisCase('shadows.json', 'shadow-soft', () => {});
  assert.match(p[0].message, /same values as "shadow-soft" .* on every axis/);
});

test('axes: tolerances — a nearly equal color or size is the same value', () => {
  // #2563eb → #2564eb is invisible: still one axis apart (the secondary) → refused.
  let p = axisCase('colors.json', 'palette-blue', (t) => {
    t.tokens.color.primary.$value = hex('#2564eb');
    t.tokens.color.secondary.$value = hex('#16a34a');
  });
  assert.match(p.map((x) => x.message).join(), /only in Secondary color/);
  p = axisCase('colors.json', 'palette-blue', (t) => {
    t.tokens.color.primary.$value = hex('#16a34a');
    t.tokens.color.secondary.$value = hex('#e11d48');
  });
  assert.ok(!p.some((x) => x.template === 'twin' && /palette-blue/.test(x.message)), show(p));
  // Radius 1px apart is the same; 4px apart is not.
  p = axisCase('radius.json', 'radius-medium', (t) => {
    t.tokens.radius.sm.$value.value += 1;
    t.tokens.radius.md.$value.value += 1;
    t.tokens.radius.lg.$value.value += 4;
  });
  assert.match(p.map((x) => x.message).join(), /differs from "radius-medium" .* only in Large radius/);
});

test('axes: the owner decisions — the icon library counts twice; modes need their one axis to differ', () => {
  // Same style, other library: accepted.
  let p = axisCase('icons.json', 'icons-lucide-outline', (t) => (t.extras.library = 'tabler-like'));
  assert.ok(!p.some((x) => /"icons-lucide-outline"/.test(x.message)), show(p));
  // Same library, only the weight label changes (same stroke): refused.
  p = axisCase('icons.json', 'icons-lucide-outline', (t) => (t.extras.weight = 'bold'));
  assert.match(p.map((x) => x.message).join(), /differs from "icons-lucide-outline" .* only in Weight/);
  // Modes: another default is enough; the same default is a duplicate.
  assert.deepEqual(
    axisCase('modes.json', 'modes-system', (t) => (t.tokens.mode.default.$value = 'auto')),
    []
  );
  p = axisCase('modes.json', 'modes-system', () => {});
  assert.match(p[0].message, /same values as "modes-system" .* must differ in 1 axes/);
  // Task 3.9: the setting is the default AND the switch: the same default without the switch is another setting.
  assert.deepEqual(
    axisCase('modes.json', 'modes-system', (t) => (t.tokens.mode.switch.$value = 'none')),
    []
  );
  p = axisCase('modes.json', 'modes-light-first', (t) => (t.tokens.mode.switch.$value = 'none'));
  assert.match(p.map((x) => x.message).join(), /same values as "modes-light-only" .* on every axis/);
});

test('axes: buttons and cards are compared by their recipe CSS (fill, border, text, corners, shadow) and size', () => {
  let p = axisCase('buttons.json', 'button-solid', (t) => {
    t.recipe.css = t.recipe.css.replace('color:var(--color-on-primary)', 'color:var(--color-on-secondary)');
  });
  assert.match(p.map((x) => x.message).join(), /differs from "button-solid" .* only in Text color/);
  p = axisCase('buttons.json', 'button-solid', (t) => {
    t.recipe.css = t.recipe.css
      .replace('background:var(--color-primary)', 'background:var(--color-secondary)')
      .replace('border:1px solid var(--color-primary)', 'border:1px solid var(--color-secondary)');
  });
  assert.ok(!p.some((x) => /"button-solid"/.test(x.message)), show(p));
  // A hover shadow is part of the shadow axis; the card's CSS padding is the padding axis.
  p = axisCase('cards.json', 'card-bordered', (t) => {
    t.recipe.css += '.hw-card:hover{box-shadow:var(--shadow-lg)}';
    t.recipe.css = t.recipe.css.replace('padding:var(--space-5)', 'padding:var(--space-4)');
  });
  assert.ok(!p.some((x) => /"card-bordered"/.test(x.message)), show(p));
});

test('axes: spacing is compared by unit, smallest and largest step, and number of steps', () => {
  const p = axisCase('spacing.json', 'spacing-comfortable', (t) => {
    t.tokens.spacing.scale['8'].$value.value = 80;
  });
  assert.match(p.map((x) => x.message).join(), /differs from "spacing-comfortable" .* only in Largest step/);
});

// Review of task 3.3: a copy written another way is still a copy.
test('axes: CSS written another way is the same (longhand, word order, split blocks, case)', () => {
  const p = axisCase('buttons.json', 'button-solid', (t) => {
    t.recipe.css = t.recipe.css
      .replace('background:var(--color-primary)', 'background-color:var(--color-primary)')
      .replace('border:1px solid var(--color-primary)', 'border:solid 1px var(--color-primary)')
      .replace('color:var(--color-on-primary)', 'color:var(--color-on-primary)}.hw-btn{color:VAR(--color-on-primary)');
  });
  assert.match(p.map((x) => x.message).join(), /same values as "button-solid" .* on every axis/);
});

test('axes: a rule inside @media is a state, not the base; descendants count for state axes', () => {
  let p = axisCase('buttons.json', 'button-solid', (t) => {
    t.recipe.css += '@media (min-width:1px){.hw-btn{background:var(--color-secondary)}}';
    t.recipe.css = t.recipe.css.replace('color:var(--color-on-primary)', 'color:var(--color-on-secondary)');
  });
  assert.match(p.map((x) => x.message).join(), /differs from "button-solid" .* only in Text color/);
  p = axisCase('buttons.json', 'button-solid', (t) => {
    t.recipe.css += '.hw-btn .hw-icon{box-shadow:var(--shadow-sm)}';
    t.recipe.css = t.recipe.css.replace('color:var(--color-on-primary)', 'color:var(--color-on-secondary)');
  });
  assert.ok(!p.some((x) => /"button-solid"/.test(x.message)), show(p));
});

test('axes: tokens written another way are the same (key order, $description, px or rem, shadow alpha)', () => {
  let p = axisCase('shadows.json', 'shadow-soft', (t) => {
    const layer = t.tokens.shadow.light.md.$value[0];
    t.tokens.shadow.light.md.$value[0] = Object.fromEntries(Object.entries(layer).reverse());
    t.tokens.shadow.light.sm.$value[0].color.alpha += 0.01;
    t.tokens.shadow.light.md.$description = 'Same shadow';
  });
  assert.match(p.map((x) => x.message).join(), /same values as "shadow-soft" .* on every axis/);
  p = axisCase('radius.json', 'radius-medium', (t) => {
    for (const k of ['sm', 'md', 'lg'])
      t.tokens.radius[k].$value = { value: t.tokens.radius[k].$value.value / 16, unit: 'rem' };
  });
  assert.match(p.map((x) => x.message).join(), /same values as "radius-medium" .* on every axis/);
});

test('axes: the button size is its CSS (what is drawn), not an unused token', () => {
  let p = axisCase('buttons.json', 'button-solid', (t) => {
    t.tokens.button.paddingBlock.$value.value = 12;
    t.recipe.css = t.recipe.css.replace('border-radius:var(--radius-md)', 'border-radius:var(--radius-lg)');
  });
  assert.match(p.map((x) => x.message).join(), /differs from "button-solid" .* only in Corners/);
  p = axisCase('buttons.json', 'button-solid', (t) => {
    t.recipe.css = t.recipe.css
      .replace('padding-block:var(--space-2)', 'padding-block:var(--space-3)')
      .replace('border-radius:var(--radius-md)', 'border-radius:var(--radius-lg)');
  });
  assert.ok(!p.some((x) => /"button-solid"/.test(x.message)), show(p));
});

test('axes: one choice is one axis — an added spacing step, a font without Latin, numerals = Arabic family', () => {
  let p = axisCase('spacing.json', 'spacing-comfortable', (t) => {
    t.tokens.spacing.scale['9'] = { $type: 'dimension', $value: { value: 80, unit: 'px' } };
  });
  assert.match(p.map((x) => x.message).join(), /differs from "spacing-comfortable" .* only in Largest step/);
  p = axisCase('fonts.json', 'pair-noto-sans-arabic-noto-sans', (t) => {
    delete t.extras.latin;
    t.extras.languages = ['ar'];
  });
  assert.match(
    p.map((x) => x.message).join(),
    /differs from "pair-noto-sans-arabic-noto-sans" .* only in Latin family/
  );
  p = axisCase('fonts.json', 'pair-plex-arabic-plex-sans', (t) => {
    t.extras.arabic = 'Other Arabic';
    t.extras.numeralsFont = 'Other Arabic';
  });
  assert.match(p.map((x) => x.message).join(), /differs from "pair-plex-arabic-plex-sans" .* only in Arabic family/);
});

test('axes: an exact axis ignores key order and $description', () => {
  const ax = { compare: 'exact' };
  assert.equal(check.same(ax, { a: 1, b: { c: 2, $description: 'x' } }, { b: { c: 2 }, a: 1 }), true);
  assert.equal(check.same(ax, { a: 1 }, { a: 2 }), false);
});

test('axes: comments and @layer / @supports do not hide a copy; @media still is a state', () => {
  for (const wrap of [(c) => `@layer c{${c}}`, (c) => `@supports (display:block){${c}}`, (c) => `/* bordered */${c}`]) {
    const p = axisCase('cards.json', 'card-bordered', (t) => {
      t.recipe.css = wrap(t.recipe.css).replace('.hw-card{', '.hw-card{/* base */');
    });
    assert.match(p.map((x) => x.message).join(), /same values as "card-bordered" .* on every axis/, wrap('x'));
  }
});

test('axes: padding and background written as shorthand or longhands are the same', () => {
  const p = axisCase('cards.json', 'card-bordered', (t) => {
    t.recipe.css = t.recipe.css
      .replace('padding:var(--space-5)', 'padding-block:var(--space-5);padding-inline:var(--space-5)')
      .replace(
        'background:var(--color-surface)',
        'background:var(--color-surface);background-color:var(--color-surface)'
      )
      .replace(
        'border:1px solid var(--color-border)',
        'border-width:1px;border-style:solid;border-color:var(--color-border)'
      );
  });
  assert.match(p.map((x) => x.message).join(), /same values as "card-bordered" .* on every axis/);
});

test('axes: a missing numerals font is the Arabic family; shadow layers in another order are the same', () => {
  let p = axisCase('fonts.json', 'font-noto-kufi-arabic', (t) => {
    delete t.extras.numeralsFont;
    t.extras.latin = 'Inter';
  });
  assert.match(p.map((x) => x.message).join(), /differs from "font-noto-kufi-arabic" .* only in Latin family/);
  p = axisCase('shadows.json', 'shadow-soft', (t) => t.tokens.shadow.light.lg.$value.reverse());
  assert.match(p.map((x) => x.message).join(), /same values as "shadow-soft" .* on every axis/);
});

test('axes: a tolerance includes its edge (1.75 vs 1.7 is within 0.05)', () => {
  const p = axisCase('type-scale.json', 'scale-major-third', (t) => {
    t.tokens.lineHeight.ar.$value = 1.75;
    t.tokens.lineHeight.en.$value = 1.55;
  });
  assert.match(p.map((x) => x.message).join(), /same values as "scale-major-third" .* on every axis/);
});

test('axes.json: missing, unsound, or without an element is a problem; nothing is compared', () => {
  const c = copy();
  try {
    fs.rmSync(path.join(c.lib, 'axes.json'));
    assert.ok(has(c.run().problems, 'axes', undefined, /missing/));
    fs.writeFileSync(path.join(c.lib, 'axes.json'), JSON.stringify({ colors: [] }));
    let r = c.run();
    assert.ok(
      has(r.problems, 'axes', undefined, /must have property "modes"|must NOT have fewer than 1 items/),
      show(r.problems)
    );
    assert.equal(r.counts.comparisons, 0);
    const good = JSON.parse(fs.readFileSync(path.join(LIB, 'axes.json'), 'utf8'));
    good.radius[0].tolerance = undefined;
    delete good.radius[0].tolerance;
    good.icons.push({ id: 'library', name: { ar: 'مكتبة', en: 'Library' }, path: '/extras/library', compare: 'exact' });
    fs.writeFileSync(path.join(c.lib, 'axes.json'), JSON.stringify(good));
    r = c.run();
    assert.ok(has(r.problems, 'axes', 'radius/sm', /tolerance/), show(r.problems));
    assert.ok(has(r.problems, 'axes', 'icons/library', /listed twice/), show(r.problems));
  } finally {
    clean(c);
  }
});

test('usage errors exit 2', () => {
  const out = spawnSync(process.execPath, [TOOL, '--nope'], { encoding: 'utf8' });
  assert.equal(out.status, 2);
  assert.match(out.stderr, /usage:/);
});

// Task 3.8: a heading family or numerals font that is missing, or names the family it falls back to, is no choice.
test('axes: missing or repeated heading / numerals families are the family they fall back to (Latin-only too)', () => {
  // An English pair whose numerals font is its Latin body, written or left out: the same template.
  let p = axisCase('fonts.json', 'pair-en-sora-manrope', (t) => delete t.extras.numeralsFont);
  assert.match(p.map((x) => x.message).join(), /same values as "pair-en-sora-manrope" .* on every axis/);
  // A heading family equal to the body's is no heading family of its own.
  p = axisCase('fonts.json', 'font-noto-kufi-arabic', (t) => (t.extras.headingArabic = 'Noto Kufi Arabic'));
  assert.match(p.map((x) => x.message).join(), /same values as "font-noto-kufi-arabic" .* on every axis/);
  // Only a heading family apart is one axis, even when the other font has no Latin family at all.
  p = axisCase('fonts.json', 'font-inter', (t) => (t.extras.headingLatin = 'Sora'));
  assert.match(p.map((x) => x.message).join(), /differs from "font-inter" .* only in Latin heading family/);
  // And the real library, with its Arabic-only, Latin-only and bilingual pairs, has no axis problem.
  const c = copy();
  try {
    const r = c.run();
    assert.deepEqual(
      r.problems.filter((x) => x.kind === 'axes'),
      []
    );
  } finally {
    clean(c);
  }
});

// Independent review of 3.8: an explicit heading family naming the font another template uses for everything is
// no difference: both draw the same headings.
test('axes: a heading family that resolves to the same font as the other template is no difference', () => {
  const p = axisCase('fonts.json', 'font-noto-kufi-arabic', (t) => {
    t.extras.headingArabic = 'Noto Kufi Arabic';
    t.extras.arabic = 'Tajawal';
    t.extras.numeralsFont = 'Tajawal';
  });
  assert.match(p.map((x) => x.message).join(), /differs from "font-noto-kufi-arabic" .* only in Arabic family;/);
});

// Task 3.13 (R-040): each ready identity is built in Arabic, English and both; the blocking rules and the official
// DESIGN.md check run on what it makes.
test('ready identities: the fourteen of the spec are built in every direction, pass the rules, and lint clean', () => {
  const r = check.check();
  assert.deepEqual(r.problems, [], show(r.problems));
  assert.equal(r.counts.identities, 14);
  assert.equal(r.counts.identitiesBuilt, 14);
  const names = fs
    .readdirSync(path.join(LIB, 'identities'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(LIB, 'identities', f), 'utf8')).name.ar)
    .sort();
  // spec.md, section 10 items 10 and 12 (CHG-3).
  const SPEC = [
    'مؤسسي هادئ',
    'بسيط أبيض',
    'داكن تقني',
    'ودود ناعم',
    'مرح ملوّن',
    'فاخر',
    'تحريري',
    'بروتالي',
    'حكومي رسمي',
    'عربي تراثي',
    'كلاسيكي نسخي',
    'صحي نقي',
    'مالي رصين',
    'طبيعي ترابي'
  ];
  assert.deepEqual(names, SPEC.slice().sort());
});

test('a ready identity blocked in one language only is found, with the rule, the element and the language', () => {
  const c = copy();
  try {
    // An Arabic-only font: fine in Arabic, blocked in English and in both. The copy's page data is rebuilt, so only
    // the identity problems are left (the build publishes what is reviewed; the rules are the check's).
    c.edit('identities/luxury.json', (v) => {
      v.templates.fonts = 'pair-ar-amiri-noto-naskh-arabic';
    });
    build.build({ libraryDir: c.lib, outDir: c.data });
    const p = c.run().problems;
    assert.ok(has(p, 'identity', 'luxury', /^in English, the font-language rule blocks fonts/), show(p));
    assert.ok(has(p, 'identity', 'luxury', /^in Arabic and English, the font-language rule blocks fonts/), show(p));
    assert.ok(has(p, 'identity', 'luxury', /^in English, the font-language rule blocks fonts \(body font\)/), show(p));
    // Never in Arabic, and nothing else is found.
    assert.ok(
      p.every(
        (x) => x.kind === 'identity' && x.template === 'luxury' && /^in (English|Arabic and English), /.test(x.message)
      ),
      show(p)
    );
  } finally {
    clean(c);
  }
});

test('the official DESIGN.md check runs for many files at once and reports errors and warnings', () => {
  const [bad, good] = check.lintDesignMd([
    '# Only a title',
    require('../picker/js/core/generate.js').designMd(
      require('../picker/js/core/resolve.js').resolve(
        {
          name: 'x',
          selections: Object.fromEntries(
            build.ELEMENTS.map((e) => [
              e,
              {
                template: JSON.parse(fs.readFileSync(path.join(LIB, 'identities/calm-corporate.json'), 'utf8'))
                  .templates[e]
              }
            ])
          )
        },
        { templates: build.load(LIB).templates }
      )
    )
  ]);
  assert.ok(bad.summary.errors + bad.summary.warnings > 0, JSON.stringify(bad));
  assert.ok(bad.findings.length > 0);
  assert.deepEqual([good.summary.errors, good.summary.warnings], [0, 0], JSON.stringify(good.findings));
});

// Task 4.1 (R-001): SKILL.md stays under 150 lines and names the reference files, which exist.
test('SKILL.md: under 150 lines, its three reference files exist and are named; each break is reported', () => {
  const real = check.skillProblems(ROOT);
  assert.deepEqual(real.problems, []);
  assert.ok(real.lines > 50 && real.lines < 150, String(real.lines));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hawiya-skill-'));
  try {
    fs.cpSync(path.join(ROOT, 'references'), path.join(dir, 'references'), { recursive: true });
    const skill = fs.readFileSync(path.join(ROOT, 'SKILL.md'), 'utf8');
    const write = (text) => fs.writeFileSync(path.join(dir, 'SKILL.md'), text);
    const messages = () => check.skillProblems(dir).problems.map((p) => p.join(': '));

    write(skill);
    assert.deepEqual(messages(), []);
    // 149 lines pass, 150 do not.
    write(
      'x\n'.repeat(149) +
        skill
          .split('\n')
          .filter((l) => l.includes('references/'))
          .join(' ')
    );
    assert.deepEqual(check.skillProblems(dir).lines, 150);
    assert.deepEqual(messages(), ['SKILL.md: 150 lines: it must stay under 150']);
    write(
      skill
        .split('\n')
        .filter((l) => l.includes('references/'))
        .join(' ') +
        '\n' +
        'x\n'.repeat(148)
    );
    assert.deepEqual([check.skillProblems(dir).lines, messages()], [149, []]);
    // A reference the skill never names, a missing one, an empty one.
    write(skill.replaceAll('references/platforms.md', 'the platforms file'));
    assert.deepEqual(messages(), ['SKILL.md: never names references/platforms.md, so the agent would not read it']);
    write(skill);
    fs.rmSync(path.join(dir, 'references', 'export-format.md'));
    fs.writeFileSync(path.join(dir, 'references', 'project-detection.md'), '\n');
    assert.deepEqual(messages(), ['references/project-detection.md: empty', 'references/export-format.md: missing']);
    fs.rmSync(path.join(dir, 'SKILL.md'));
    assert.deepEqual(messages(), ['SKILL.md: missing']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  // The check command reports it like any other problem.
  const broken = spawnSync(
    process.execPath,
    [
      '-e',
      `process.exitCode = require(${JSON.stringify(TOOL)}).report(require(${JSON.stringify(TOOL)}).check({ skillDir: ${JSON.stringify(os.tmpdir())} })).includes('[skill] SKILL.md: missing') ? 0 : 1`
    ],
    { encoding: 'utf8' }
  );
  assert.equal(broken.status, 0, broken.stderr);
});

// Task 4.1 (R-002, R-003): the session example in SKILL.md is one the page and the server accept, and its
// element list is exactly the eleven web elements of references/platforms.md, in order.
test('SKILL.md: the session file example passes the session schema and lists the eleven web elements', () => {
  const validate = require('../picker/js/core/validate.js');
  const skill = fs.readFileSync(path.join(ROOT, 'SKILL.md'), 'utf8');
  const example = /## Step 3[\s\S]*?```json\n([\s\S]*?)```/.exec(skill)[1];
  const result = validate.checkText('session', example);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
  const session = JSON.parse(example);
  assert.deepEqual(session.elements, build.ELEMENTS);
  assert.equal(session.platform, 'web');
  const table = fs.readFileSync(path.join(ROOT, 'references', 'platforms.md'), 'utf8');
  assert.deepEqual(
    [...table.matchAll(/^\| [^|]+ \| `([a-z-]+)` \| yes \|$/gm)].map((m) => m[1]),
    build.ELEMENTS
  );
  // The tags the references suggest are all valid tags.
  const detection = fs.readFileSync(path.join(ROOT, 'references', 'project-detection.md'), 'utf8');
  const tags = JSON.parse(fs.readFileSync(path.join(LIB, 'tags.json'), 'utf8')).map((t) => t.id);
  const suggested = [...detection.matchAll(/^\| `[a-z-]+` \| ([a-z, -]+) \|$/gm)].flatMap((m) => m[1].split(', '));
  assert.ok(suggested.length >= 5);
  assert.deepEqual(
    suggested.filter((t) => !tags.includes(t)),
    []
  );
});

// Task 5.1 (B-078): the fonts list of a source is a list of distinct names. The error is on the list itself (an
// unknown field would be reported on the source, so these fail without the "fonts" shape in notices.js).
test('sources.json: a fonts list that is empty, names a font twice, or is not a list is refused', () => {
  for (const [fonts, re] of [
    [[], /^\/\d+\/fonts must have at least 1 items/],
    [['Cairo', 'Cairo'], /^\/\d+\/fonts must not have duplicate items/],
    ['Cairo', /^\/\d+\/fonts must be array/]
  ]) {
    const c = copy();
    try {
      c.edit('sources.json', (l) => void (l.find((x) => x.id === 'cairo').fonts = fonts));
      const r = c.run();
      assert.ok(has(r.problems, 'license', null, re), `${JSON.stringify(fonts)}:\n${show(r.problems)}`);
    } finally {
      clean(c);
    }
  }
});

// Task 5.1 (B-078): each family the page loads (the five extras names) is checked; system fonts and generic
// families are not fonts with a source; two sources may not list one font, whatever its letter case.
test('fonts: every extras family is checked; system fonts are exempt; a font listed twice in any case is found', () => {
  for (const key of ['arabic', 'latin', 'numeralsFont', 'headingArabic', 'headingLatin']) {
    const c = copy();
    try {
      c.edit('elements/fonts.json', (l) => void (c.find(l, 'pair-tajawal-manrope').extras[key] = 'Merriweather'));
      const r = c.run();
      assert.ok(
        has(r.problems, 'license', 'pair-tajawal-manrope', /font "Merriweather" is listed by no source/),
        `${key}:\n${show(r.problems)}`
      );
    } finally {
      clean(c);
    }
  }
  const c = copy();
  try {
    c.edit('elements/fonts.json', (l) => {
      const stack = c.find(l, 'pair-rubik').tokens.font.body.$value;
      stack.splice(1, 0, '-apple-system', 'BlinkMacSystemFont', 'Segoe UI Emoji', 'ui-sans-serif');
    });
    c.edit('sources.json', (l) => void l.find((x) => x.id === 'onest').fonts.push('cairo'));
    const r = c.run();
    assert.ok(!r.problems.some((p) => p.template === 'pair-rubik'), show(r.problems));
    assert.ok(has(r.problems, 'license', 'onest', /font "cairo" is also listed by "cairo"/), show(r.problems));
  } finally {
    clean(c);
  }
});

// Task 5.1 (B-079): a ready identity that uses a draft is left out of the page. The check passes while the owner
// still reviews (task 5.4 before 5.6), but names it; with --publish (the GitHub check before publishing) it fails.
test('an identity waiting for a draft is named; --publish refuses it', () => {
  const c = copy();
  try {
    c.edit('elements/icons.json', (l) => void (c.find(l, 'icons-phosphor-thin').status = { state: 'draft' }));
    build.build({ libraryDir: c.lib, outDir: c.data });
    const r = c.run();
    assert.deepEqual(r.problems, [], show(r.problems));
    const luxury = r.leftOut.find((x) => x.id === 'luxury');
    assert.ok(luxury, JSON.stringify(r.leftOut));
    assert.deepEqual(luxury.reasons, ['icons: "icons-phosphor-thin" is a draft']);
    const text = check.report(r);
    assert.match(
      text,
      /left out of the page until reviewed: (.*, )?luxury \(icons: "icons-phosphor-thin" is a draft\)/
    );
    assert.match(text, /هوية لا تظهر في الصفحة حتى تُراجَع مسوداتها: (.*، )?luxury/);

    const strict = c.run({ publish: true });
    assert.ok(has(strict.problems, 'identity', 'luxury', /is a draft.*publishing/), show(strict.problems));
    assert.equal(strict.problems.length, r.leftOut.length, show(strict.problems));

    const plain = spawnSync(process.execPath, [TOOL, ...c.args], { encoding: 'utf8' });
    assert.equal(plain.status, 0, plain.stderr);
    const pub = spawnSync(process.execPath, [TOOL, ...c.args, '--publish'], { encoding: 'utf8' });
    assert.equal(pub.status, 1, pub.stdout);
    assert.match(pub.stderr, /\[identity\] identities\/luxury\.json › luxury: .*is a draft/);
  } finally {
    clean(c);
  }
});
