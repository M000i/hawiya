// Task 2.9 (R-023, R-044, R-045, R-046, R-050): the advanced mode lists the 12 elements; an element's data file
// is requested only when it is first opened (or when the identity needs it); numeric elements are chosen from
// cards and adjusted with sliders that change the preview.
'use strict';
const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const PAGE = pathToFileURL(path.join(__dirname, '../../picker/index.html')).href;
// Written on the first library (37 templates, 2 identities): run on a copy of the page with that data (task 3.14).
const FIRST = require('../helpers/first-library.js').firstPickerPage();
// The published library, for the tests that run on the real page.
const PUBLISHED = (() => {
  const b = require('../../tools/build.js');
  return b.select(b.load(path.join(__dirname, '../../library'))).data.templates;
})();
const ar = require('../../picker/i18n/ar.js');
const en = require('../../picker/i18n/en.js');
const ELEMENTS = [
  'colors',
  'modes',
  'fonts',
  'type-scale',
  'radius',
  'shadows',
  'icons',
  'buttons',
  'cards',
  'spacing',
  'direction'
];

function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

// Every way of telling that data/<element>.js was requested: script elements, resource timing, the loaded data.
const requested = (page) =>
  page.evaluate((elements) => {
    const scripts = Array.from(document.scripts).map((s) => s.getAttribute('src') || '');
    const timing = performance.getEntriesByType('resource').map((r) => r.name);
    return elements.filter(
      (e) =>
        scripts.some((s) => s.endsWith(`data/${e}.js`)) ||
        timing.some((n) => n.endsWith(`/data/${e}.js`)) ||
        window.Hawiya.library.isLoaded(e)
    );
  }, ELEMENTS);
const toggle = (page, el) => page.locator(`[data-element="${el}"] > .g-toggle`);
const panel = (page, el) => page.locator(`#g-panel-${el}`);
const slider = (page, el, name) => panel(page, el).locator(`input[data-adjust="${name}"]`);
const scene = (page, fn) => page.evaluate(`(${fn})(document.getElementById('preview').shadowRoot)`);

