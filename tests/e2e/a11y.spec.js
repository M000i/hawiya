// Task 2.22 (spec section 6): the tool works with the keyboard alone, every stop shows a focus ring, motion stops
// with «reduce motion», the tool's own text reaches WCAG AA, and nothing scrolls sideways at 375 px.
'use strict';
const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const PAGE = pathToFileURL(path.join(__dirname, '../../picker/index.html')).href;
const ELEMENTS = require('../../picker/js/core/resolve.js').ELEMENTS;

async function start(page) {
  await page.route('https://fonts.googleapis.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '' })
  );
  await page.goto(PAGE);
}

// Opens every part of the page that has controls: all galleries, the guided questions, the export result.
async function openEverything(page) {
  for (const e of ['identities'].concat(ELEMENTS)) {
    await page.locator(`[data-element="${e}"] > .g-toggle`).click();
  }
  for (const e of ELEMENTS) await expect(page.locator(`#g-panel-${e} [data-template]`).first()).toBeVisible();
  await page.locator('#guided-start').click();
  await expect(page.locator('#guided-body')).toBeVisible();
  await page.locator('#export-btn').click();
  await expect(page.locator('#export-actions')).toBeVisible();
}

// The element that really has the focus (inside the preview's shadow root too) and whether its ring shows.
const focused = (page) =>
  page.evaluate(() => {
    let el = document.activeElement;
    while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
    if (!el || el === document.body) return null;
    const cs = getComputedStyle(el);
    let ring = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2;
    // A color swatch is a hidden radio input: its ring is drawn on the swatch next to it.
    if (!ring && el.matches('.swatch input')) ring = getComputedStyle(el.nextElementSibling).outlineStyle !== 'none';
    const r = el.getBoundingClientRect();
    const key = [el.tagName, el.id, el.className, el.getAttribute('data-template'), el.getAttribute('data-identity')]
      .filter(Boolean)
      .join('|');
    return { key, ring, visible: r.width > 0 && r.height > 0, identity: el.getAttribute('data-identity'), id: el.id };
  });

async function tabTo(page, match, limit = 200) {
  for (let i = 0; i < limit; i++) {
    await page.keyboard.press('Tab');
    const f = await focused(page);
    if (f && match(f)) return f;
  }
  throw new Error('not reached with Tab');
}

test('keyboard only: choose a ready identity, export, and download, with a visible ring at every stop', async ({
  page
}) => {
  await start(page);
  const stops = [];
  const watch = (f) => {
    stops.push(f);
    return f;
  };
  // Open the ready identities and pick «warm friendly» with Enter.
  await tabTo(page, (f) => watch(f).identity === 'warm-friendly');
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-identity="warm-friendly"]')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => window.Hawiya.state.identity().selections.buttons.template)).toBe('button-soft');
  // On to «Export».
  await tabTo(page, (f) => watch(f).id === 'export-btn');
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-hawiya-export', 'ready');
  // «Download» with the keyboard too.
  await tabTo(page, (f) => watch(f).id === 'download-btn');
  const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Enter')]);
  expect(download.suggestedFilename()).toBe('hawiya-design.zip');
  const noRing = stops.filter((f) => !f.ring || !f.visible);
  expect(noRing).toEqual([]);
  expect(stops.length).toBeGreaterThan(5);
});

test('every keyboard stop of the whole page shows a focus ring (galleries, guided mode, export, preview)', async ({
  page
}) => {
  await start(page);
  await openEverything(page);
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  const stops = [];
  for (let i = 0; i < 400; i++) {
    await page.keyboard.press('Tab');
    const f = await focused(page);
    if (!f) continue;
    if (stops.length > 5 && f.key === stops[0].key) break; // back at the start
    stops.push(f);
  }
  expect(stops.length).toBeGreaterThan(80);
  expect(stops.filter((f) => !f.ring || !f.visible)).toEqual([]);
});

// Everything that would move (transitions, animations), in the page and inside every shadow root.
const moving = (page) =>
  page.evaluate(() => {
    const out = [];
    const scan = (root) =>
      root.querySelectorAll('*').forEach((el) => {
        const cs = getComputedStyle(el);
        if (cs.transitionDuration.split(',').some((x) => parseFloat(x) > 0) || cs.animationName !== 'none') {
          out.push(el.tagName + '.' + el.className);
        }
        if (el.shadowRoot) scan(el.shadowRoot);
      });
    scan(document);
    return out;
  });

