// Task 2.13 (R-048, R-049, R-042, R-051, R-023): button and card cards draw their real recipe in the current
// identity's colors; the chosen recipe reaches every scene; modes and direction are simple settings.
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
const SCENES = ['landing', 'dashboard', 'form', 'mobile'];

function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/fonts\.googleapis|ERR_|net::/.test(m.text())) errors.push(m.text());
  });
  return errors;
}
async function offline(page) {
  await page.route('https://fonts.googleapis.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '' })
  );
}
async function openPanel(page, element, count) {
  await page.locator(`[data-element="${element}"] > .g-toggle`).click();
  await expect(page.locator(`#g-panel-${element} [data-template]`)).toHaveCount(count);
}
const card = (page, element, id) => page.locator(`#g-panel-${element} [data-template="${id}"]`);

// Computed style of the first element matching `selector` inside the preview scene.
const inPreview = (page, selector, props) =>
  page.evaluate(
    ([sel, p]) => {
      const n = document.getElementById('preview').shadowRoot.querySelector(sel);
      if (!n) return null;
      const cs = getComputedStyle(n);
      return Object.fromEntries(p.map((k) => [k, cs[k]]));
    },
    [selector, props]
  );
// The same inside one gallery sample (its own shadow root).
const inSample = (page, element, id, selector, props) =>
  page.evaluate(
    ([el, tid, sel, p]) => {
      const host = document.querySelector(`#g-panel-${el} [data-template="${tid}"] [data-recipe]`);
      const n = host && host.shadowRoot && host.shadowRoot.querySelector(sel);
      if (!n) return null;
      const cs = getComputedStyle(n);
      return Object.fromEntries(p.map((k) => [k, cs[k]]));
    },
    [element, id, selector, props]
  );

test('each button card draws its own recipe in the identity colors, and follows the preview mode', async ({ page }) => {
  const errors = watchErrors(page);
  await offline(page);
  await page.goto(PAGE);
  await openPanel(page, 'buttons', PUBLISHED.buttons.length);
  const PROPS = ['backgroundColor', 'color', 'borderTopColor', 'borderTopLeftRadius', 'fontFamily'];
  // Three different recipes, side by side, each in its own shadow root.
  const solid = await inSample(page, 'buttons', 'button-solid', '.hw-btn', PROPS);
  const outline = await inSample(page, 'buttons', 'button-outline', '.hw-btn', PROPS);
  const soft = await inSample(page, 'buttons', 'button-soft', '.hw-btn', PROPS);
  expect(outline.backgroundColor).toBe('rgba(0, 0, 0, 0)');
  expect(new Set([solid.backgroundColor, outline.backgroundColor, soft.backgroundColor]).size).toBe(3);
  // The chosen button in the preview is the same recipe in the same colors as its card.
  const chosen = await page.evaluate(() => window.Hawiya.state.identity().extensions.components.button);
  expect(await inPreview(page, '.hw-btn', PROPS)).toEqual(await inSample(page, 'buttons', chosen, '.hw-btn', PROPS));
  // The label is the interface's text, and the sample is a picture: no focus, no click of its own.
  await expect(card(page, 'buttons', 'button-solid').locator('[data-recipe]')).toHaveAttribute('aria-hidden', 'true');
  const label = await page.evaluate(() => {
    const host = document.querySelector('#g-panel-buttons [data-recipe="button-solid"]');
    return {
      text: host.shadowRoot.querySelector('.hw-btn').textContent,
      inert: host.shadowRoot.querySelector('.c-stage').inert
    };
  });
  expect(label).toEqual({ text: 'ابدأ الآن', inert: true });

  // A new primary color reaches the samples at once.
  await page.evaluate(() =>
    window.Hawiya.state.change((c) => {
      c.selections.colors.overrides = { primary: '#0F766E' };
    })
  );
  const after = await inSample(page, 'buttons', 'button-solid', '.hw-btn', PROPS);
  expect(after.backgroundColor).not.toBe(solid.backgroundColor);
  const primary = await page.evaluate(
    () =>
      window.Hawiya.generate
        .cssVariables(window.Hawiya.state.identity(), 'light')
        .find((p) => p[0] === '--color-primary')[1]
  );
  const asRgb = await page.evaluate((c) => {
    const n = document.createElement('i');
    n.style.color = c;
    document.body.appendChild(n);
    const v = getComputedStyle(n).color;
    n.remove();
    return v;
  }, primary);
  expect(after.backgroundColor).toBe(asRgb);

  // Dark preview: the samples switch to the dark colors too.
  await page.locator('[data-preview-mode="dark"]').click();
  const dark = await inSample(page, 'buttons', 'button-solid', '.hw-btn', PROPS);
  expect(dark.backgroundColor).not.toBe(after.backgroundColor);
  await card(page, 'buttons', 'button-solid').click();
  expect(await inPreview(page, '.hw-btn', PROPS)).toEqual(dark);
  expect(errors).toEqual([]);
});

