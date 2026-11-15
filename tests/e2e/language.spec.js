// Task 2.3 (R-032, R-034): the language key flips every text and the direction, and the page says where fonts come from.
'use strict';
const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const PAGE = pathToFileURL(path.join(__dirname, '../../picker/index.html')).href;
const ar = require('../../picker/i18n/ar.js');
const en = require('../../picker/i18n/en.js');
const ARABIC = /[؀-ۿ]/;
const LATIN_WORD = /[A-Za-z]{2,}/g;

function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

// Every visible text of the tool itself: the light DOM only (the preview scene lives in a shadow root and
// shows the identity's sample content, whose language is chosen separately in task 2.6).
// The language key itself names the other language in that language, so it is left out.
async function visibleText(page) {
  return page.evaluate(() => {
    const toggle = document.getElementById('lang-toggle');
    toggle.hidden = true;
    const text = document.body.innerText;
    toggle.hidden = false;
    return text;
  });
}

async function i18nTexts(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-i18n]')).map((el) => [el.getAttribute('data-i18n'), el.textContent])
  );
}

test('opens in Arabic, right to left, with the fonts notice visible', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(PAGE);
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page).toHaveTitle(ar['app.title']);
  await expect(page.locator('h1')).toHaveText(ar['app.name']);
  const notice = page.locator('#fonts-notice');
  await expect(notice).toBeVisible();
  await expect(notice).toHaveText(ar['notice.fonts']);
  await expect(notice).toContainText('Google Fonts');
  await expect(page.locator('#mobile-notice')).toHaveText(ar['notice.mobile']);
  for (const [key, value] of await i18nTexts(page)) expect(value, key).toBe(ar[key]);
  expect(errors).toEqual([]);
});

test('the language key flips every text and the direction, and back', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(PAGE);
  const controlsBox = () => page.locator('#controls').boundingBox();
  const previewBox = () => page.locator('.preview-wrap').boundingBox();

  // Arabic: the choices column is on the right of the preview.
  expect((await controlsBox()).x).toBeGreaterThan((await previewBox()).x);
  const toggle = page.locator('#lang-toggle');
  await expect(toggle).toHaveText('English');
  await expect(toggle).toHaveAttribute('lang', 'en');
  await expect(toggle).toHaveAttribute('aria-label', ar['lang.switchLabel']);

  await toggle.click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page).toHaveTitle(en['app.title']);
  for (const [key, value] of await i18nTexts(page)) expect(value, key).toBe(en[key]);
  // No Arabic left anywhere in the tool's own text, attributes included.
  expect(await visibleText(page)).not.toMatch(ARABIC);
  const attrs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[aria-label],[title]')).map(
      (el) => (el.getAttribute('aria-label') || '') + (el.getAttribute('title') || '')
    )
  );
  for (const a of attrs) expect(a).not.toMatch(ARABIC);
  await expect(page.locator('#radius-value')).toHaveText(en['radius.value'].replace('{value}', '8'));
  await expect(page.locator('#swatches input').first()).toHaveAttribute('aria-label', en['color.blue']);
  await expect(toggle).toHaveText('العربية');
  await expect(toggle).toHaveAttribute('lang', 'ar');
  // English: the choices column moves to the left.
  expect((await controlsBox()).x).toBeLessThan((await previewBox()).x);

  await toggle.click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  for (const [key, value] of await i18nTexts(page)) expect(value, key).toBe(ar[key]);
  // Arabic: only brand and technical names stay in Latin letters.
  const latin = new Set((await visibleText(page)).match(LATIN_WORD));
  for (const word of latin)
    expect(['Google', 'Fonts', 'design', 'px', 'IBM', 'Plex', 'Sans', 'Arabic', 'Cairo', 'Noto']).toContain(word);
  expect(errors).toEqual([]);
});

test('the chosen language is remembered after a reload', async ({ page }) => {
  await page.goto(PAGE);
  await page.locator('#lang-toggle').click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('h1')).toHaveText(en['app.name']);
});

test('export messages and buttons follow the language, even after they are shown', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(PAGE);
  await page.locator('#export-btn').click();
  await expect(page.locator('html')).toHaveAttribute('data-hawiya-export', 'ready');
  await expect(page.locator('#export-status')).toHaveText(ar['export.fileMode']);
  await expect(page.locator('#download-list button').first()).toHaveText(
    ar['export.download'].replace('{name}', 'identity.json')
  );

  await page.locator('#lang-toggle').click();
  await expect(page.locator('#export-status')).toHaveText(en['export.fileMode']);
  await expect(page.locator('#download-list button').first()).toHaveText(
    en['export.download'].replace('{name}', 'identity.json')
  );

  // A changed choice makes the export stale; the message is in the current language.
  await page.locator('#radius-input').fill('12');
  await expect(page.locator('#export-status')).toHaveText(en['export.changed']);
  await expect(page.locator('html')).toHaveAttribute('data-hawiya-export', 'stale');
  await page.locator('#lang-toggle').click();
  await expect(page.locator('#export-status')).toHaveText(ar['export.changed']);
  expect(errors).toEqual([]);
});

test('the generated files keep the identity name from the library whatever the interface language', async ({
  page
}) => {
  await page.goto(PAGE);
  await page.locator('#lang-toggle').click();
  await page.locator('#export-btn').click();
  const name = await page.evaluate(() => JSON.parse(window.hawiyaExport.files['identity.json']).name);
  expect(name).toBe('مؤسسي هادئ');
});

test('no horizontal scroll on a phone width in either language', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(PAGE);
  for (let i = 0; i < 2; i++) {
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(over).toBeLessThanOrEqual(0);
    await page.locator('#lang-toggle').click();
  }
});
