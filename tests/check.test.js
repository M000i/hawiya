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
  const edit = (rel, fn) => {
    const file = path.join(lib, rel);
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    const out = fn(value);
    fs.writeFileSync(file, JSON.stringify(out === undefined ? value : out, null, 2) + '\n');
  };
  const find = (list, id) => list.find((t) => t.id === id);
  return { dir, lib, data, edit, find, run: () => check.check({ libraryDir: lib, dataDir: data }) };
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
    const out = spawnSync(process.execPath, [TOOL, '--library', c.lib, '--data', c.data], { encoding: 'utf8' });
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stdout, /نجاح: فُحص 37 تمبلت/);
    assert.match(out.stdout, /success: 37 templates/);
  } finally {
    clean(c);
  }
});

// One library with a problem of every kind; each is found and named by its template (or file).
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
    const r = c.run();
    for (const [kind, template, , re] of CASES) {
      assert.ok(has(r.problems, kind, template, re), `missing [${kind}] ${template}:\n${show(r.problems)}`);
    }
    assert.deepEqual(
      check.KINDS.filter((k) => k !== 'data' && !r.problems.some((p) => p.kind === k)),
      [],
      'every kind but data (checked once the library is sound) is represented'
    );
    assert.equal(r.dataChecked, false);
    const out = spawnSync(process.execPath, [TOOL, '--library', c.lib, '--data', c.data], { encoding: 'utf8' });
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
    c.edit('elements/radius.json', (l) => {
      const t = c.find(l, 'radius-sharp');
      t.status = { state: 'draft' };
      t.recipe = undefined;
      t.tokens.radius.sm.$value.unit = 'pt';
    });
    const r = c.run();
    assert.ok(has(r.problems, 'tokens', 'radius-sharp', /unit/), show(r.problems));
    assert.equal(r.counts.drafts, 1);
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

test('usage errors exit 2', () => {
  const out = spawnSync(process.execPath, [TOOL, '--nope'], { encoding: 'utf8' });
  assert.equal(out.status, 2);
  assert.match(out.stderr, /usage:/);
});
