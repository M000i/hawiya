// Task 2.19 (R-021, R-022, AC-15): the guided mode asks eight questions in order; every answer updates the preview;
// the rest is derived; the result is a complete identity with motion, numerals and calendar; the advanced mode is
// reachable at any moment.
'use strict';
const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const PAGE = pathToFileURL(path.join(__dirname, '../../picker/index.html')).href;
// Written on the first library (37 templates, 2 identities): run on a copy of the page with that data (task 3.14).
const FIRST = require('../helpers/first-library.js').firstPickerPage();
const ar = require('../../picker/i18n/ar.js');
const en = require('../../picker/i18n/en.js');
const ELEMENTS = require('../../picker/js/core/resolve.js').ELEMENTS;

const ORDER = ['mood', 'colors', 'fonts', 'radius', 'spacing', 'icons', 'motion', 'language'];

function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/fonts\.googleapis|ERR_|net::/.test(m.text())) errors.push(m.text());
  });
  return errors;
}
async function start(page, url = PAGE) {
  await page.route('https://fonts.googleapis.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '' })
  );
  await page.goto(url);
}
const step = (page) => page.locator('#guided-question').getAttribute('data-guided-step');
const state = (page) =>
  page.evaluate(() => {
    const H = window.Hawiya;
    const id = H.state.identity();
    return {
      id,
      chosen: H.state.chosen(),
      valid: H.validate.check('identity', id).valid,
      allowed: H.rules.identity(id, H.library.find).allowed
    };
  });
// The preview's button: what the user sees change with each answer.
const previewButton = (page) =>
  page.evaluate(() => {
    const b = document.getElementById('preview').shadowRoot.querySelector('.hw-btn');
    const cs = getComputedStyle(b);
    return { radius: cs.borderTopLeftRadius, fill: cs.backgroundColor, font: cs.fontFamily };
  });

async function answer(page, selector) {
  await page.locator(`#guided-options ${selector}`).click();
  await expect(page.locator(`#guided-options ${selector}`)).toHaveAttribute('aria-pressed', 'true');
}
async function next(page) {
  await page.locator('#guided-next').click();
}

test('eight questions in order build a complete identity with motion, numerals and calendar', async ({ page }) => {
  const errors = watchErrors(page);
  await start(page, FIRST);
  await expect(page.locator('#guided-body')).toBeHidden();
  await page.locator('#guided-start').click();
  await expect(page.locator('#guided-body')).toBeVisible();
  await expect(page.locator('#guided-heading')).toBeFocused();

  const seen = [];
  // 1. Character: a friendly, soft identity; everything not answered is derived from it.
  seen.push(await step(page));
  await expect(page.locator('#guided-progress')).toHaveText(
    ar['guided.progress'].replace('{n}', '1').replace('{total}', '8')
  );
  await expect(page.locator('#guided-heading')).toHaveText(ar['guided.q.mood']);
  const p0 = await previewButton(page);
  await answer(page, '[data-guided-mood="friendly"]');
  let s = await state(page);
  expect(s.id.selections.radius.template).toBe('radius-round'); // derived from «soft, playful»
  expect(s.id.selections.buttons.template).toBe('button-soft');
  expect(s.allowed).toBe(true);
  await expect.poll(() => previewButton(page)).not.toEqual(p0);
  await next(page);

  // 2. Primary color.
  seen.push(await step(page));
  let before = await previewButton(page);
  await answer(page, '[data-guided-template="palette-rose"]');
  await expect.poll(() => previewButton(page)).not.toEqual(before);
  await next(page);

  // 3. Fonts: only those that support the project language (Arabic here: no Latin-only font).
  seen.push(await step(page));
  await expect(page.locator('#guided-options [data-guided-template="font-inter"]')).toHaveCount(0);
  await expect(page.locator('#guided-options [data-guided-template="font-noto-kufi-arabic"]')).toHaveCount(1);
  await answer(page, '[data-guided-template="pair-noto-sans-arabic-noto-sans"]');
  await next(page);

  // 4. Corners.
  seen.push(await step(page));
  before = await previewButton(page);
  await answer(page, '[data-guided-template="radius-sharp"]');
  await expect.poll(async () => (await previewButton(page)).radius).not.toBe(before.radius);
  await next(page);

  // 5. Density, 6. icons.
  seen.push(await step(page));
  await answer(page, '[data-guided-template="spacing-airy"]');
  await next(page);
  seen.push(await step(page));
  await answer(page, '[data-guided-template="icons-phosphor-bold"]');
  await next(page);

  // 7. Motion: a simple choice, no gallery.
  seen.push(await step(page));
  await expect(page.locator('#guided-options [data-guided-template]')).toHaveCount(0);
  await answer(page, '[data-guided-motion="strong"]');
  await next(page);

  // 8. Language, numerals, calendar: simple choices.
  seen.push(await step(page));
  await expect(page.locator('#guided-next')).toHaveText(ar['guided.finish']);
  await answer(page, '[data-guided-direction="direction-both"]');
  await answer(page, '[data-guided-numerals="latn"]');
  await answer(page, '[data-guided-calendar="islamic-umalqura"]');
  await next(page);

  expect(seen).toEqual(ORDER);
  await expect(page.locator('#guided-done')).toBeVisible();
  await expect(page.locator('#guided-done')).toHaveText(ar['guided.done']);

  s = await state(page);
  expect(s.valid).toBe(true);
  expect(s.allowed).toBe(true);
  expect(Object.keys(s.id.selections)).toEqual(ELEMENTS);
  expect(s.id.extensions.motion).toBe('strong');
  expect(s.id.extensions.numerals).toBe('latn');
  expect(s.id.extensions.calendar).toBe('islamic-umalqura');
  expect(s.id.project.language).toBe('ar+en');
  const answered = {
    colors: 'palette-rose',
    fonts: 'pair-noto-sans-arabic-noto-sans',
    radius: 'radius-sharp',
    spacing: 'spacing-airy',
    icons: 'icons-phosphor-bold',
    direction: 'direction-both'
  };
  for (const [e, id] of Object.entries(answered)) expect(s.id.selections[e].template).toBe(id);
  // The rest was derived, and says so.
  expect(s.chosen).toEqual(ELEMENTS.filter((e) => e in answered));
  expect(s.id.autoFilled).toEqual(ELEMENTS.filter((e) => !(e in answered)));
  // The generated description says how much motion to use.
  const md = await page.evaluate(() => window.Hawiya.generate.designMd(window.Hawiya.state.identity()));
  expect(md).toContain('Motion level: **strong**');
  const files = await page.evaluate(() => window.Hawiya.generate.valueFiles(window.Hawiya.state.identity()));
  expect(JSON.parse(files['identity.json']).extensions).toMatchObject({
    motion: 'strong',
    numerals: 'latn',
    calendar: 'islamic-umalqura'
  });
  expect(errors).toEqual([]);
});

