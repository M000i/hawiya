// Task 2.10 (R-041, R-023): one typed color (or a ready palette) generates the ramps, neutrals and status colors;
// the session's brand colors come first.
'use strict';
const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const PAGE = pathToFileURL(path.join(__dirname, '../../picker/index.html')).href;
const ar = require('../../picker/i18n/ar.js');

function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}
const rgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
const identity = (page) => page.evaluate(() => window.Hawiya.state.identity());
const choices = (page) => page.evaluate(() => window.Hawiya.state.choices());
const panel = (page) => page.locator('#g-panel-colors');
const primaryInput = (page) => panel(page).locator('[data-color-input="primary"]');
const secondaryInput = (page) => panel(page).locator('[data-color-input="secondary"]');
const buttonFill = (page) =>
  page.evaluate(
    () => getComputedStyle(document.getElementById('preview').shadowRoot.querySelector('.hw-btn')).backgroundColor
  );

async function openColors(page) {
  await page.locator('[data-element="colors"] > .g-toggle').click();
  await expect(primaryInput(page)).toBeVisible();
}

test('one typed color: the identity, its 11-step ramps, neutrals, status colors and the preview follow', async ({
  page
}) => {
  const errors = watchErrors(page);
  await page.goto(PAGE);
  await page.locator('[data-preview-mode="light"]').click();
  await openColors(page);
  const before = await identity(page);
  await primaryInput(page).fill('#7C3AED');

  const id = await identity(page);
  expect(id.tokens.color.light.primary).toBe('#7c3aed');
  expect(id.tokens.color.ramps.primary).toContain('#7c3aed');
  expect((await choices(page)).selections.colors).toEqual({
    template: 'palette-blue',
    overrides: { primary: '#7c3aed' }
  });
  // Neutrals are tinted by the new primary, so they change too.
  expect(id.tokens.color.ramps.neutral).not.toEqual(before.tokens.color.ramps.neutral);

  // What the gallery shows is the built identity: 11 steps per ramp and the four status colors.
  for (const ramp of ['primary', 'secondary', 'neutral']) {
    const shown = await panel(page)
      .locator(`[data-ramp="${ramp}"] .c-swatch`)
      .evaluateAll((n) => n.map((x) => x.getAttribute('data-hex')));
    expect(shown).toEqual(id.tokens.color.ramps[ramp]);
  }
  const status = await panel(page)
    .locator('[data-ramp="status"] .c-swatch')
    .evaluateAll((n) => n.map((x) => [x.getAttribute('data-status'), x.getAttribute('data-hex')]));
  expect(status).toEqual(['success', 'warning', 'danger', 'info'].map((k) => [k, id.tokens.color.light[k]]));

  // The preview: the scene's button takes the new primary, in light and in dark.
  expect(await buttonFill(page)).toBe(rgb('#7c3aed'));
  await page.locator('[data-preview-mode="dark"]').click();
  expect(await buttonFill(page)).toBe(rgb(id.tokens.color.dark.primary));
  expect(errors).toEqual([]);
});

test('typing: lowercase or without # is accepted; a wrong value says so and changes nothing', async ({ page }) => {
  await page.goto(PAGE);
  await openColors(page);
  await primaryInput(page).fill('0f766e');
  expect((await identity(page)).tokens.color.light.primary).toBe('#0f766e');
  await primaryInput(page).fill('#12345g');
  await expect(panel(page).locator('#c-input-primary-error')).toBeVisible();
  await expect(panel(page).locator('#c-input-primary-error')).toHaveText(ar['gallery.colors.invalid']);
  await expect(primaryInput(page)).toHaveAttribute('aria-invalid', 'true');
  expect((await identity(page)).tokens.color.light.primary).toBe('#0f766e');
  // Half typed: no error yet.
  await primaryInput(page).fill('#1234');
  await expect(panel(page).locator('#c-input-primary-error')).toBeHidden();
  // The palette's own color drops the adjustment.
  await primaryInput(page).fill('#2563EB');
  expect((await choices(page)).selections.colors).toEqual({ template: 'palette-blue' });
});

test('a second color replaces the palette secondary; empty brings it back', async ({ page }) => {
  await page.goto(PAGE);
  await openColors(page);
  await secondaryInput(page).fill('#D97706');
  let id = await identity(page);
  expect(id.tokens.color.ramps.secondary).toContain('#d97706');
  expect((await choices(page)).selections.colors.overrides).toEqual({ secondary: '#d97706' });
  await secondaryInput(page).fill('');
  id = await identity(page);
  expect(id.tokens.color.ramps.secondary).toContain('#7c3aed');
  expect((await choices(page)).selections.colors).toEqual({ template: 'palette-blue' });
});

test('a ready palette: one click, adjustments cleared, the fields show its color', async ({ page }) => {
  await page.goto(PAGE);
  await openColors(page);
  await primaryInput(page).fill('#111111');
  await panel(page).locator('[data-template="palette-rose"]').click();
  await expect(panel(page).locator('[data-template="palette-rose"]')).toHaveAttribute('aria-pressed', 'true');
  expect((await choices(page)).selections.colors).toEqual({ template: 'palette-rose' });
  await expect(primaryInput(page)).toHaveValue('#E11D48');
  await expect(secondaryInput(page)).toHaveValue('');
  // The typed color survives a reload (saved as the draft).
  await primaryInput(page).fill('#0EA5E9');
  await page.reload();
  expect((await identity(page)).tokens.color.light.primary).toBe('#0ea5e9');
});

test('brand colors from the session come first; one click uses them', async ({ page }) => {
  await page.addInitScript(() => {
    window.Hawiya = { session: { brandColors: ['#0F766E', '#facc15', '#111827', 'not-a-color'] } };
  });
  await page.goto(PAGE);
  await openColors(page);
  const brand = panel(page).locator('.c-brand');
  await expect(brand).toBeVisible();
  await expect(brand.locator('.c-title')).toHaveText(ar['gallery.colors.brand']);
  // First in the panel, before the palettes.
  const order = await panel(page).evaluate((p) => Array.from(p.children).map((c) => c.className));
  expect(order[0]).toBe('c-brand');
  expect(order[1]).toBe('g-cards');
  expect(await brand.locator('.c-swatch').evaluateAll((n) => n.map((x) => x.getAttribute('data-hex')))).toEqual([
    '#0f766e',
    '#facc15',
    '#111827'
  ]);
  await brand.locator('[data-brand]').click();
  const id = await identity(page);
  expect(id.tokens.color.light.primary).toBe('#0f766e');
  expect(id.tokens.color.ramps.secondary).toContain('#facc15');
});

test('without session brand colors, no suggestion is shown', async ({ page }) => {
  await page.goto(PAGE);
  await openColors(page);
  await expect(panel(page).locator('.c-brand')).toBeHidden();
});
