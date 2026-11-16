// Gate 2 review fixes: what the user chose survives a reload and is never replaced by «fill the rest»; an old
// refusal never brings back old choices; an export says which elements the user did not decide; a refused quick
// color shows the identity again; a library recipe outside the allow-list never runs in the page.
'use strict';
const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const PAGE = pathToFileURL(path.join(__dirname, '../../picker/index.html')).href;
const ELEMENTS = require('../../picker/js/core/resolve.js').ELEMENTS;

async function start(page) {
  await page.route('https://fonts.googleapis.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '' })
  );
  await page.goto(PAGE);
}
async function pick(page, element, id) {
  const toggle = page.locator(`[data-element="${element}"] > .g-toggle`);
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await page.locator(`#g-panel-${element} [data-template="${id}"]`).click();
}
const state = (page) =>
  page.evaluate(() => ({ chosen: window.Hawiya.state.chosen(), identity: window.Hawiya.state.identity() }));

test('picks equal to the starting point stay the user’s after a reload; «fill the rest» keeps them', async ({
  page
}) => {
  await start(page);
  await pick(page, 'radius', 'radius-sharp');
  await pick(page, 'icons', 'icons-lucide-outline'); // the starting point's icons, picked on purpose
  await pick(page, 'shadows', 'shadow-soft'); // the starting point's shadows, picked on purpose
  await pick(page, 'fonts', 'pair-cairo');
  const chosen = ['fonts', 'radius', 'shadows', 'icons'];
  expect((await state(page)).chosen).toEqual(chosen);
  await page.reload();
  expect((await state(page)).chosen).toEqual(chosen);
  await page.locator('#autofill-btn').click();
  await expect
    .poll(async () => (await state(page)).identity.autoFilled)
    .toEqual(ELEMENTS.filter((e) => !chosen.includes(e)));
  const s = await state(page);
  expect(s.identity.selections.icons.template).toBe('icons-lucide-outline');
  expect(s.identity.selections.shadows.template).toBe('shadow-soft');
  expect(s.chosen).toEqual(chosen);
});

test('a ready identity stays wholly the user’s after a reload (no «fill the rest» box)', async ({ page }) => {
  await start(page);
  await page.locator('[data-identity="warm-friendly"]').click();
  await page.reload();
  expect((await state(page)).chosen).toEqual(ELEMENTS);
  await expect(page.locator('#autofill')).toBeHidden();
});

test('opening a saved identity clears an old refusal, so «apply suggestion» cannot bring back old choices', async ({
  page
}) => {
  await start(page);
  await page.locator('[data-identity="warm-friendly"]').click();
  await page.locator('#identity-name').fill('Saved-A');
  await page.locator('#save-new-btn').click();
  await page.locator('[data-identity="calm-corporate"]').click();
  await page.locator('#identity-name').fill('Work-B');
  await page.locator('[data-element="colors"] > .g-toggle').click();
  await page.locator('[data-contrast-level="AAA"]').click();
  await expect(page.locator('#rules [data-rules-block]')).toBeVisible();
  // Open Saved-A from the list.
  await page.locator('#saved-list li', { hasText: 'Saved-A' }).locator('[data-open]').click();
  await expect(page.locator('#rules [data-rules-block]')).toHaveCount(0);
  expect((await state(page)).identity.name).toBe('Saved-A');
  expect((await state(page)).identity.selections.buttons.template).toBe('button-soft');
});

test('an export before every decision is made lists what the user did not decide', async ({ page }) => {
  await start(page);
  await pick(page, 'colors', 'palette-rose');
  await page.locator('#export-btn').click();
  await expect(page.locator('html')).toHaveAttribute('data-hawiya-export', 'ready');
  const files = await page.evaluate(() => window.hawiyaExport.files);
  const exported = JSON.parse(files['identity.json']);
  expect(exported.autoFilled).toEqual(ELEMENTS.filter((e) => e !== 'colors'));
  expect(files['DESIGN.md']).toContain('Filled in automatically');
});

test('a refused quick color: after «Close» the quick swatches show the identity’s color again', async ({ page }) => {
  await start(page);
  await page.locator('[data-element="colors"] > .g-toggle').click();
  await page.locator('[data-contrast-level="AAA"]').click();
  await page.locator('#rules [data-rules-apply]').click();
  const primary = (await state(page)).identity.tokens.color.light.primary;
  await page.locator('#swatches .swatch').nth(2).click(); // violet: refused at AAA
  await expect(page.locator('#rules [data-rules-block]')).toBeVisible();
  await page.locator('#rules [data-rules-dismiss]').click();
  expect((await state(page)).identity.tokens.color.light.primary).toBe(primary);
  const checked = await page.locator('#swatches input:checked').count();
  const violet = await page.locator('#swatches input').nth(2).isChecked();
  expect(violet).toBe(false);
  expect(checked).toBeLessThanOrEqual(1);
  await expect(page.locator('#color-input')).toHaveValue(primary);
});

test('a recipe outside the allow-list never runs: no handler, no image, only a plain label', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await start(page);
  const out = await page.evaluate(async () => {
    const H = window.Hawiya;
    const hostile = [
      '<button class="hw-btn" type="button">{label}<img src="x"/onerror="window.__pwned=1" hidden></button>',
      '<button class="hw-btn" onclick="window.__pwned=2">{label}</button>',
      '<button class="hw-btn"><style>*{letter-spacing:3px}</style>{label}</button>'
    ];
    const drawn = hostile.map((html) => {
      const node = H.preview.fromRecipe({ html, css: '' }, { label: 'L' });
      document.body.appendChild(node);
      return node.outerHTML;
    });
    // An allowed recipe keeps only allowed tags and attributes.
    const ok = H.preview.fromRecipe(
      { html: '<button class="hw-btn" type="button" aria-label="x">{label}</button>', css: '' },
      { label: '<b>L</b>' }
    ).outerHTML;
    await new Promise((r) => setTimeout(r, 300));
    return { drawn, ok, pwned: window.__pwned || 0, images: document.querySelectorAll('img').length };
  });
  expect(out.pwned).toBe(0);
  expect(out.images).toBe(0);
  expect(out.drawn).toEqual(['<span>L</span>', '<span>L</span>', '<span>L</span>']);
  expect(out.ok).toBe('<button class="hw-btn" type="button" aria-label="x">&lt;b&gt;L&lt;/b&gt;</button>');
  expect(errors).toEqual([]);
});
