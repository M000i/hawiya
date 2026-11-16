// Task 2.18 (R-024, AC-16): «Fill the rest for me» shows after two choices, fills every other element within the
// blocking rules, marks the filled ones, and gives the same result as the core module for the same choices.
'use strict';
const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const PAGE = pathToFileURL(path.join(__dirname, '../../picker/index.html')).href;
const ar = require('../../picker/i18n/ar.js');
const en = require('../../picker/i18n/en.js');
const autofill = require('../../picker/js/core/autofill.js');
const build = require('../../tools/build.js');

const data = build.select(build.load(path.join(__dirname, '../../library'))).data;
const ELEMENTS = require('../../picker/js/core/resolve.js').ELEMENTS;

function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/fonts\.googleapis|ERR_|net::/.test(m.text())) errors.push(m.text());
  });
  return errors;
}
async function start(page) {
  await page.route('https://fonts.googleapis.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '' })
  );
  await page.goto(PAGE);
}
const box = (page) => page.locator('#autofill');
const marked = (page) =>
  page
    .locator('#element-list [data-element]:has(.g-toggle [data-auto-filled])')
    .evaluateAll((n) => n.map((x) => x.getAttribute('data-element')));
const state = (page) =>
  page.evaluate(() => ({
    choices: window.Hawiya.state.choices(),
    chosen: window.Hawiya.state.chosen(),
    identity: window.Hawiya.state.identity(),
    allowed: window.Hawiya.rules.identity(window.Hawiya.state.identity(), window.Hawiya.library.find).allowed
  }));

// A color and a font, as the owner would pick them in the quick choices.
async function pickColorAndFont(page) {
  await page.locator('#swatches .swatch').nth(2).click();
  await page.locator('#fonts input[value="pair-cairo"]').check();
}

test('after a color and a font, the button fills the other nine elements within the rules and marks them', async ({
  page
}) => {
  const errors = watchErrors(page);
  await start(page);
  await expect(box(page)).toBeHidden(); // nothing chosen yet
  await page.locator('#swatches .swatch').nth(2).click();
  await expect(box(page)).toBeHidden(); // one choice is not enough
  await page.locator('#fonts input[value="pair-cairo"]').check();
  await expect(box(page)).toBeVisible();
  await expect(page.locator('#autofill-lead')).toHaveText(
    ar['autofill.lead'].replace('{chosen}', '2').replace('{total}', '11')
  );
  const before = await state(page);
  expect(before.chosen).toEqual(['colors', 'fonts']);
  // Not decided by the user: still the starting point's, so already marked «filled automatically».
  expect(await marked(page)).toEqual(ELEMENTS.filter((e) => !['colors', 'fonts'].includes(e)));

  await page.locator('#autofill-btn').click();
  const missing = ELEMENTS.filter((e) => !['colors', 'fonts'].includes(e));
  await expect.poll(() => marked(page)).toEqual(missing);
  await expect(page.locator('#autofill-note')).toHaveText(ar['autofill.done'].replace('{count}', '9'));
  await expect(page.locator('[data-element="radius"] [data-auto-filled]')).toHaveText(ar['autofill.mark']);
  const after = await state(page);
  expect(after.allowed).toBe(true);
  expect(after.identity.autoFilled).toEqual(missing);
  expect(after.chosen).toEqual(['colors', 'fonts']); // filling chooses nothing for the user
  for (const e of ['colors', 'fonts']) expect(after.choices.selections[e]).toEqual(before.choices.selections[e]);
  // The page gives exactly what the core module gives for the same choices.
  const expected = autofill.fill(before.choices, before.chosen, data);
  expect(after.choices.selections).toEqual(expected.choices.selections);
  // Pressing again with nothing changed gives the same result.
  await page.locator('#autofill-btn').click();
  await expect(page.locator('#autofill-note')).toHaveText(ar['autofill.done'].replace('{count}', '9'));
  expect((await state(page)).choices).toEqual(after.choices);
  expect(errors).toEqual([]);
});

