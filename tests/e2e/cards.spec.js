// Task 3.12 (R-049): every card of the library, drafts too, drawn from its recipe in the colors of a real identity,
// in the four states (Arabic and English, light and dark), at the narrowest width the landing scene gives a card:
// nothing errors, nothing overflows, the colors are the identity's for that mode, and a side edge follows the direction.
'use strict';
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const build = require('../../tools/build.js');
const resolve = require('../../picker/js/core/resolve.js');
const generate = require('../../picker/js/core/generate.js');

const cards = JSON.parse(fs.readFileSync(path.join(ROOT, 'library/elements/cards.json'), 'utf8'));
const data = build.select(build.load(path.join(ROOT, 'library'))).data;
const ready = data.identities.find((i) => i.id === 'calm-corporate');
const selections = {};
for (const e of resolve.ELEMENTS) selections[e] = { template: ready.templates[e] };
const identity = resolve.resolve({ name: 'test', selections }, data);
const vars = generate.valueFiles(identity)['tokens.css'];

// The landing scene's longest card text in each language (picker/scenes/landing.js).
const TEXT = {
  ar: ['تعاون بلا فوضى', 'التعليقات والملفات في مكانها، والجميع يرى آخر نسخة.'],
  en: ['Calm teamwork', 'Comments and files stay in place, and everyone sees the latest version.']
};
const STATES = [
  ['ar', 'light'],
  ['ar', 'dark'],
  ['en', 'light'],
  ['en', 'dark']
];
// The color a recipe declaration names, as the browser computes it ("var(--color-surface)" → "rgb(...)").
const declared = (css, selector, prop) => {
  const m = new RegExp(`(?:^|})${selector.replace('.', '\\.')}\\{(?:[^}]*;)?${prop}:([^;}]+)`).exec(css);
  return m ? m[1] : null;
};

test('every card in Arabic and English, light and dark: no errors, no overflow, identity colors, edges follow the direction', async ({
  page
}) => {
  test.setTimeout(120000);
  expect(cards.length).toBeGreaterThanOrEqual(22);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  for (const c of cards) {
    const fill = declared(c.recipe.css, '.hw-card', 'background');
    const title = declared(c.recipe.css, '.hw-card-title', 'color');
    const seen = {};
    for (const [lang, mode] of STATES) {
      const [t, b] = TEXT[lang];
      const html = c.recipe.html.replace('{title}', t).replace('{body}', b);
      await page.setContent(
        `<!doctype html><html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}" data-theme="${mode}"><head><style>${vars}\n${c.recipe.css}</style></head>` +
          `<body style="margin:0;padding:24px;background:var(--color-background)"><div id="cell" style="inline-size:12rem">${html}</div>` +
          `<div id="probe-fill" style="background:${fill}"></div><div id="probe-title" style="color:${title}"></div></body></html>`
      );
      const got = await page.evaluate(() => {
        const card = document.querySelector('.hw-card');
        const cell = document.getElementById('cell').getBoundingClientRect();
        const r = card.getBoundingClientRect();
        const s = getComputedStyle(card);
        const inside = [...card.querySelectorAll('*')].every((n) => {
          const k = n.getBoundingClientRect();
          return k.left >= r.left - 0.5 && k.right <= r.right + 0.5;
        });
        return {
          direction: s.direction,
          fits: r.left >= cell.left - 0.5 && r.right <= cell.right + 0.5 && card.scrollWidth <= card.clientWidth + 1,
          inside,
          pageScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          fill: s.backgroundColor,
          title: getComputedStyle(card.querySelector('.hw-card-title')).color,
          wantFill: getComputedStyle(document.getElementById('probe-fill')).backgroundColor,
          wantTitle: getComputedStyle(document.getElementById('probe-title')).color,
          left: s.borderLeftWidth,
          right: s.borderRightWidth,
          text: card.textContent
        };
      });
      const where = `${c.id} ${lang} ${mode}`;
      expect([where, got.direction]).toEqual([where, lang === 'ar' ? 'rtl' : 'ltr']);
      expect([where, got.fits, got.inside, got.pageScroll]).toEqual([where, true, true, false]);
      expect([where, got.text]).toEqual([where, t + b]);
      // The card's fill and title are the identity's colors for this mode.
      expect([where, got.fill]).toEqual([where, got.wantFill]);
      expect([where, got.title]).toEqual([where, got.wantTitle]);
      // An inline-start edge is on the right in Arabic and on the left in English.
      if (/border-inline-start:/.test(c.recipe.css)) {
        const [start, end] = lang === 'ar' ? [got.right, got.left] : [got.left, got.right];
        expect([where, parseFloat(start) > parseFloat(end)]).toEqual([where, true]);
      }
      seen[mode] = got;
    }
    // Light and dark differ: the title color always changes with the mode (on-surface, on-primary, ...).
    expect([c.id, seen.light.title !== seen.dark.title || seen.light.fill !== seen.dark.fill]).toEqual([c.id, true]);
  }
  expect(errors).toEqual([]);
});