async function setRange(locator, value) {
  await locator.evaluate((input, v) => {
    input.value = String(v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

test('the advanced mode lists the 12 elements in the interface language', async ({ page }) => {
  await page.goto(PAGE);
  const labels = page.locator('#element-list .g-toggle-label');
  await expect(labels).toHaveCount(12);
  const keys = [
    'identities',
    'colors',
    'modes',
    'fonts',
    'typeScale',
    'radius',
    'shadows',
    'icons',
    'buttons',
    'cards',
    'spacing',
    'direction'
  ];
  await expect(labels).toHaveText(keys.map((k) => ar[`element.${k}`]));
  await page.locator('#lang-toggle').click();
  await expect(labels).toHaveText(keys.map((k) => en[`element.${k}`]));
});

test('no element data file is requested before its gallery is opened, and each loads once', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto(PAGE);
  expect(await requested(page)).toEqual([]);
  // The page works fully on the starter data: preview, quick controls, ready identities.
  await page.locator('[data-identity="warm-friendly"]').click();
  expect(await requested(page)).toEqual([]);

  await toggle(page, 'radius').click();
  await expect(panel(page, 'radius').locator('[data-template]')).toHaveCount(PUBLISHED.radius.length);
  expect(await requested(page)).toEqual(['radius']);
  await toggle(page, 'radius').click(); // close
  await toggle(page, 'radius').click(); // reopen
  await toggle(page, 'spacing').click();
  await expect(panel(page, 'spacing').locator('[data-template]')).toHaveCount(PUBLISHED.spacing.length);
  expect(await requested(page)).toEqual(['radius', 'spacing']);
  const scripts = await page.evaluate(() =>
    Array.from(document.querySelectorAll('script[data-element]')).map((s) => s.getAttribute('data-element'))
  );
  expect(scripts).toEqual(['radius', 'spacing']);
  // Two requests at the same moment (e.g. a fast double click) still add one script.
  const icons = await page.evaluate(async () => {
    await Promise.all([
      window.Hawiya.library.load('icons'),
      window.Hawiya.library.load('icons'),
      window.Hawiya.gallery.open('icons')
    ]);
    return document.querySelectorAll('script[data-element="icons"]').length;
  });
  expect(icons).toBe(1);
  expect(errors).toEqual([]);
});

test('corners: cards choose, sliders adjust, and the preview cards and buttons follow', async ({ page }) => {
  await page.goto(FIRST);
  await page.locator('[data-preview-mode="light"]').click();
  await toggle(page, 'radius').click();
  const cards = panel(page, 'radius').locator('[data-template]');
  await expect(cards).toHaveCount(3);
  await expect(panel(page, 'radius').locator('[data-template="radius-medium"]')).toHaveAttribute(
    'aria-pressed',
    'true'
  );

  await setRange(slider(page, 'radius', 'lg'), 30);
  expect(await scene(page, (r) => getComputedStyle(r.querySelector('.hw-card')).borderTopLeftRadius)).toBe('30px');
  await expect(panel(page, 'radius').locator('output').nth(2)).toHaveText('30 px');
  await setRange(slider(page, 'radius', 'md'), 2);
  expect(await scene(page, (r) => getComputedStyle(r.querySelector('.hw-btn')).borderTopLeftRadius)).toBe('2px');
  expect(await page.evaluate(() => window.Hawiya.state.choices().selections.radius)).toEqual({
    template: 'radius-medium',
    overrides: { lg: 30, md: 2 }
  });
  // Back to the template's own value: the adjustment is dropped.
  await setRange(slider(page, 'radius', 'md'), 8);
  expect(await page.evaluate(() => window.Hawiya.state.choices().selections.radius)).toEqual({
    template: 'radius-medium',
    overrides: { lg: 30 }
  });

  // Another card: adjustments cleared, preview follows, sliders show the new values.
  await panel(page, 'radius').locator('[data-template="radius-round"]').click();
  await expect(panel(page, 'radius').locator('[data-template="radius-round"]')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => window.Hawiya.state.choices().selections.radius)).toEqual({
    template: 'radius-round'
  });
  expect(await scene(page, (r) => getComputedStyle(r.querySelector('.hw-card')).borderTopLeftRadius)).toBe('24px');
  await expect(slider(page, 'radius', 'lg')).toHaveValue('24');
  await expect(toggle(page, 'radius').locator('.g-toggle-current')).toHaveText('زوايا دائرية');
});

test('type scale, shadows and spacing: cards and sliders change the identity and the preview', async ({ page }) => {
  await page.goto(FIRST);
  // Type scale: a larger body size enlarges the preview text; a value giving sizes beyond 200 px is refused.
  await toggle(page, 'type-scale').click();
  await expect(panel(page, 'type-scale').locator('[data-template]')).toHaveCount(3);
  const bodySize = () => scene(page, (r) => getComputedStyle(r.querySelector('.sc-lead')).fontSize);
  const before = await bodySize();
  await setRange(slider(page, 'type-scale', 'base'), 20);
  expect(await bodySize()).toBe('20px');
  expect(before).toBe('16px');
  // Ratio 2 at body size 20 gives a 320 px heading: refused, the slider shows the real ratio again.
  await setRange(slider(page, 'type-scale', 'ratio'), 2);
  await expect(panel(page, 'type-scale').locator('.g-refused')).toBeVisible();
  expect(await page.evaluate(() => window.Hawiya.state.identity().tokens.typeScale.ratio)).toBe(1.25);
  await expect(slider(page, 'type-scale', 'ratio')).toHaveValue('1.25');
  await setRange(slider(page, 'type-scale', 'ratio'), 1.2);
  await expect(panel(page, 'type-scale').locator('.g-refused')).toBeHidden();

  // Shadows: strength 0 makes every layer transparent; strength 1 is the template itself.
  await toggle(page, 'shadows').click();
  await expect(panel(page, 'shadows').locator('[data-template]')).toHaveCount(3);
  await setRange(slider(page, 'shadows', 'strength'), 0);
  const alphas = await page.evaluate(() => {
    const s = window.Hawiya.state.identity().tokens.shadow;
    return ['light', 'dark'].flatMap((m) => ['sm', 'md', 'lg'].flatMap((k) => s[m][k].map((l) => l.alpha)));
  });
  expect(alphas.length).toBeGreaterThan(0);
  expect(alphas.every((a) => a === 0)).toBe(true);
  await setRange(slider(page, 'shadows', 'strength'), 1);
  expect(await page.evaluate(() => window.Hawiya.state.choices().selections.shadows)).toEqual({
    template: 'shadow-soft'
  });

  // Spacing: a larger unit widens the preview's spacing variables.
  await toggle(page, 'spacing').click();
  await setRange(slider(page, 'spacing', 'unit'), 8);
  expect(
    await scene(page, (r) => getComputedStyle(r.querySelector('.scene')).getPropertyValue('--space-unit').trim())
  ).toBe('8px');
  await panel(page, 'spacing').locator('[data-template="spacing-compact"]').click();
  expect(
    await scene(page, (r) => getComputedStyle(r.querySelector('.scene')).getPropertyValue('--space-1').trim())
  ).toBe('2px');
});

test('a choice outside the starter set survives a reload: only that element loads at start', async ({ page }) => {
  await page.goto(FIRST);
  await toggle(page, 'radius').click();
  await panel(page, 'radius').locator('[data-template="radius-sharp"]').click();
  await page.reload();
  expect(await page.evaluate(() => window.Hawiya.state.choices().selections.radius)).toEqual({
    template: 'radius-sharp'
  });
  expect(await requested(page)).toEqual(['radius']);
  await expect(page.locator('#saved-note')).toHaveText('');
});

test('a saved identity that uses a non-starter template opens on a fresh page (its element loads first)', async ({
  page
}) => {
  await page.goto(FIRST);
  await toggle(page, 'spacing').click();
  // spacing-compact is used by no ready identity, so it is not in the starter data.
  await panel(page, 'spacing').locator('[data-template="spacing-compact"]').click();
  await page.locator('#identity-name').fill('واسعة');
  await page.locator('#save-btn').click();
  // Back to a starter-only draft, then a fresh page: spacing is not loaded until the entry is opened.
  await page.locator('[data-identity="calm-corporate"]').click();
  await page.locator('#identity-name').fill('مؤسسي هادئ');
  await page.reload();
  expect(await requested(page)).toEqual([]);
  await page.locator('.saved-item button[data-open]').click();
  await expect(page.locator('#identity-name')).toHaveValue('واسعة');
  expect(await page.evaluate(() => window.Hawiya.state.choices().selections.spacing)).toEqual({
    template: 'spacing-compact'
  });
  expect(await requested(page)).toEqual(['spacing']);
});

test('the ready identity entry shows the cards; template names follow the interface language', async ({ page }) => {
  await page.goto(PAGE);
  await toggle(page, 'identities').click();
  // Every published ready identity: the ten of the first version, and those of CHG-3 once reviewed (task 5.6).
  const published = await page.evaluate(() => window.Hawiya.data.identities.length);
  expect(published).toBeGreaterThanOrEqual(10);
  await expect(panel(page, 'identities').locator('[data-identity]')).toHaveCount(published);
  await panel(page, 'identities').locator('[data-identity="warm-friendly"]').click();
  await expect(page.locator('#identity-list [data-identity="warm-friendly"]')).toHaveAttribute('aria-pressed', 'true');
  await toggle(page, 'radius').click();
  await expect(panel(page, 'radius').locator('.g-card-name').first()).toHaveText('زوايا حادة');
  await page.locator('#lang-toggle').click();
  await expect(panel(page, 'radius').locator('.g-card-name').first()).toHaveText('Sharp corners');
  await expect(toggle(page, 'radius').locator('.g-toggle-current')).toHaveText('Round corners');
});

// Task 3.9: a mode setting without the light/dark switch shows its one mode only; with it, both modes.
test('a mode card shows one swatch when the app has no light/dark switch', async ({ page }) => {
  await page.goto(PAGE);
  const out = await page.evaluate(() => {
    const H = window.Hawiya;
    const ctx = {
      el: (tag, cls, text) => {
        const e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text !== undefined) e.textContent = text;
        return e;
      },
      t: (k, v) => H.i18n.t(k, v)
    };
    const card = (def, sw) =>
      H.galleryParts.modes.sample({ tokens: { mode: { default: { $value: def }, switch: { $value: sw } } } }, ctx);
    return [card('dark', 'none'), card('dark', 'offered'), card('light', 'none')].map((b) =>
      [...b.querySelectorAll('.m-swatch')].map((s) => s.getAttribute('data-swatch')).join(',')
    );
  });
  expect(out).toEqual(['dark', 'dark,light', 'light']);
});

// Task 3.14 (AC-10, AC-11): on the published page, each element's gallery shows every published template, and only
// those: no draft reaches the page.
test('each gallery shows every published template of its element, and nothing else', async ({ page }) => {
  test.setTimeout(120000);
  const build = require('../../tools/build.js');
  const lib = build.load(path.join(__dirname, '../../library'));
  const published = build.select(lib).data.templates;
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('https://fonts.googleapis.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '' })
  );
  await page.goto(PAGE);
  for (const e of Object.keys(published)) {
    await toggle(page, e).click();
    const shown = panel(page, e).locator('[data-template]');
    await expect(shown).toHaveCount(published[e].length);
    const ids = await shown.evaluateAll((n) => n.map((x) => x.getAttribute('data-template')));
    expect(ids.sort()).toEqual(published[e].map((t) => t.id).sort());
    const drafts = lib.templates[e].filter((t) => t.status.state !== 'reviewed').map((t) => t.id);
    expect(ids.filter((id) => drafts.includes(id))).toEqual([]);
    await toggle(page, e).click();
  }
  expect(errors).toEqual([]);
});
