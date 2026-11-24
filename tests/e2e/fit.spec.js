// The ready identities are ordered for the project the agent read (picker/js/core/fit.js), with the reasons.
'use strict';
const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '../..');
const PAGE = pathToFileURL(path.join(ROOT, 'picker/index.html')).href;
const ar = require('../../picker/i18n/ar.js');
const en = require('../../picker/i18n/en.js');
const LIBRARY_ORDER = require('fs')
  .readdirSync(path.join(ROOT, 'library/identities'))
  .filter((f) => f.endsWith('.json'))
  .sort()
  .map((f) => f.replace(/\.json$/, ''));

const b64url = (o) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64url');
const FINANCE = { type: 'dashboard', language: 'ar', tags: ['corporate', 'data-dense'], sectors: ['finance'] };

async function open(page, hash) {
  await page.route('https://fonts.googleapis.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '' })
  );
  await page.goto(PAGE + (hash || ''));
  await page.waitForFunction(() => document.querySelectorAll('#identity-list [data-identity]').length > 0);
}
const order = (page) =>
  page.locator('#identity-list [data-identity]').evaluateAll((n) => n.map((b) => b.getAttribute('data-identity')));

test('without a session the cards keep the library order and say nothing about fit', async ({ page }) => {
  await open(page);
  expect(await order(page)).toEqual(LIBRARY_ORDER);
  await expect(page.locator('#identity-ranked')).toBeHidden();
  await expect(page.locator('.identity-best')).toHaveCount(0);
  await expect(page.locator('.identity-why')).toHaveCount(0);
});

test('a finance dashboard puts the finance identity first, marks it, and says why in both languages', async ({
  page
}) => {
  await open(page, '#session=' + b64url(FINANCE));
  const ids = await order(page);
  expect(ids[0]).toBe('sober-finance');
  expect([...ids].sort()).toEqual([...LIBRARY_ORDER].sort()); // every identity is still there
  await expect(page.locator('#identity-ranked')).toHaveText(ar['identity.ranked']);
  const first = page.locator('#identity-list [data-identity]').first();
  await expect(first.locator('.identity-best')).toHaveText(ar['identity.best']);
  await expect(page.locator('.identity-best')).toHaveCount(1);
  const why = first.locator('.identity-why');
  await expect(why).toContainText(ar['fit.sector.finance']);
  await expect(why).toContainText(ar['fit.tag.corporate']);
  await expect(why).not.toContainText(ar['fit.type.dashboard']); // only the two strongest reasons are shown
  expect(await page.locator('#identity-list .identity-why').count()).toBeLessThanOrEqual(5);

  await page.locator('#lang-toggle').click();
  await expect(page.locator('#identity-ranked')).toHaveText(en['identity.ranked']);
  await expect(page.locator('#identity-list [data-identity]').first().locator('.identity-why')).toContainText(
    en['fit.sector.finance']
  );
  expect((await order(page))[0]).toBe('sober-finance');

  // One click on the best fit still fills every element, as before.
  await page.locator('#identity-list [data-identity]').first().click();
  await expect(page.locator('#identity-list [data-identity="sober-finance"]')).toHaveAttribute('aria-pressed', 'true');
});

test('a session without sectors still ranks by feel, and a health app finds the health identity', async ({ page }) => {
  await open(
    page,
    '#session=' + b64url({ type: 'web-app', language: 'ar', tags: ['soft', 'minimal'], sectors: ['health'] })
  );
  expect((await order(page))[0]).toBe('clean-health');
  // A new tab: changing only the end of the link would not load the page again.
  const other = await page.context().newPage();
  await open(other, '#session=' + b64url({ type: 'landing', language: 'ar', tags: ['playful', 'vivid'] }));
  expect((await order(other))[0]).toBe('playful-colorful');
  await expect(other.locator('#identity-ranked')).toBeVisible();
});
