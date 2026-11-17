// Task 3.11 (R-048): every button of the library, drafts too, drawn from its recipe in the colors of a real identity,
// in its four states (hover, pressed, keyboard focus, disabled): each state shows, and nothing errors.
'use strict';
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const build = require('../../tools/build.js');
const resolve = require('../../picker/js/core/resolve.js');
const generate = require('../../picker/js/core/generate.js');

const buttons = JSON.parse(fs.readFileSync(path.join(ROOT, 'library/elements/buttons.json'), 'utf8'));
const data = build.select(build.load(path.join(ROOT, 'library'))).data;
const ready = data.identities.find((i) => i.id === 'calm-corporate');
const selections = {};
for (const e of resolve.ELEMENTS) selections[e] = { template: ready.templates[e] };
const identity = resolve.resolve({ name: 'test', selections }, data);
// The identity's variables (colors, shadows, radii, spaces, fonts, sizes) as tokens.css gives them.
const vars = generate.valueFiles(identity)['tokens.css'];

const PROPS = [
  'background-color',
  'color',
  'border-color',
  'border-style',
  'box-shadow',
  'transform',
  'text-decoration-thickness',
  'opacity',
  'outline-style',
  'outline-width',
  'cursor'
];

test('every button shows hover, pressed, keyboard focus and disabled states, without errors', async ({ page }) => {
  test.setTimeout(120000);
  expect(buttons.length).toBeGreaterThanOrEqual(22);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  for (const b of buttons) {
    const html = b.recipe.html.replace('{label}', 'ابدأ الآن');
    await page.setContent(
      `<!doctype html><html lang="ar" dir="rtl"><head><style>${vars}\n${b.recipe.css}\n/* the states themselves, not their animation */ *{transition-duration:0s!important}</style></head><body style="padding:24px;background:var(--color-background)">${html}</body></html>`
    );
    const read = () =>
      page.evaluate((props) => {
        const s = getComputedStyle(document.querySelector('.hw-btn'));
        return Object.fromEntries(props.map((p) => [p, s.getPropertyValue(p)]));
      }, PROPS);
    const { root } = await cdp.send('DOM.getDocument');
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '.hw-btn' });
    const force = (states) => cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: states });
    const base = await read();
    const changed = (s) => PROPS.filter((p) => s[p] !== base[p]);
    await force(['hover']);
    const hover = changed(await read());
    await force(['active']);
    const active = changed(await read());
    await force(['focus', 'focus-visible']);
    const focus = await read();
    await force([]);
    await page.evaluate(() => document.querySelector('.hw-btn').setAttribute('disabled', ''));
    const disabled = await read();
    expect([b.id, hover.length > 0]).toEqual([b.id, true]);
    expect([b.id, active.length > 0]).toEqual([b.id, true]);
    expect([b.id, focus['outline-style'], focus['outline-width']]).toEqual([b.id, 'solid', '2px']);
    expect([b.id, disabled.opacity, disabled.cursor]).toEqual([b.id, '0.5', 'not-allowed']);
  }
  expect(errors).toEqual([]);
});
