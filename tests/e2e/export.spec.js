// Task 2.21 (R-012, R-013, R-014): «Export» builds the bundle, sends it to the save server when there is one,
// publishes it for an agent's browser tools, and offers «Copy for the agent» (instructions + five text files) and
// «Download» (hawiya-design.zip with the six). A failing server leaves the alternatives and the choices; a failing
// clipboard shows the text for copying by hand.
'use strict';
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '../..');
const PAGE = pathToFileURL(path.join(ROOT, 'picker/index.html')).href;
const ar = require('../../picker/i18n/ar.js');
const bundleMod = require('../../picker/js/core/bundle.js');
const zip = require('../../picker/js/core/zip.js');
const fmt = require('../../picker/js/core/export-format.js');
const validate = require('../../picker/js/core/validate.js');

const SIX = ['identity.json', 'DESIGN.md', 'tokens.json', 'tokens.css', 'theme.css', 'style-guide.html'];
const FIVE = SIX.filter((n) => n !== 'style-guide.html');

function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/fonts\.googleapis|ERR_|net::|Failed to load resource/.test(m.text())) {
      errors.push(m.text());
    }
  });
  return errors;
}
async function open(page, url) {
  await page.route('https://fonts.googleapis.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '' })
  );
  await page.goto(url);
}
const status = (page) => page.locator('#export-status');
const exported = (page) => page.evaluate(() => window.hawiyaExport);
const identity = (page) => page.evaluate(() => window.Hawiya.state.identity());

function tempProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hawiya-export-'));
}
function startServer(project) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'scripts/serve.js'), project, '--port', '0'], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    const state = { child, out: '', exit: new Promise((r) => child.on('exit', (code) => r(code))) };
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
function stop(server, dir) {
  try {
    server.child.kill();
  } catch {
    /* already gone */
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

test('with the save server: the six files land in design/, byte for byte as published', async ({ page }) => {
  const errors = watchErrors(page);
  const dir = tempProject();
  const server = await startServer(dir);
  try {
    await open(page, server.ready.url);
    await page.locator('[data-identity="warm-friendly"]').click();
    await page.locator('#export-btn').click();
    await expect(status(page)).toHaveAttribute('data-tone', 'ok');
    await expect(status(page)).toContainText(ar['export.saved'].split(':')[0]);
    expect(await server.exit).toBe(0); // the server closes after one save
    expect(JSON.parse(server.out.trim().split('\n').pop())).toEqual({ status: 'saved', written: SIX });
    const published = await exported(page);
    expect(bundleMod.verify(published)).toEqual([]);
    for (const name of SIX) {
      expect(fs.readFileSync(path.join(dir, 'design', name), 'utf8'), name).toBe(published.files[name]);
    }
    // What was written is the identity on screen, and it passes the identity checker.
    const written = JSON.parse(fs.readFileSync(path.join(dir, 'design', 'identity.json'), 'utf8'));
    expect(written).toEqual(await identity(page));
    expect(validate.check('identity', written).valid).toBe(true);
    // The alternatives are on screen too.
    await expect(page.locator('#copy-btn')).toBeVisible();
    await expect(page.locator('#download-btn')).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    stop(server, dir);
  }
});

test('as a file: published for agents, and «Download» gives hawiya-design.zip with the six files', async ({
  page
}, info) => {
  const errors = watchErrors(page);
  await open(page, PAGE);
  await page.locator('#export-btn').click();
  await expect(status(page)).toHaveText(ar['export.fileMode']);
  await expect(page.locator('html')).toHaveAttribute('data-hawiya-export', 'ready');
  const published = await exported(page);
  expect(published.format).toBe('hawiya-export');
  expect(published.schemaVersion).toBe(1);
  expect(Object.keys(published.files)).toEqual(SIX);
  expect(bundleMod.verify(published)).toEqual([]);
  // The same bundle Node builds from the same identity.
  expect(published).toEqual(bundleMod.build(await identity(page)));
  // The JSON copy in the page reads back the same.
  const embedded = await page.evaluate(() => JSON.parse(document.getElementById('hawiya-export').textContent));
  expect(embedded).toEqual(published);

  // The agents' copy is their own: changing it does not change what the page downloads.
  await page.evaluate(() => {
    window.hawiyaExport.files['DESIGN.md'] = 'changed\n';
  });
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#download-btn').click()]);
  expect(download.suggestedFilename()).toBe('hawiya-design.zip');
  const file = info.outputPath('hawiya-design.zip');
  await download.saveAs(file);
  const bytes = new Uint8Array(fs.readFileSync(file));
  expect(Buffer.from(bytes)).toEqual(Buffer.from(zip.designZip(published)));
  const entries = zip.list(bytes);
  expect(entries.map((e) => e.name)).toEqual(['design/'].concat(SIX.map((n) => 'design/' + n)));
  for (const e of entries.slice(1)) expect(new TextDecoder().decode(e.data)).toBe(published.files[e.name.slice(7)]);
  expect(errors).toEqual([]);
});

test('«Copy for the agent» copies the instructions and the five text files', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page, PAGE);
  await page.locator('#export-btn').click();
  await page.locator('#copy-btn').click();
  await expect(page.locator('#copy-status')).toHaveText(ar['export.copied']);
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  const published = await exported(page);
  expect(copied).toBe(fmt.agentText(published.files));
  // Task 9.3 (R-110): the instructions ask to keep the last line break of each file.
  expect(copied).toContain('Every file ends with exactly one line break');
  const back = fmt.parseAgentText(copied);
  expect(Object.keys(back)).toEqual(FIVE);
  for (const n of FIVE) expect(back[n]).toBe(published.files[n]);
  await expect(page.locator('#copy-fallback')).toBeHidden();
});

