// Task 3.4 (R-061, R-065): the review page shows every template of an element, drafts too, each in the four states
// (Arabic and English, light and dark); «Approve» changes the library file and the «reviewed» counter rises by one.
'use strict';
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '../..');

function library() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hawiya-review-e2e-'));
  const lib = path.join(dir, 'library');
  fs.cpSync(path.join(ROOT, 'library'), lib, { recursive: true });
  const file = path.join(lib, 'elements', 'radius.json');
  const list = JSON.parse(fs.readFileSync(file, 'utf8'));
  const pill = JSON.parse(JSON.stringify(list[1]));
  Object.assign(pill, {
    id: 'radius-pill',
    name: { ar: 'زوايا كبسولية', en: 'Pill corners' },
    status: { state: 'draft' }
  });
  for (const k of ['sm', 'md', 'lg']) pill.tokens.radius[k].$value.value *= 3;
  list.push(pill);
  fs.writeFileSync(file, JSON.stringify(list, null, 2) + '\n');
  return { dir, lib, file };
}

// How many templates of the copied library are reviewed and how many are drafts.
function counts(lib) {
  const n = { reviewed: 0, draft: 0 };
  const dir = path.join(lib, 'elements');
  for (const f of fs.readdirSync(dir)) {
    for (const t of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) if (t && t.status) n[t.status.state]++;
  }
  return n;
}

function start(lib) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'tools/review-server.js'), '--library', lib, '--no-open'], {
      stdio: ['ignore', 'pipe', 'inherit']
    });
    let out = '';
    child.stdout.on('data', (d) => {
      out += d;
      const i = out.indexOf('\n');
      if (i !== -1) resolve({ child, url: JSON.parse(out.slice(0, i)).url });
    });
    child.on('error', reject);
  });
}

test('every template in four states; approve changes the file and the counter', async ({ page }) => {
  const L = library();
  const s = await start(L.lib);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/fonts\.g|net::/.test(m.text()) && errors.push(m.text()));
  await page.route('https://fonts.googleapis.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '' })
  );
  try {
    await page.goto(s.url);
    await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
    // The token leaves the address bar at once.
    expect(page.url()).not.toContain('token');
    const n = counts(L.lib); // 37 reviewed; the drafts include the radius-pill draft made above
    expect(n.reviewed).toBe(37);
    await expect(page.locator('#count-reviewed')).toHaveText(String(n.reviewed));
    await expect(page.locator('#count-drafts')).toHaveText(String(n.draft));

    await page.locator('.r-tab[data-element="radius"]').click();
    const card = page.locator('.r-card[data-template="radius-pill"]');
    await expect(card).toHaveAttribute('data-state', 'draft');
    await expect(page.locator('.r-card')).toHaveCount(4);
    // Four states, each a drawn landing scene in its language and mode.
    const scenes = card.locator('.r-scene');
    await expect(scenes).toHaveCount(4);
    await card.scrollIntoViewIfNeeded();
    await expect(card.locator('.r-scene[data-drawn="true"]')).toHaveCount(4);
    const states = await scenes.evaluateAll((hosts) =>
      hosts.map((h) => {
        const scene = h.shadowRoot.querySelector('.scene');
        return [scene.getAttribute('lang'), scene.getAttribute('dir'), scene.getAttribute('data-mode')];
      })
    );
    expect(states).toEqual([
      ['ar', 'rtl', 'light'],
      ['ar', 'rtl', 'dark'],
      ['en', 'ltr', 'light'],
      ['en', 'ltr', 'dark']
    ]);
    // The scene uses this template's corners (the pill radius, 24px medium).
    const radius = await scenes
      .first()
      .evaluate((h) => h.shadowRoot.querySelector('.scene').style.getPropertyValue('--radius-md'));
    expect(radius).toBe('24px');

    await card.locator('[data-action="approve"]').click();
    await expect(page.locator('#count-reviewed')).toHaveText(String(n.reviewed + 1));
    await expect(page.locator('#count-drafts')).toHaveText(String(n.draft - 1));
    await expect(page.locator('.r-card[data-template="radius-pill"]')).toHaveAttribute('data-state', 'reviewed');
    const saved = JSON.parse(fs.readFileSync(L.file, 'utf8')).find((t) => t.id === 'radius-pill');
    expect(saved.status.state).toBe('reviewed');
    expect(saved.status.reviewedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    // Back to draft, and the interface in English.
    await page.locator('.r-card[data-template="radius-pill"] [data-action="draft"]').click();
    await expect(page.locator('#count-reviewed')).toHaveText(String(n.reviewed));
    await page.locator('#r-lang').click();
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(page.locator('.r-card[data-template="radius-pill"] [data-action="approve"]')).toHaveText('Approve');
    expect(errors).toEqual([]);
  } finally {
    s.child.kill();
    fs.rmSync(L.dir, { recursive: true, force: true });
  }
});

test('a broken entry gets its own card and never hides the others', async ({ page }) => {
  const L = library();
  const colors = path.join(L.lib, 'elements', 'colors.json');
  const list = JSON.parse(fs.readFileSync(colors, 'utf8'));
  const odd = JSON.parse(JSON.stringify(list[0]));
  Object.assign(odd, { id: 'palette-odd', tags: 'minimal', status: { state: 'draft' } });
  list.splice(1, 0, null, odd);
  fs.writeFileSync(colors, JSON.stringify(list, null, 2) + '\n');
  const s = await start(L.lib);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('https://fonts.googleapis.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '' })
  );
  try {
    await page.goto(s.url);
    await expect(page.locator('html')).toHaveAttribute('data-ready', 'true');
    // 3 palettes + the odd draft as cards, the null entry as a broken card; all in file order.
    await expect(page.locator('.r-card[data-template]')).toHaveCount(4);
    await expect(page.locator('.r-card[data-broken="2"]')).toHaveCount(1);
    await expect(page.locator('.r-card[data-template="palette-odd"] .r-problems')).toBeVisible();
    await expect(page.locator('.r-card[data-template="palette-odd"] [data-action="approve"]')).toBeDisabled();
    // The library's drafts, the radius test draft and palette-odd (the null entry is no template).
    await expect(page.locator('#count-drafts')).toHaveText(String(counts(L.lib).draft));
    expect(errors).toEqual([]);
  } finally {
    s.child.kill();
    fs.rmSync(L.dir, { recursive: true, force: true });
  }
});

test('without the token the page says how to open it and loads nothing', async ({ page }) => {
  const L = library();
  const s = await start(L.lib);
  try {
    await page.goto(s.url.split('#')[0]);
    await expect(page.locator('#r-message')).toContainText('npm run review');
    await expect(page.locator('.r-card')).toHaveCount(0);
  } finally {
    s.child.kill();
    fs.rmSync(L.dir, { recursive: true, force: true });
  }
});
