// Task 2.16 (R-026, R-027): a choice that breaks a blocking rule is not applied; the page says why and offers
// the suggested color; a warning shows with «Ignore»; messages in both languages.
'use strict';
const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const PAGE = pathToFileURL(path.join(__dirname, '../../picker/index.html')).href;
const ar = require('../../picker/i18n/ar.js');
const en = require('../../picker/i18n/en.js');

function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/fonts\.googleapis|ERR_|net::/.test(m.text())) errors.push(m.text());
  });
  return errors;
}
async function start(page) {
  await page.route('https://fonts.googleapis.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '' })
  );
  await page.goto(PAGE);
}
async function openPanel(page, element) {
  await page.locator(`[data-element="${element}"] > .g-toggle`).click();
  await expect(page.locator(`#g-panel-${element} [data-template]`).first()).toBeVisible();
}
const identity = (page) => page.evaluate(() => window.Hawiya.state.identity());
const block = (page) => page.locator('#rules [data-rules-block]');
const warnings = (page) => page.locator('#rules [data-rules-warnings]');
// Every blocking rule passes for the identity the page shows.
const allowed = (page) =>
  page.evaluate(() => window.Hawiya.rules.identity(window.Hawiya.state.identity(), window.Hawiya.library.find).allowed);

test('a weak color is refused with the reason; the suggested color applies the same change', async ({ page }) => {
  const errors = watchErrors(page);
  await start(page);
  await openPanel(page, 'colors');
  await expect(page.locator('#rules')).toBeHidden();
  const before = await identity(page);

  // AAA: the palette's colors miss 7:1 for button text, so the switch is refused.
  await page.locator('[data-contrast-level="AAA"]').click();
  await expect(block(page)).toBeVisible();
  await expect(block(page)).toHaveAttribute('role', 'alert');
  await expect(block(page).locator('.r-title')).toHaveText(ar['rules.blocked.title']);
  await expect(block(page)).toContainText(ar['rules.role.onPrimary']);
  await expect(block(page)).toContainText('7:1');
  expect((await identity(page)).project.contrast).toBe('AA'); // not applied
  expect((await identity(page)).tokens.color).toEqual(before.tokens.color);
  await expect(page.locator('[data-contrast-level="AA"]')).toHaveAttribute('aria-pressed', 'true');

  // The suggestion: AAA with the nearest colors that pass.
  const suggested = await page.evaluate(() => window.Hawiya.rulesUi.blocked().suggestion.overrides);
  await expect(block(page).locator('[data-rules-suggestion]')).toContainText(suggested.primary.toUpperCase());
  await block(page).locator('[data-rules-apply]').click();
  await expect(block(page)).toHaveCount(0);
  let id = await identity(page);
  expect(id.project.contrast).toBe('AAA');
  expect(id.tokens.color.light.primary).toBe(suggested.primary);
  expect(await allowed(page)).toBe(true);
  await expect(page.locator('[data-contrast-level="AAA"]')).toHaveAttribute('aria-pressed', 'true');

  // A mid blue as the primary: its button text misses 7:1, so it is refused too.
  const input = page.locator('#g-panel-colors [data-color-input="primary"]');
  await input.fill('#3B82F6');
  await expect(block(page)).toBeVisible();
  expect((await identity(page)).tokens.color.light.primary).toBe(suggested.primary); // unchanged
  const next = await page.evaluate(() => window.Hawiya.rulesUi.blocked().suggestion.overrides.primary);
  expect(next).not.toBe('#3b82f6');
  await block(page).locator('[data-rules-apply]').click();
  id = await identity(page);
  expect(id.tokens.color.light.primary).toBe(next);
  expect(id.tokens.color.ramps.primary).toContain(next);
  expect(await allowed(page)).toBe(true);

  // Close without applying: the message goes, nothing changes.
  await input.fill('#3B82F6');
  await expect(block(page)).toBeVisible();
  await block(page).locator('[data-rules-dismiss]').click();
  await expect(block(page)).toHaveCount(0);
  expect((await identity(page)).tokens.color.light.primary).toBe(next);
  await expect(input).toHaveValue(next.toUpperCase()); // the field shows the identity again
  expect(errors).toEqual([]);
});

test('messages follow the interface language', async ({ page }) => {
  await start(page);
  await openPanel(page, 'colors');
  await page.locator('[data-contrast-level="AAA"]').click();
  await expect(block(page).locator('.r-title')).toHaveText(ar['rules.blocked.title']);
  await page.locator('#lang-toggle').click();
  await expect(block(page).locator('.r-title')).toHaveText(en['rules.blocked.title']);
  await expect(block(page)).toContainText(en['rules.role.onPrimary']);
  await expect(block(page).locator('[data-rules-apply]')).toHaveText(en['rules.suggest.apply']);
});

test('a font that does not support the project language blocks the language change', async ({ page }) => {
  await start(page);
  await openPanel(page, 'fonts');
  await page.locator('#g-panel-fonts [data-template="font-noto-kufi-arabic"]').click();
  expect((await identity(page)).selections.fonts.template).toBe('font-noto-kufi-arabic');
  await page.locator('#g-panel-fonts [data-project-lang="en"]').click();
  await expect(block(page)).toBeVisible();
  await expect(block(page)).toContainText(ar['rules.lang.en']);
  await expect(block(page).locator('[data-rules-apply]')).toHaveCount(0); // no color can fix a font
  await expect(block(page)).toContainText(ar['rules.suggest.none']);
  expect((await identity(page)).project.language).toBe('ar');
});

test('button corners rounder than the card warn, are applied, and can be ignored', async ({ page }) => {
  const errors = watchErrors(page);
  await start(page);
  await openPanel(page, 'radius');
  const md = page.locator('#g-panel-radius [data-adjust="md"]');
  await md.fill('20'); // the starter card uses radius lg = 12
  expect((await identity(page)).tokens.radius.md).toBe(20); // a warning never blocks
  await expect(warnings(page)).toBeVisible();
  const item = warnings(page).locator('[data-rules-warning="button-radius-over-card"]');
  await expect(item).toContainText(ar['rules.warn.buttonRadius'].replace('{button}', '20').replace('{card}', '12'));
  await expect(block(page)).toHaveCount(0);

  await item.locator('[data-rules-ignore]').click();
  await expect(page.locator('#rules')).toBeHidden();
  // Still ignored after another change elsewhere.
  await page.locator('#g-panel-radius [data-adjust="sm"]').fill('6');
  await expect(page.locator('#rules')).toBeHidden();
  // A different value is a new warning.
  await md.fill('22');
  await expect(warnings(page).locator('[data-rules-warning="button-radius-over-card"]')).toBeVisible();
  // Back below the card: no warning.
  await md.fill('8');
  await expect(page.locator('#rules')).toBeHidden();
  expect(errors).toEqual([]);
});