test('a blocked clipboard: the text is shown selected for copying by hand', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.reject(new DOMException('denied', 'NotAllowedError')) }
    });
  });
  await open(page, PAGE);
  await page.locator('#export-btn').click();
  await page.locator('#copy-btn').click();
  await expect(page.locator('#copy-fallback')).toBeVisible();
  await expect(page.locator('#copy-fallback')).toBeFocused();
  await expect(page.locator('#copy-status')).toHaveText(ar['export.copyManual']);
  const shown = await page.locator('#copy-fallback').inputValue();
  expect(shown).toBe(fmt.agentText((await exported(page)).files));
  // Selected, ready for Cmd/Ctrl+C.
  const selected = await page.evaluate(() => {
    const t = document.getElementById('copy-fallback');
    return t.selectionEnd - t.selectionStart === t.value.length;
  });
  expect(selected).toBe(true);
});

test('the server stopped before «Export»: the alternatives are there and the choices are untouched', async ({
  page
}) => {
  const dir = tempProject();
  const server = await startServer(dir);
  try {
    await open(page, server.ready.url);
    await page.locator('[data-identity="warm-friendly"]').click();
    const before = await identity(page);
    server.child.kill();
    await server.exit;
    await page.locator('#export-btn').click();
    await expect(status(page)).toHaveText(ar['export.unreachable']);
    await expect(status(page)).toHaveAttribute('data-tone', 'warn');
    await expect(page.locator('#copy-btn')).toBeVisible();
    await expect(page.locator('#download-btn')).toBeVisible();
    expect(await identity(page)).toEqual(before);
    expect(bundleMod.verify(await exported(page))).toEqual([]);
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#download-btn').click()]);
    expect(download.suggestedFilename()).toBe('hawiya-design.zip');
    expect(fs.existsSync(path.join(dir, 'design'))).toBe(false); // nothing written
  } finally {
    stop(server, dir);
  }
});

