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
    () => JSON.parse(window.hawiyaExport.files['identity.json']).tokens.color.light.primary
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

/* ---------- task 3.0b (CHG-1, R-101): from the save server, saved identities shared, the draft per project ---------- */

const net = require('net');
const { spawn } = require('child_process');
const SERVE = path.join(__dirname, '../../scripts/serve.js');

// One port for every run of a test, as the fixed port 47821 is in real use (tests must not take 47821 itself).
const freePort = () =>
  new Promise((r) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => r(p));
    });
  });
function serve(dir, port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVE, dir, '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'] });
    const state = { child, out: '', exit: new Promise((r) => child.on('exit', r)) };
    child.stdout.on('data', (d) => {
      state.out += d;
      if (!state.ready && state.out.includes('\n')) {
        state.ready = JSON.parse(state.out.split('\n')[0]);
        resolve(state);
      }
    });
    setTimeout(() => reject(new Error('server not ready: ' + state.out)), 5000);
  });
}
async function stopServer(s) {
  if (s.child.exitCode === null) {
    s.child.kill();
    await s.exit;
  }
}
const projectDir = (root, name) => {
  const d = path.join(root, name);
  fs.mkdirSync(d);
  return d;
};
const shownName = (page) => page.evaluate(() => window.Hawiya.state.identity().name);
const buttonsOf = (page) => page.evaluate(() => window.Hawiya.state.identity().selections.buttons.template);

test('3.0b: run after run of the save server, the saved identities are there for every project; each project has its own draft', async ({
  browser
}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hawiya-3.0b-'));
  const A = projectDir(root, 'project-a');
  const B = projectDir(root, 'project-b');
  const port = await freePort();
  const context = await browser.newContext();
  let s = null;
  try {
    // Run 1, project A: a draft (warm-friendly) and a saved identity.
    s = await serve(A, port);
    let page = await context.newPage();
    await page.goto(s.ready.url);
    await page.locator('[data-identity="warm-friendly"]').click();
    await page.locator('#identity-name').fill('Shared one');
    await page.locator('#save-new-btn').click();
    await page.close();
    await stopServer(s);

    // Run 2, project B, same address: the saved identity is listed; the draft is B's own (the starting point).
    s = await serve(B, port);
    page = await context.newPage();
    await page.goto(s.ready.url);
    await expect(page.locator('#saved-list')).toContainText('Shared one');
    expect(await buttonsOf(page)).toBe('button-solid');
    await page.locator('#identity-name').fill('B draft');
    await page.close();
    await stopServer(s);

    // Run 3, project A again: A's draft is back; B's is not mixed in.
    s = await serve(A, port);
    page = await context.newPage();
    await page.goto(s.ready.url);
    expect(await shownName(page)).toBe('Shared one');
    expect(await buttonsOf(page)).toBe('button-soft');
    await expect(page.locator('#saved-list')).toContainText('Shared one');
    const keys = await page.evaluate(() =>
      Object.keys(localStorage)
        .filter((k) => k.startsWith('hawiya.draft'))
        .sort()
    );
    expect(keys).toHaveLength(2); // one draft per project
    await page.close();
  } finally {
    if (s) await stopServer(s); // also when a check above fails
    await context.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('3.0b: a general draft already on that address is kept as it was', async ({ browser }) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hawiya-3.0b-'));
  const A = projectDir(root, 'project-a');
  const port = await freePort();
  const context = await browser.newContext();
  let s = null;
  try {
    s = await serve(A, port);
    const page = await context.newPage();
    await page.goto(s.ready.url);
    // A valid general draft (as the page opened as a file writes it): it would open if the page read it.
    const old = await page.evaluate(() => {
      const H = window.Hawiya;
      const c = H.state.choices();
      c.name = 'old general draft';
      c.selections.buttons = { template: 'button-soft' };
      return JSON.stringify({ format: 1, savedAt: 1, identity: H.resolve.resolve(c, H.library.view()) });
    });
    await page.evaluate((v) => localStorage.setItem('hawiya.draft', v), old);
    await page.reload();
    expect(await shownName(page)).not.toBe('old general draft');
    expect(await buttonsOf(page)).toBe('button-solid'); // the starting point, not the general draft
    await page.locator('[data-identity="warm-friendly"]').click();
    expect(await page.evaluate(() => localStorage.getItem('hawiya.draft'))).toBe(old);
  } finally {
    if (s) await stopServer(s);
    await context.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('3.0b: on a fallback port the page says the earlier saved identities are not here; never as a file', async ({
  page
}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hawiya-3.0b-'));
  const A = projectDir(root, 'project-a');
  const s = await serve(A, await freePort()); // any port other than 47821 is a fallback for the page
  try {
    await page.goto(s.ready.url);
    await expect(page.locator('#port-fallback')).toBeVisible();
    await expect(page.locator('#port-fallback')).toHaveText(ar['saved.portFallback']);
    await page.goto(PAGE);
    await expect(page.locator('#port-fallback')).toBeHidden();
  } finally {
    await stopServer(s);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('3.0b: on the usual port 47821 there is no fallback notice', async ({ page }) => {
  const busy = await new Promise((r) => {
    const t = net.createServer();
    t.once('error', () => r(true));
    t.listen(47821, '127.0.0.1', () => t.close(() => r(false)));
  });
  test.skip(busy, 'port 47821 is in use on this machine');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hawiya-3.0b-'));
  const s = await serve(projectDir(root, 'project-a'), 47821);
  try {
    await page.goto(s.ready.url);
    await expect(page.locator('#saved-list')).toBeAttached();
    await expect(page.locator('#port-fallback')).toBeHidden();
  } finally {
    await stopServer(s);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('3.0b review: an old draft in another project never overwrites a saved identity changed since; it saves a copy', async ({
  browser
}) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hawiya-3.0b-'));
  const A = projectDir(root, 'project-a');
  const B = projectDir(root, 'project-b');
  const port = await freePort();
  const context = await browser.newContext();
  const run = async (dir, fn) => {
    const s = await serve(dir, port);
    const page = await context.newPage();
    await page.goto(s.ready.url);
    try {
      await fn(page);
    } finally {
      await page.close();
      await stopServer(s);
    }
  };
  const saved = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('hawiya.saved')).items);
  try {
    await run(A, async (page) => {
      await page.locator('#identity-name').fill('Brand');
      await page.locator('#save-new-btn').click();
    });
    await run(B, async (page) => {
      await page.locator('#saved-list [data-open]').first().click();
      await page.locator('[data-identity="warm-friendly"]').click();
      await page.locator('#identity-name').fill('Brand');
      await page.locator('#save-btn').click();
      await expect(page.locator('#saved-note')).toHaveText(ar['saved.updated'].replace('{name}', 'Brand'));
    });
    await run(A, async (page) => {
      expect(await buttonsOf(page)).toBe('button-solid'); // A's old draft
      await page.locator('#save-btn').click();
      await expect(page.locator('#saved-note')).toHaveText(ar['saved.conflictCopy'].replace('{name}', 'Brand'));
      const items = await saved(page);
      expect(items).toHaveLength(2);
      expect(items[0].identity.selections.buttons.template).toBe('button-soft'); // B's version kept
      expect(items[1].identity.selections.buttons.template).toBe('button-solid'); // A's as a copy
    });
  } finally {
    await context.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
