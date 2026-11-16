// Task 2.20 (R-033, R-003): the session is read from the save server, else from the end of the link; it is checked
// against the session schema; missing or damaged → defaults with a notice; nothing from it reaches the page as text.
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
const en = require('../../picker/i18n/en.js');
const sessionData = require('../../picker/js/ui/session.js');

const VALID = { type: 'web-app', language: 'ar', tags: ['playful', 'soft'], brandColors: ['#0f766e', '#facc15'] };
const b64url = (text) => Buffer.from(text, 'utf8').toString('base64url');

function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/fonts\.googleapis|ERR_|net::/.test(m.text())) errors.push(m.text());
  });
  return errors;
}
async function open(page, url) {
  await page.route('https://fonts.googleapis.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '' })
  );
  await page.goto(url);
}
const note = (page) => page.locator('#session-note');
const session = (page) => page.evaluate(() => window.Hawiya.session || null);
async function openColors(page) {
  await page.locator('[data-element="colors"] > .g-toggle').click();
  await expect(page.locator('#g-panel-colors [data-template]').first()).toBeVisible();
}
// The brand colors shown first in the colors gallery.
const brandShown = (page) =>
  page.locator('#g-panel-colors .c-brand .c-swatch').evaluateAll((n) => n.map((x) => x.getAttribute('data-hex')));

test('a session in the link: read, the brand color is the first suggestion, and the page says so', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, PAGE + '#session=' + sessionData.encode(VALID));
  expect(await session(page)).toEqual(VALID);
  await expect(note(page)).toHaveText(ar['session.loaded']);
  await expect(note(page)).toHaveAttribute('data-session', 'ok');
  await openColors(page);
  expect(await brandShown(page)).toEqual(VALID.brandColors);
  const order = await page.locator('#g-panel-colors').evaluate((p) => Array.from(p.children).map((c) => c.className));
  expect(order[0]).toBe('c-brand');
  // The session's tags steer «suits your choices».
  const fit = await page.evaluate(() => {
    const H = window.Hawiya;
    return H.match.best(
      'buttons',
      H.library.view().templates.buttons,
      H.state.identity().selections,
      H.library.find,
      H.session
    );
  });
  expect(fit).toBe('button-soft');
  await page.locator('#lang-toggle').click();
  await expect(note(page)).toHaveText(en['session.loaded']);
  expect(errors).toEqual([]);
});

test('no session: the page runs on its defaults and says so', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, PAGE);
  expect(await session(page)).toBe(null);
  await expect(note(page)).toHaveText(ar['session.none']);
  await openColors(page);
  await expect(page.locator('#g-panel-colors .c-brand')).toBeHidden();
  expect(errors).toEqual([]);
});

test('a damaged session: not used, a warning, the page still works', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, PAGE + '#session=' + b64url('{"type":"web-app","language":"ar"'));
  expect(await session(page)).toBe(null);
  await expect(note(page)).toHaveText(ar['session.damaged']);
  await expect(note(page)).toHaveAttribute('data-tone', 'warn');
  // Choosing still works.
  await page.locator('[data-identity="warm-friendly"]').click();
  expect(await page.evaluate(() => window.Hawiya.state.identity().selections.buttons.template)).toBe('button-soft');
  expect(errors).toEqual([]);
});

test('hostile text in the session never reaches the page', async ({ page }) => {
  const errors = watchErrors(page);
  const payload = '<img src=x onerror="window.__pwned=1">';
  const hostile = { ...VALID, tags: [payload], brandColors: ['#000000;background:url(javascript:alert(1))'] };
  await open(page, PAGE + '#session=' + b64url(JSON.stringify(hostile)));
  expect(await session(page)).toBe(null);
  await expect(note(page)).toHaveText(ar['session.damaged']);
  await openColors(page);
  await expect(page.locator('#g-panel-colors .c-brand')).toBeHidden();
  const seen = await page.evaluate(
    (p) => ({
      pwned: window.__pwned === 1,
      inPage: document.documentElement.outerHTML.includes(p) || document.body.innerText.includes('onerror'),
      images: document.querySelectorAll('img[src="x"]').length
    }),
    payload
  );
  expect(seen).toEqual({ pwned: false, inPage: false, images: 0 });
  expect(errors).toEqual([]);
});

/* ---------- through the local save server ---------- */

function startServer(project) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'scripts/serve.js'), project], {
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '';
    child.stdout.on('data', (d) => {
      out += d;
      if (out.includes('\n')) resolve({ child, ready: JSON.parse(out.split('\n')[0]) });
    });
    child.on('exit', () => reject(new Error('server exited: ' + out)));
    setTimeout(() => reject(new Error('server not ready')), 5000);
  });
}
function project(sessionText) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hawiya-session-'));
  if (sessionText !== undefined) {
    fs.mkdirSync(path.join(dir, 'design'));
    fs.writeFileSync(path.join(dir, 'design', 'hawiya-session.json'), sessionText);
  }
  return dir;
}

test('from the save server: its session file is read with the token', async ({ page }) => {
  const errors = watchErrors(page);
  const dir = project(JSON.stringify(VALID));
  const server = await startServer(dir);
  try {
    // A different session in the link: the server's wins.
    const other = { type: 'landing', language: 'en', tags: ['minimal'] };
    await open(page, server.ready.url + '&session=' + sessionData.encode(other));
    await expect(note(page)).toHaveAttribute('data-session', 'ok');
    await expect.poll(() => session(page)).toEqual(VALID);
    await openColors(page);
    expect(await brandShown(page)).toEqual(VALID.brandColors);
    expect(errors).toEqual([]);
  } finally {
    server.child.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('from the save server without a session file: the link is used, else the defaults', async ({ page }) => {
  const dir = project();
  const server = await startServer(dir);
  try {
    await open(page, server.ready.url + '&session=' + sessionData.encode(VALID));
    await expect.poll(() => page.evaluate(() => document.getElementById('session-note').dataset.session)).toBe('ok');
    expect(await session(page)).toEqual(VALID);
    await open(page, server.ready.url);
    await page.reload();
    await expect(note(page)).toHaveText(ar['session.none']);
    expect(await session(page)).toBe(null);
  } finally {
    server.child.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('from the save server with a damaged session file: not used, a warning (even with one in the link)', async ({
  page
}) => {
  const dir = project('{"type":"web-app","language":"ar","tags":["<script>"]}');
  const server = await startServer(dir);
  try {
    await open(page, server.ready.url + '&session=' + sessionData.encode(VALID));
    await expect(note(page)).toHaveText(ar['session.damaged']); // the server refuses it, and says why
    await expect(note(page)).toHaveAttribute('data-tone', 'warn');
    expect(await session(page)).toBe(null);
  } finally {
    server.child.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
