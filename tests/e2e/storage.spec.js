// Task 2.5 (R-031): choices survive closing the browser; saved identities open and update; storage problems
// never lose work or block export.
'use strict';
const { test, expect, chromium } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');

const PAGE = pathToFileURL(path.join(__dirname, '../../picker/index.html')).href;
const ar = require('../../picker/i18n/ar.js');
const CHANNEL = process.env.HAWIYA_PW_CHANNEL === 'chromium' ? undefined : process.env.HAWIYA_PW_CHANNEL || 'chrome';

function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}
const tealSwatch = (page) => page.locator('#swatches input[value="#0f766e"]');
const store = (page) =>
  page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)])));

test('choices survive closing the browser and opening the page again', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hawiya-profile-'));
  try {
    let ctx = await chromium.launchPersistentContext(dir, { channel: CHANNEL, headless: true });
    let page = await ctx.newPage();
    const errors = watchErrors(page);
    await page.goto(PAGE);
    await tealSwatch(page).check();
    await page.locator('#radius-input').fill('14');
    await page.locator('#fonts input[value="pair-cairo"]').check();
    await page.locator('#identity-name').fill('متجر الورد');
    expect(errors).toEqual([]);
    await ctx.close(); // the whole browser closes

    ctx = await chromium.launchPersistentContext(dir, { channel: CHANNEL, headless: true });
    page = await ctx.newPage();
    await page.goto(PAGE);
    await expect(tealSwatch(page)).toBeChecked();
    await expect(page.locator('#radius-input')).toHaveValue('14');
    await expect(page.locator('#fonts input[value="pair-cairo"]')).toBeChecked();
    await expect(page.locator('#identity-name')).toHaveValue('متجر الورد');
    await expect(page.locator('[data-identity="calm-corporate"]')).toHaveAttribute('aria-pressed', 'false');
    await ctx.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('save under a name, change, open it again, update it, and save a new copy', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(PAGE);
  await expect(page.locator('#saved-empty')).toBeVisible();
  await page.locator('#identity-name').fill('مشروعي');
  await tealSwatch(page).check();
  await page.locator('#save-btn').click();
  await expect(page.locator('#saved-note')).toHaveText(ar['saved.created'].replace('{name}', 'مشروعي'));
  await expect(page.locator('.saved-item')).toHaveCount(1);
  await expect(page.locator('#saved-empty')).toBeHidden();

  // Change everything, then open the saved one: its choices come back.
  await page.locator('[data-identity="calm-corporate"]').click();
  await page.locator('#identity-name').fill('شيء آخر');
  await expect(page.locator('#swatches input[value="#2563eb"]')).toBeChecked();
  await page.locator('.saved-item button[data-open]').click();
  await expect(tealSwatch(page)).toBeChecked();
  await expect(page.locator('#identity-name')).toHaveValue('مشروعي');

  // Edit and Save: the same entry is updated.
  await page.locator('#radius-input').fill('20');
  await page.locator('#save-btn').click();
  await expect(page.locator('#saved-note')).toHaveText(ar['saved.updated'].replace('{name}', 'مشروعي'));
  await expect(page.locator('.saved-item')).toHaveCount(1);
  await page.locator('#save-new-btn').click();
  await expect(page.locator('.saved-item')).toHaveCount(2);

  // After a reload the list and the opened identity are still there.
  await page.reload();
  await expect(page.locator('.saved-item')).toHaveCount(2);
  await expect(page.locator('#radius-input')).toHaveValue('20');
  expect(errors).toEqual([]);
});

test('an invalid name is not applied and says why', async ({ page }) => {
  await page.goto(PAGE);
  const name = page.locator('#identity-name');
  await name.fill('');
  await expect(page.locator('#identity-name-error')).toBeVisible();
  await name.fill('<b>');
  await expect(page.locator('#identity-name-error')).toBeVisible();
  await page.reload();
  await expect(name).toHaveValue('مؤسسي هادئ');
  await name.fill('Nice name');
  await expect(page.locator('#identity-name-error')).toBeHidden();
});

test('storage blocked: a notice appears, choosing and exporting still work', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('blocked', 'SecurityError');
      }
    });
  });
  const errors = watchErrors(page);
  await page.goto(PAGE);
  await expect(page.locator('#storage-warning')).toBeVisible();
  await expect(page.locator('#storage-warning')).toHaveText(ar['storage.unavailable']);
  await tealSwatch(page).check();
  await page.locator('#export-btn').click();
  await expect(page.locator('html')).toHaveAttribute('data-hawiya-export', 'ready');
  const primary = await page.evaluate(
    () => JSON.parse(window.hawiyaExport.files['identity.json']).tokens.color.primary
  );
  expect(primary.toLowerCase()).toBe('#0f766e');
  expect(errors).toEqual([]);
});