test('changing a filled element makes it the user’s: its mark goes; marks follow the language and a reload', async ({
  page
}) => {
  await start(page);
  await pickColorAndFont(page);
  await page.locator('#autofill-btn').click();
  await expect.poll(async () => (await marked(page)).length).toBe(9);

  // Pick another radius in the advanced list.
  const radius = (await state(page)).choices.selections.radius.template;
  const other = radius === 'radius-sharp' ? 'radius-medium' : 'radius-sharp';
  await page.locator('[data-element="radius"] > .g-toggle').click();
  await page.locator(`#g-panel-radius [data-template="${other}"]`).click();
  await expect(page.locator('[data-element="radius"] [data-auto-filled]')).toHaveCount(0);
  let s = await state(page);
  expect(s.identity.autoFilled).not.toContain('radius');
  expect(s.chosen).toEqual(['colors', 'fonts', 'radius']);
  await expect(page.locator('#autofill-note')).toHaveText(''); // the last message no longer applies

  await page.locator('#lang-toggle').click();
  await expect(page.locator('[data-element="shadows"] [data-auto-filled]')).toHaveText(en['autofill.mark']);
  await expect(page.locator('#autofill-lead')).toHaveText(
    en['autofill.lead'].replace('{chosen}', '3').replace('{total}', '11')
  );

  // After a reload the draft keeps the marks, and what the user chose is still theirs.
  await page.reload();
  await expect.poll(() => marked(page)).toEqual(ELEMENTS.filter((e) => !['colors', 'fonts', 'radius'].includes(e)));
  s = await state(page);
  expect(s.chosen).toEqual(['colors', 'fonts', 'radius']);
});

test('a ready identity is a choice for every element: no button and no marks', async ({ page }) => {
  await start(page);
  await pickColorAndFont(page);
  await page.locator('#autofill-btn').click();
  await expect.poll(async () => (await marked(page)).length).toBe(9);
  await page.locator('[data-identity="warm-friendly"]').click();
  await expect(box(page)).toBeHidden();
  expect(await marked(page)).toEqual([]);
  const s = await state(page);
  expect(s.identity.autoFilled).toEqual([]);
  expect(s.chosen).toEqual(ELEMENTS);
});

// (AAA with the colors themselves left to fill is in tests/autofill.test.js.)
test('at AAA, the filled identity still passes 7:1 and nothing is refused', async ({ page }) => {
  await start(page);
  await page.locator('[data-element="colors"] > .g-toggle').click();
  await page.locator('[data-contrast-level="AAA"]').click();
  await page.locator('#rules [data-rules-apply]').click(); // the suggested colors (every palette misses 7:1)
  await page.locator('[data-element="radius"] > .g-toggle').click();
  await page.locator('#g-panel-radius [data-template="radius-round"]').click();
  await page.locator('[data-element="spacing"] > .g-toggle').click();
  await page.locator('#g-panel-spacing [data-template="spacing-airy"]').click();
  const before = await state(page);
  expect(before.chosen).toEqual(['colors', 'radius', 'spacing']); // accepting the suggested colors chose them
  await page.locator('#autofill-btn').click();
  await expect.poll(async () => (await marked(page)).length).toBe(8);
  const after = await state(page);
  expect(after.allowed).toBe(true);
  expect(after.identity.project.contrast).toBe('AAA');
  await expect(page.locator('#rules [data-rules-block]')).toHaveCount(0);
});

test('review fixes: picking the filled card makes it a choice; the two settings alone do not show the button', async ({
  page
}) => {
  await start(page);
  // Only the mode and the direction: settings say nothing about style, so there is nothing to match against.
  await page.locator('[data-element="modes"] > .g-toggle').click();
  await page.locator('#g-panel-modes [data-template="modes-light-first"]').click();
  await page.locator('[data-element="direction"] > .g-toggle').click();
  await page.locator('#g-panel-direction [data-template="direction-both"]').click();
  expect((await state(page)).chosen).toEqual(['modes', 'direction']);
  await expect(box(page)).toBeHidden();

  await pickColorAndFont(page);
  await page.locator('#autofill-btn').click();
  await expect.poll(async () => (await marked(page)).length).toBe(7);
  // Clicking the card that is already in place is a choice too: its mark goes.
  const radius = (await state(page)).choices.selections.radius.template;
  await page.locator('[data-element="radius"] > .g-toggle').click();
  await page.locator(`#g-panel-radius [data-template="${radius}"]`).click();
  await expect(page.locator('[data-element="radius"] [data-auto-filled]')).toHaveCount(0);
  const s = await state(page);
  expect(s.chosen).toContain('radius');
  expect(s.identity.autoFilled).not.toContain('radius');
  expect(s.choices.selections.radius.template).toBe(radius);
});