test('back keeps the answers; the advanced mode is reachable at any moment; both languages', async ({ page }) => {
  await start(page);
  await page.locator('#guided-start').click();
  await answer(page, '[data-guided-mood="technical"]');
  await next(page);
  await answer(page, '[data-guided-template="palette-teal"]');
  await page.locator('#guided-back').click();
  expect(await step(page)).toBe('mood');
  await expect(page.locator('#guided-options [data-guided-mood="technical"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#guided-back')).toBeDisabled();

  await page.locator('#lang-toggle').click();
  await expect(page.locator('#guided-heading')).toHaveText(en['guided.q.mood']);
  await expect(page.locator('#guided-options [data-guided-mood="technical"]')).toHaveText(en['guided.mood.technical']);
  await expect(page.locator('#guided-progress')).toHaveText(
    en['guided.progress'].replace('{n}', '1').replace('{total}', '8')
  );

  await page.locator('#guided-advanced').click();
  await expect(page.locator('#advanced-title')).toBeFocused();
  const s = await state(page);
  expect(s.id.selections.colors.template).toBe('palette-teal'); // nothing lost
  expect(s.chosen).toContain('colors');
});

test('choosing English with an Arabic-only font switches to a font that supports English, and says so', async ({
  page
}) => {
  await start(page);
  await page.locator('#guided-start').click();
  for (let i = 0; i < 2; i++) await next(page);
  await answer(page, '[data-guided-template="font-noto-kufi-arabic"]');
  for (let i = 0; i < 5; i++) await next(page);
  expect(await step(page)).toBe('language');
  await answer(page, '[data-guided-direction="direction-ltr"]');
  const s = await state(page);
  expect(s.id.project.language).toBe('en');
  expect(s.allowed).toBe(true);
  expect(s.id.selections.fonts.template).not.toBe('font-noto-kufi-arabic');
  await expect(page.locator('#guided-note')).toContainText(ar['guided.fontChanged'].split('«')[0]);
  await expect(page.locator('#rules [data-rules-block]')).toHaveCount(0);
});

test('starting the questions after a ready identity starts over: the character still shapes the rest', async ({
  page
}) => {
  await start(page, FIRST);
  await page.locator('[data-identity="calm-corporate"]').click();
  expect((await state(page)).chosen).toEqual(ELEMENTS); // a ready identity chooses every element
  await page.locator('#guided-start').click();
  await expect(page.locator('#guided-body')).toBeVisible();
  expect((await state(page)).chosen).toEqual([]); // nothing changed yet, nothing counts as chosen
  await answer(page, '[data-guided-mood="friendly"]');
  const s = await state(page);
  expect(s.id.selections.radius.template).toBe('radius-round');
  expect(s.id.selections.buttons.template).toBe('button-soft');
  await expect(page.locator('#autofill')).toBeHidden();
});