test('storage full: the change still applies, a notice says it was not saved, export works', async ({ page }) => {
  await page.goto(PAGE);
  await page.evaluate(() => {
    Storage.prototype.setItem = function () {
      throw new DOMException('full', 'QuotaExceededError');
    };
  });
  await tealSwatch(page).check();
  await expect(page.locator('#saved-note')).toHaveText(ar['saved.full']);
  await expect(tealSwatch(page)).toBeChecked();
  await page.locator('#export-btn').click();
  await expect(page.locator('html')).toHaveAttribute('data-hawiya-export', 'ready');
});

test('a damaged draft: the page starts from the ready identity, says so, and keeps the old copy', async ({ page }) => {
  await page.goto(PAGE);
  await page.evaluate(() =>
    localStorage.setItem('hawiya.draft', '{"format":1,"identity":{"schemaVersion":1,"name":"<')
  );
  await page.reload();
  await expect(page.locator('#saved-note')).toHaveText(ar['saved.draftUnreadable']);
  await expect(page.locator('[data-identity="calm-corporate"]')).toHaveAttribute('aria-pressed', 'true');
  await tealSwatch(page).check();
  const all = await store(page);
  const kept = Object.keys(all).filter((k) => k.startsWith('hawiya.draft.unreadable-'));
  expect(kept.length).toBe(1);
  expect(all[kept[0]]).toBe('{"format":1,"identity":{"schemaVersion":1,"name":"<');
  expect(JSON.parse(all['hawiya.draft']).identity.tokens.color.light.primary).toBe('#0f766e');
});

test('older, damaged and hostile entries are listed as text, cannot be opened, and survive new saves', async ({
  page
}) => {
  await page.goto(PAGE);
  const items = [
    { id: 'old1', name: 'هوية قديمة', updatedAt: 1, identity: { schemaVersion: 0, name: 'old' } },
    {
      id: 'bad1',
      name: '<img src=x onerror="window.__pwned=1">',
      updatedAt: 2,
      identity: { schemaVersion: 1, name: '<x>' }
    }
  ];
  const raw = JSON.stringify({ format: 1, items });
  await page.evaluate((r) => localStorage.setItem('hawiya.saved', r), raw);
  await page.reload();
  await expect(page.locator('.saved-item')).toHaveCount(2);
  await expect(page.locator('.saved-item[data-status="older"] .saved-meta')).toHaveText(ar['saved.older']);
  await expect(page.locator('.saved-item[data-status="damaged"] .saved-name')).toHaveText(items[1].name);
  await expect(page.locator('.saved-item button[data-open]')).toHaveCount(0);
  expect(await page.locator('#saved-list img').count()).toBe(0);
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();

  await page.locator('#save-btn').click();
  await expect(page.locator('.saved-item')).toHaveCount(3);
  const after = JSON.parse((await store(page))['hawiya.saved']).items;
  expect(after.slice(0, 2)).toEqual(items);
});

test('review fixes: unreadable list notice, no false "opened", Save keeps updating after a reload, other tabs', async ({
  page,
  context
}) => {
  await page.goto(PAGE);
  // A list this page cannot read is announced, not shown as "no saved identities".
  await page.evaluate(() =>
    localStorage.setItem('hawiya.saved', '{"format":2,"items":[{"id":"abc","name":"Old work"}]}')
  );
  await page.reload();
  await expect(page.locator('#saved-note')).toHaveText(ar['saved.listUnreadable']);
  await page.evaluate(() => localStorage.removeItem('hawiya.saved'));
  await page.reload();

  // Save, reload, change, Save: still one entry (the opened one is updated).
  await page.locator('#identity-name').fill('Mine');
  await page.locator('#save-btn').click();
  await page.reload();
  await tealSwatch(page).check();
  await page.locator('#save-btn').click();
  await expect(page.locator('#saved-note')).toHaveText(ar['saved.updated'].replace('{name}', 'Mine'));
  await expect(page.locator('.saved-item')).toHaveCount(1);

  // Another tab saves: this tab's list follows.
  const other = await context.newPage();
  await other.goto(PAGE);
  await other.locator('#save-new-btn').click();
  await expect(page.locator('.saved-item')).toHaveCount(2);

  // Opening while the draft cannot be written: the failure stays visible; no "opened, saved automatically".
  await page.locator('#swatches input[value="#b91c1c"]').check();
  await page.evaluate(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (k === 'hawiya.draft') throw new DOMException('full', 'QuotaExceededError');
      return set.call(this, k, v);
    };
  });
  await page.locator('.saved-item button[data-open]').first().click();
  await expect(page.locator('#saved-note')).toHaveText(ar['saved.full']);
});
