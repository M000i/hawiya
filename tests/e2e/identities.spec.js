// Task 2.8 (R-020): the first screen shows the ready identities, each in Arabic and English; one click fills
// every element with a complete identity that passes the checker, and the preview follows.
'use strict';
const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const PAGE = pathToFileURL(path.join(__dirname, '../../picker/index.html')).href;
const ELEMENTS = [
  'colors',
  'modes',
  'fonts',
  'type-scale',
  'radius',
  'shadows',
  'icons',
  'buttons',
  'cards',
  'spacing',
  'direction'
];

function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}
const rgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
const library = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.Hawiya.data.identities)));

test('the first thing shown is the ready identity cards, each with its Arabic and English name', async ({ page }) => {
  for (const viewport of [
    { width: 1200, height: 800 },
    { width: 375, height: 800 }
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(PAGE);
    const ready = await library(page);
    const cards = page.locator('#identity-list [data-identity]');
    await expect(cards).toHaveCount(ready.length);
    // First block of the choices, and visible without scrolling.
    const first = await page.evaluate(() =>
      document.querySelector('#controls > .group').contains(document.getElementById('identity-list'))
    );
    expect(first).toBe(true);
    const top = await cards.first().boundingBox();
    expect(top.y + top.height).toBeLessThan(viewport.height);

    for (const lang of ['ar', 'en']) {
      for (const r of ready) {
        const card = page.locator(`[data-identity="${r.id}"]`);
        await expect(card.locator('.identity-name')).toHaveText(r.name.ar);
        await expect(card.locator('.identity-name')).toHaveAttribute('lang', 'ar');
        await expect(card.locator('.identity-name-en')).toHaveText(r.name.en);
        await expect(card.locator('.identity-name-en')).toHaveAttribute('lang', 'en');
        if (r.description) await expect(card.locator('.identity-desc')).toHaveText(r.description[lang]);
      }
      if (lang === 'ar') await page.locator('#lang-toggle').click();
    }
    await page.evaluate(() => localStorage.clear());
  }
});

test('one click fills all elements with a complete, valid identity and the preview follows', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(PAGE);
  await page.locator('[data-preview-mode="light"]').click();
  const ready = await library(page);
  for (const r of [...ready].reverse()) {
    await page.locator(`[data-identity="${r.id}"]`).click();
    const result = await page.evaluate(() => {
      const id = window.Hawiya.state.identity();
      return { id, verdict: window.Hawiya.validate.check('identity', id) };
    });
    expect(result.verdict.valid, JSON.stringify(result.verdict.errors)).toBe(true);
    expect(Object.keys(result.id.selections)).toEqual(ELEMENTS);
    for (const e of ELEMENTS) expect(result.id.selections[e]).toEqual({ template: r.templates[e] });
    await expect(page.locator(`[data-identity="${r.id}"]`)).toHaveAttribute('aria-pressed', 'true');
    for (const o of ready.filter((x) => x.id !== r.id)) {
      await expect(page.locator(`[data-identity="${o.id}"]`)).toHaveAttribute('aria-pressed', 'false');
    }
    // The preview shows this identity: its button corners and fill.
    const scene = await page.evaluate(() => {
      const b = document.getElementById('preview').shadowRoot.querySelector('.hw-btn');
      const cs = getComputedStyle(b);
      return { radius: cs.borderTopLeftRadius, fill: cs.backgroundColor, outline: cs.borderTopColor };
    });
    expect(scene.radius).toBe(`${result.id.tokens.radius.md}px`);
    const light = result.id.tokens.color.light;
    expect([scene.fill, scene.outline]).toContain(
      rgb(r.templates.buttons === 'button-solid' ? light.primary : light.surface)
    );
    // The prototype controls follow too.
    await expect(page.locator(`#fonts input[value="${r.templates.fonts}"]`)).toBeChecked();
  }
  expect(errors).toEqual([]);
});

test('one click gives a valid exported file', async ({ page }) => {
  await page.goto(PAGE);
  await page.locator('[data-identity="warm-friendly"]').click();
  await page.locator('#export-btn').click();
  await expect(page.locator('html')).toHaveAttribute('data-hawiya-export', 'ready');
  const name = await page.evaluate(() => JSON.parse(window.hawiyaExport.files['identity.json']).name);
  expect(name).toBe('ودود دافئ');
});

test('adjustments are cleared by a click; a name the user typed is kept', async ({ page }) => {
  await page.goto(PAGE);
  const calm = page.locator('[data-identity="calm-corporate"]');
  await expect(calm).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#radius-input').fill('22');
  await expect(calm).toHaveAttribute('aria-pressed', 'false');
  await calm.click();
  await expect(calm).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => window.Hawiya.state.choices().selections.radius)).toEqual({
    template: 'radius-medium'
  });

  // The default name follows the identity picked…
  await page.locator('[data-identity="warm-friendly"]').click();
  await expect(page.locator('#identity-name')).toHaveValue('ودود دافئ');
  // …but a name the user typed is theirs.
  await page.locator('#identity-name').fill('متجر الورد');
  await calm.click();
  await expect(page.locator('#identity-name')).toHaveValue('متجر الورد');
  // The choice is saved as the draft like any other.
  await page.reload();
  await expect(calm).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#identity-name')).toHaveValue('متجر الورد');
});
