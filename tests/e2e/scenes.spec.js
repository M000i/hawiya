// Task 2.7 (R-028, R-034): the four scenes work in Arabic/English × light/dark, without errors or horizontal
// scrolling, follow every choice, and the mobile scene carries the "approximate" label.
'use strict';
const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const PAGE = pathToFileURL(path.join(__dirname, '../../picker/index.html')).href;
const ar = require('../../picker/i18n/ar.js');
const en = require('../../picker/i18n/en.js');
const SCENES = ['landing', 'dashboard', 'form', 'mobile'];

function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}
const rgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;

async function show(page, scene, lang, mode) {
  await page.locator(`[data-preview-scene="${scene}"]`).click();
  await page.locator(`[data-preview-lang="${lang}"]`).click();
  await page.locator(`[data-preview-mode="${mode}"]`).click();
}

const state = (page) =>
  page.evaluate(() => {
    const root = document.getElementById('preview').shadowRoot;
    const wrap = root.querySelector('.scene');
    const btn = root.querySelector('.hw-btn');
    const doc = document.documentElement;
    return {
      scene: wrap.getAttribute('data-scene'),
      dir: wrap.getAttribute('dir'),
      mode: wrap.getAttribute('data-mode'),
      background: getComputedStyle(wrap).backgroundColor,
      buttonRadius: btn && getComputedStyle(btn).borderTopLeftRadius,
      // No horizontal scrolling: neither the page nor anything inside the scene is wider than its box.
      pageOverflow: doc.scrollWidth - doc.clientWidth,
      sceneOverflow: wrap.scrollWidth - wrap.clientWidth,
      outside: (() => {
        const box = wrap.getBoundingClientRect();
        let worst = 0;
        wrap.querySelectorAll('*').forEach((n) => {
          const r = n.getBoundingClientRect();
          if (r.width === 0) return;
          worst = Math.max(worst, box.left - r.left, r.right - box.right);
        });
        return Math.round(worst);
      })()
    };
  });

for (const scene of SCENES) {
  for (const lang of ['ar', 'en']) {
    for (const mode of ['light', 'dark']) {
      test(`${scene}: ${lang} / ${mode} works, follows choices, no horizontal scroll`, async ({ page }) => {
        const errors = watchErrors(page);
        await page.goto(PAGE);
        await show(page, scene, lang, mode);
        await expect(page.locator(`[data-preview-scene="${scene}"]`)).toHaveAttribute('aria-pressed', 'true');
        await page.locator('#radius-input').fill('16');
        const id = await page.evaluate(() => window.Hawiya.state.identity());
        const s = await state(page);
        expect([s.scene, s.dir, s.mode]).toEqual([scene, lang === 'ar' ? 'rtl' : 'ltr', mode]);
        expect(s.background).toBe(rgb(id.tokens.color[mode].background));
        expect(s.buttonRadius).toBe('16px');
        expect(s.pageOverflow).toBeLessThanOrEqual(0);
        expect(s.sceneOverflow).toBeLessThanOrEqual(0);
        expect(s.outside).toBeLessThanOrEqual(0);
        // The scene's own sample text is in the preview language
        // (the brand is the identity name: the user's own text, in any language).
        const text = (
          await page.evaluate(() => document.getElementById('preview').shadowRoot.querySelector('.scene').innerText)
        )
          .split(id.name)
          .join('');
        if (lang === 'en') expect(text).not.toMatch(/[؀-ۿ]/);
        else expect(text).toMatch(/[؀-ۿ]/);
        expect(errors).toEqual([]);
      });
    }
  }
}

test('at phone width every scene fits in both languages', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  const errors = watchErrors(page);
  await page.goto(PAGE);
  for (const scene of SCENES) {
    for (const lang of ['ar', 'en']) {
      await show(page, scene, lang, 'light');
      const s = await state(page);
      expect([scene, lang, s.pageOverflow]).toEqual([scene, lang, 0]);
      expect([scene, lang, s.outside <= 0]).toEqual([scene, lang, true]);
    }
  }
  expect(errors).toEqual([]);
});

test('the mobile scene, and only it, carries the "approximate" label in the tool language', async ({ page }) => {
  await page.goto(PAGE);
  const badge = page.locator('#approx-badge');
  await expect(badge).toBeHidden();
  await page.locator('[data-preview-scene="mobile"]').click();
  await expect(badge).toBeVisible();
  await expect(badge).toHaveText(ar['preview.approximate']);
  await page.locator('#lang-toggle').click();
  await expect(badge).toHaveText(en['preview.approximate']);
  await page.locator('[data-preview-scene="form"]').click();
  await expect(badge).toBeHidden();
  await expect(page.locator('#mobile-notice')).toHaveText(en['notice.mobile']);
});

test('dashboard numbers use the identity digits in Arabic and Latin digits in English', async ({ page }) => {
  await page.goto(PAGE);
  await show(page, 'dashboard', 'ar', 'light');
  const kpi = () =>
    page.evaluate(() => document.getElementById('preview').shadowRoot.querySelector('.sc-kpi strong').textContent);
  expect(await kpi()).toBe('48,250');
  await page.evaluate(() =>
    window.Hawiya.state.change((c) => {
      c.selections.direction.overrides = { numerals: 'arab' };
    })
  );
  expect(await kpi()).toBe('٤٨٬٢٥٠');
  await page.locator('[data-preview-lang="en"]').click();
  expect(await kpi()).toBe('48,250');
});

// Task 5.5 (R-028, R-065, B-076, B-084): at phone width every scene fits for every ready identity, the new ones of
// CHG-3 too (drawn from a copy of the page that publishes the drafts they wait for), in both languages. Their
// spacing, corners, fonts and buttons are what overflowed before (the default identity alone never did).
test('at phone width every scene fits for every ready identity, in both languages', async ({ page }) => {
  test.setTimeout(180000);
  const { fullPickerPage } = require('../helpers/full-library.js');
  await page.setViewportSize({ width: 375, height: 800 });
  await page.route('https://fonts.googleapis.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '' })
  );
  const errors = watchErrors(page);
  await page.goto(fullPickerPage());
  const ids = await page.evaluate(() => window.Hawiya.data.identities.map((i) => i.id));
  expect(ids.length).toBeGreaterThanOrEqual(14);
  const seen = [];
  for (const id of ids) {
    await page.locator(`#identity-list [data-identity="${id}"]`).click();
    for (const scene of SCENES) {
      for (const lang of ['ar', 'en']) {
        await show(page, scene, lang, 'light');
        const s = await state(page);
        seen.push([id, scene, lang, s.pageOverflow, s.outside <= 0]);
      }
    }
  }
  expect(seen.filter(([, , , pageOverflow, fits]) => pageOverflow !== 0 || !fits)).toEqual([]);
  expect(seen.length).toBe(ids.length * SCENES.length * 2);
  expect(errors).toEqual([]);
});