test('with «reduce motion» nothing moves, in the page or in the previews', async ({ browser }) => {
  for (const reducedMotion of ['no-preference', 'reduce']) {
    const context = await browser.newContext({ reducedMotion });
    const page = await context.newPage();
    await start(page);
    await page.locator('[data-element="buttons"] > .g-toggle').click();
    await expect(page.locator('#g-panel-buttons [data-template]').first()).toBeVisible();
    const found = await moving(page);
    if (reducedMotion === 'reduce') expect(found).toEqual([]);
    else expect(found.length).toBeGreaterThan(0); // the check does see motion when it is allowed
    await context.close();
  }
});

test('the tool’s own text reaches WCAG AA in both languages', async ({ page }) => {
  await start(page);
  await openEverything(page);
  for (const lang of ['ar', 'en']) {
    if (lang === 'en') await page.locator('#lang-toggle').click();
    const low = await page.evaluate(() => {
      const rgb = (s) => {
        const m = s.match(/rgba?\(([^)]+)\)/);
        if (!m) return null;
        const v = m[1]
          .split(/[ ,/]+/)
          .filter(Boolean)
          .map(Number);
        return { r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1 };
      };
      const lum = (c) => {
        const f = (x) => ((x /= 255) <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
        return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
      };
      const mix = (c, base) => ({
        r: c.r * c.a + base.r * (1 - c.a),
        g: c.g * c.a + base.g * (1 - c.a),
        b: c.b * c.a + base.b * (1 - c.a)
      });
      const bgOf = (el) => {
        const layers = [];
        for (let n = el; n; n = n.parentElement) {
          const c = rgb(getComputedStyle(n).backgroundColor);
          if (c && c.a > 0) {
            layers.push(c);
            if (c.a >= 1) break;
          }
        }
        return layers.reduceRight((base, c) => mix(c, base), { r: 255, g: 255, b: 255 });
      };
      const out = [];
      const seen = new Set();
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = walker.nextNode())) {
        const el = n.parentElement;
        if (!el || seen.has(el) || !n.textContent.trim()) continue;
        seen.add(el);
        // The previews and samples show the identity being chosen (the rules check its contrast), not the tool.
        if (el.closest('#preview, .g-sample, .c-swatch, script, style, textarea')) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || el.getClientRects().length === 0) continue;
        const bg = bgOf(el);
        const fg = mix(rgb(cs.color), bg);
        const ratio = (Math.max(lum(fg), lum(bg)) + 0.05) / (Math.min(lum(fg), lum(bg)) + 0.05);
        const size = parseFloat(cs.fontSize);
        const large = size >= 24 || (parseInt(cs.fontWeight, 10) >= 700 && size >= 18.66);
        if (ratio < (large ? 3 : 4.5)) out.push({ text: n.textContent.trim().slice(0, 30), ratio: ratio.toFixed(2) });
      }
      return { out, checked: seen.size };
    });
    expect(low.out, lang).toEqual([]);
    expect(low.checked).toBeGreaterThan(100);
  }
});

test('phone width 375: no sideways scroll in either language, with everything open and a rule message shown', async ({
  page
}) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await start(page);
  await openEverything(page);
  await page.locator('[data-contrast-level="AAA"]').click(); // a blocking message with its suggestion
  await expect(page.locator('#rules [data-rules-block]')).toBeVisible();
  for (const lang of ['ar', 'en']) {
    if (lang === 'en') await page.locator('#lang-toggle').click();
    for (const scene of ['landing', 'dashboard', 'form', 'mobile']) {
      await page.locator(`[data-preview-scene="${scene}"]`).click();
      const wide = await page.evaluate(() => {
        const d = document.documentElement;
        return { scroll: d.scrollWidth - d.clientWidth, body: document.body.scrollWidth - d.clientWidth };
      });
      expect([lang, scene, wide]).toEqual([lang, scene, { scroll: 0, body: 0 }]);
    }
  }
});