test('choosing a button and a card changes them in every scene', async ({ page }) => {
  const errors = watchErrors(page);
  await offline(page);
  await page.goto(FIRST);
  await openPanel(page, 'buttons', 3);
  // Clicking the picture chooses the card around it.
  await card(page, 'buttons', 'button-outline').locator('[data-recipe]').click();
  await expect(card(page, 'buttons', 'button-outline')).toHaveAttribute('aria-pressed', 'true');
  await openPanel(page, 'cards', 3);
  await card(page, 'cards', 'card-elevated').click();
  await expect(card(page, 'cards', 'card-elevated')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => window.Hawiya.state.identity().extensions.components)).toEqual({
    button: 'button-outline',
    card: 'card-elevated'
  });
  const sampleCard = await inSample(page, 'cards', 'card-elevated', '.hw-card', ['boxShadow', 'borderTopColor']);
  expect(sampleCard.boxShadow).not.toBe('none');
  for (const scene of SCENES) {
    await page.locator(`[data-preview-scene="${scene}"]`).click();
    const btn = await inPreview(page, '.hw-btn', ['backgroundColor']);
    expect([scene, btn.backgroundColor]).toEqual([scene, 'rgba(0, 0, 0, 0)']);
    // Landing and mobile show a card: the elevated one has a shadow and no visible border.
    if (scene === 'landing' || scene === 'mobile') {
      expect([scene, await inPreview(page, '.hw-card', ['boxShadow', 'borderTopColor'])]).toEqual([scene, sampleCard]);
    }
  }
  // Back to the solid button: the preview button is filled again.
  await card(page, 'buttons', 'button-solid').click();
  expect((await inPreview(page, '.hw-btn', ['backgroundColor'])).backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
  expect(errors).toEqual([]);
});

test('modes: the default mode is a simple choice that the preview follows', async ({ page }) => {
  const errors = watchErrors(page);
  await offline(page);
  await page.goto(FIRST);
  await openPanel(page, 'modes', 3);
  const mode = () =>
    page.evaluate(() =>
      document.getElementById('preview').shadowRoot.querySelector('.scene').getAttribute('data-mode')
    );
  await card(page, 'modes', 'modes-dark-first').click();
  await expect(card(page, 'modes', 'modes-dark-first')).toHaveAttribute('aria-pressed', 'true');
  expect(await mode()).toBe('dark');
  await card(page, 'modes', 'modes-light-first').click();
  expect(await mode()).toBe('light');
  // Each card shows the identity's two backgrounds, the default one marked.
  const swatches = await card(page, 'modes', 'modes-dark-first')
    .locator('[data-swatch]')
    .evaluateAll((n) =>
      n.map((x) => [x.getAttribute('data-swatch'), x.getAttribute('data-default'), x.style.background])
    );
  expect(swatches.map((s) => s.slice(0, 2))).toEqual([
    ['dark', 'true'],
    ['light', null]
  ]);
  expect(swatches[0][2]).not.toBe(swatches[1][2]);
  expect(errors).toEqual([]);
});

test('direction: language cards, numerals and calendar; numerals and calendar survive a language change', async ({
  page
}) => {
  const errors = watchErrors(page);
  await offline(page);
  await page.goto(PAGE);
  await openPanel(page, 'direction', 3);
  const panel = page.locator('#g-panel-direction');
  const ext = () => page.evaluate(() => window.Hawiya.state.identity().extensions);
  const example = panel.locator('[data-direction-example]');
  await expect(example).toContainText('1,234.5');

  await panel.locator('[data-numerals="arab"]').click();
  await expect(panel.locator('[data-numerals="arab"]')).toHaveAttribute('aria-pressed', 'true');
  expect((await ext()).numerals).toBe('arab');
  await expect(example).toContainText('١٬٢٣٤٫٥');
  // The preview's Arabic numbers follow (the dashboard scene shows figures).
  await page.locator('[data-preview-scene="dashboard"]').click();
  expect(await page.evaluate(() => /[٠-٩]/.test(document.getElementById('preview').shadowRoot.textContent))).toBe(true);

  const gregorian = await example.textContent();
  await panel.locator('[data-calendar="islamic-umalqura"]').click();
  expect((await ext()).calendar).toBe('islamic-umalqura');
  await expect(example).not.toHaveText(gregorian);

  await card(page, 'direction', 'direction-ltr').click();
  let id = await page.evaluate(() => window.Hawiya.state.identity());
  expect([id.project.language, id.project.direction]).toEqual(['en', 'ltr']);
  expect(await page.evaluate(() => window.Hawiya.state.choices().selections.direction)).toEqual({
    template: 'direction-ltr',
    overrides: { numerals: 'arab', calendar: 'islamic-umalqura' }
  });
  await card(page, 'direction', 'direction-both').click();
  id = await page.evaluate(() => window.Hawiya.state.identity());
  expect([id.project.language, id.project.direction]).toEqual(['ar+en', 'both']);

  // Back to the template's own values: the adjustments are dropped.
  await panel.locator('[data-numerals="latn"]').click();
  await panel.locator('[data-calendar="gregory"]').click();
  expect(await page.evaluate(() => window.Hawiya.state.choices().selections.direction)).toEqual({
    template: 'direction-both'
  });
  expect(errors).toEqual([]);
});