test('existing files in design/: nothing is replaced and the alternatives are offered', async ({ page }) => {
  const dir = tempProject();
  fs.mkdirSync(path.join(dir, 'design'));
  fs.writeFileSync(path.join(dir, 'design', 'DESIGN.md'), 'old\n');
  const server = await startServer(dir);
  try {
    await open(page, server.ready.url);
    await page.locator('#export-btn').click();
    await expect(status(page)).toHaveText(ar['export.exists']);
    expect(fs.readFileSync(path.join(dir, 'design', 'DESIGN.md'), 'utf8')).toBe('old\n');
    await expect(page.locator('#download-btn')).toBeVisible();
  } finally {
    stop(server, dir);
  }
});

test('opened from the server without its token (an incomplete link): it says so, nothing is saved', async ({
  page
}) => {
  const dir = tempProject();
  const server = await startServer(dir);
  try {
    await open(page, server.ready.url.split('#')[0]);
    await page.locator('#export-btn').click();
    await expect(status(page)).toHaveText(ar['export.missingToken']);
    await expect(status(page)).toHaveAttribute('data-tone', 'warn');
    await expect(page.locator('#download-btn')).toBeVisible();
    expect(fs.existsSync(path.join(dir, 'design'))).toBe(false);
  } finally {
    stop(server, dir);
  }
});

test('a reply that cannot be read: never «nothing was saved», and never sent twice', async ({ page }) => {
  const dir = tempProject();
  const server = await startServer(dir);
  try {
    let sent = 0;
    await page.route('**/api/export', (route) => {
      sent++;
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"written": [' }); // cut off
    });
    await open(page, server.ready.url);
    await page.locator('#export-btn').click();
    await expect(status(page)).toHaveText(ar['export.unreachable']);
    await page.locator('#export-btn').click();
    await expect(status(page)).toHaveText(ar['export.uncertain']);
    expect(sent).toBe(1);
    await expect(page.locator('#download-btn')).toBeVisible();
  } finally {
    stop(server, dir);
  }
});

test('a tab left from an earlier run (same address, old token) never sends a save and cannot close the new run', async ({
  page
}) => {
  const net = require('net');
  // One free port for both runs, as the fixed port 47821 would be (task 3.0a, CHG-1).
  const port = await new Promise((r) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => r(p));
    });
  });
  const start = (dir) =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [path.join(ROOT, 'scripts/serve.js'), dir, '--port', String(port)], {
        stdio: ['ignore', 'pipe', 'pipe']
      });
      const state = { child, out: '', exit: new Promise((r) => child.on('exit', (code) => r(code))) };
      child.stdout.on('data', (d) => {
        state.out += d;
        if (!state.ready && state.out.includes('\n')) {
          state.ready = JSON.parse(state.out.split('\n')[0]);
          resolve(state);
        }
      });
      setTimeout(() => reject(new Error('server not ready: ' + state.out)), 5000);
    });
  const dir = tempProject();
  const first = await start(dir);
  try {
    await open(page, first.ready.url);
    first.child.kill();
    await first.exit;
    const second = await start(dir);
    try {
      expect(new URL(second.ready.url).port).toBe(String(port));
      let saves = 0;
      page.on('request', (r) => {
        if (r.url().endsWith('/api/export')) saves++;
      });
      // The old tab, old token, same address: its session read is refused (401).
      const [read] = await Promise.all([page.waitForResponse((r) => r.url().endsWith('/api/session')), page.reload()]);
      expect(read.status()).toBe(401);
      for (let i = 0; i < 6; i++) {
        await page.locator('#export-btn').click();
        await expect(status(page)).toHaveText(ar['export.staleLink']);
      }
      expect(saves).toBe(0);
      await expect(page.locator('#download-btn')).toBeVisible(); // the alternatives are there
      // The new run is still open and saves for its own link.
      const fresh = await page.context().newPage();
      await open(fresh, second.ready.url);
      await fresh.locator('#export-btn').click();
      await expect(fresh.locator('#export-status')).toHaveAttribute('data-tone', 'ok');
      expect(await second.exit).toBe(0);
      expect(fs.readdirSync(path.join(dir, 'design')).sort()).toEqual([...SIX].sort());
    } finally {
      second.child.kill();
    }
  } finally {
    stop(first, dir);
  }
});
