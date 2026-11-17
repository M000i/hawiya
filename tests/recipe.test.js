'use strict';

/*
 * Button and card recipes (gate 2 review): only an allow-listed recipe is published, offered or drawn, and every text
 * color a recipe puts on a fill, in every state (hover, focus, ...), is a pair the contrast rule checks.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const recipe = require('../picker/js/core/recipe.js');
const rules = require('../picker/js/core/rules.js');
const build = require('../tools/build.js');
const check = require('../tools/check.js');

const LIB = path.join(__dirname, '..', 'library');
const data = build.select(build.load(LIB)).data;
const COMPOSITE = data.templates.buttons.concat(data.templates.cards);
const AR = { language: 'ar', direction: 'rtl', platform: 'web', type: 'web-app', contrast: 'AA' };
const base = data.templates.buttons[0];
const withRecipe = (html, css) => ({
  ...base,
  id: 'hostile',
  recipe: { html, css: css === undefined ? base.recipe.css : css }
});

test('every published recipe passes the allow-list', () => {
  for (const t of COMPOSITE) assert.deepEqual(recipe.check(t.recipe), [], t.id);
});

const HOSTILE_HTML = [
  '<button class="hw-btn" type="button">{label}<img src="x"/onerror="alert(1)" hidden></button>',
  '<button class="hw-btn" onerror = "alert(1)">{label}</button>',
  '<button class="hw-btn" onclick="alert(1)">{label}</button>',
  '<button class="hw-btn"><script>alert(1)</script>{label}</button>',
  '<button class="hw-btn"><style>.hw-btn{letter-spacing:3px}</style>{label}</button>',
  '<button class="hw-btn" style="letter-spacing:3px">{label}</button>',
  '<button/style="letter-spacing:3px">{label}</button>',
  '<button class="hw-btn" title="letter&#45;spacing">{label}</button>',
  '<button class="hw-btn"><!-- x -->{label}</button>',
  '<a href="javascript:alert(1)">{label}</a>',
  '<button class="hw-btn"><i>{label}</i></button>',
  '<button class=hw-btn>{label}</button>',
  '<svg><text letter-spacing="4">{label}</text></svg>',
  '<iframe src="https://example.invalid"></iframe>'
];
const HOSTILE_CSS = [
  '.hw-btn{background-image:url(https://example.invalid/t.png)}',
  '@import "https://example.invalid/x.css";',
  '.hw-btn{\\6c etter-spacing:2px}',
  '.hw-btn{text-transform:\\75 ppercase}',
  ':host{position:fixed;inset:0}',
  '.hw-btn{background:image-set("x.png" 1x)}'
];

test('hostile or typography-breaking recipes are refused by the check and blocked by the rules', () => {
  for (const html of HOSTILE_HTML) {
    assert.notDeepEqual(recipe.check({ html, css: '' }), [], html);
    assert.ok(
      rules.template(withRecipe(html), AR).some((p) => p.rule === 'recipe' || p.rule === 'arabic-typography'),
      html
    );
    assert.equal(rules.allowed(withRecipe(html), AR), false, html);
  }
  for (const css of HOSTILE_CSS) {
    assert.notDeepEqual(recipe.check({ html: '<button class="hw-btn">{label}</button>', css }), [], css);
    assert.equal(rules.allowed(withRecipe(base.recipe.html, css), AR), false, css);
  }
});

test('small capitals or italics through font-feature-settings break the Arabic typography rule', () => {
  for (const css of ['.hw-btn{font-feature-settings:"smcp" 1}', '.hw-btn{font-feature-settings:"ital" 1}']) {
    const problems = rules.template(withRecipe(base.recipe.html, css), AR);
    assert.ok(
      problems.some((p) => p.rule === 'arabic-typography'),
      css
    );
  }
});

test('the build refuses a library whose recipe is outside the allow-list; nothing is written', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hawiya-recipe-'));
  try {
    fs.cpSync(LIB, path.join(dir, 'library'), { recursive: true });
    const file = path.join(dir, 'library', 'elements', 'buttons.json');
    const list = JSON.parse(fs.readFileSync(file, 'utf8'));
    list[0].recipe.html = HOSTILE_HTML[0];
    fs.writeFileSync(file, JSON.stringify(list, null, 2) + '\n');
    const out = path.join(dir, 'out');
    assert.throws(
      () => build.build({ libraryDir: path.join(dir, 'library'), outDir: out }),
      (e) => e instanceof build.LibraryError && /recipe html not allowed/.test((e.problems || []).join('\n'))
    );
    assert.equal(fs.existsSync(out), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* ---------- colors in every state ---------- */

// Task 3.14: read by the check's own reader (tools/check.js recipePairs), which follows the recipe HTML (a title on its
// card's fill, a header with its own fill) and the cascade in every combination of states; the simple reader this
// test had took every element alone, so a title on a filled card read as text on a transparent fill.
test('every text color a recipe puts on a fill, in every state, is a pair the contrast rule checks', () => {
  let pairs = 0;
  for (const t of COMPOSITE) {
    const r = check.recipePairs(t.recipe.html, t.recipe.css);
    assert.deepEqual(r.problems, [], t.id);
    pairs += r.pairs;
  }
  assert.ok(pairs >= COMPOSITE.length * 2, `pairs ${pairs}`);
  // The solid button's hover keeps its fill (it once switched to the 700 step, which failed in dark mode).
  const solid = COMPOSITE.find((t) => t.id === 'button-solid');
  assert.doesNotMatch(solid.recipe.css, /primary-[0-9]{2,3}/);
});
