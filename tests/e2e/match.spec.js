// Task 2.17 (R-025, R-033): «Suits your choices» marks the template that best matches the other choices (and
// the session's tags when there is a session); it follows every change and the interface language.
'use strict';
const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const PAGE = pathToFileURL(path.join(__dirname, '../../picker/index.html')).href;
const ar = require('../../picker/i18n/ar.js');
const en = require('../../picker/i18n/en.js');

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
async function openPanel(page, element) {
  await page.locator(`[data-element="${element}"] > .g-toggle`).click();
  await expect(page.locator(`#g-panel-${element} [data-template]`).first()).toBeVisible();
}
const marked = (page, element) =>
  page
    .locator(`#g-panel-${element} [data-template]:has([data-fit])`)
    .evaluateAll((n) => n.map((x) => x.getAttribute('data-template')));

test('calm corporate: the badge sits on the matching button, card and radius; one per gallery', async ({ page }) => {
  const errors = watchErrors(page);
  await start(page);
  await page.locator('[data-identity="calm-corporate"]').click();
  for (const [element, expected] of [
    ['buttons', 'button-solid'],
    ['cards', 'card-bordered'],
    ['radius', 'radius-medium']
  ]) {
    await openPanel(page, element);
    expect([element, await marked(page, element)]).toEqual([element, [expected]]);
  }
  await expect(page.locator('#g-panel-buttons [data-fit]')).toHaveText(ar['gallery.fit']);
  // Settings (mode, direction) never carry it.
  await openPanel(page, 'modes');
  expect(await marked(page, 'modes')).toEqual([]);
  expect(errors).toEqual([]);
});

test('the badge follows the choices and the interface language', async ({ page }) => {
  await start(page);
  await page.locator('[data-identity="calm-corporate"]').click();
  await openPanel(page, 'buttons');
  expect(await marked(page, 'buttons')).toEqual(['button-solid']);
  await page.locator('[data-identity="warm-friendly"]').click();
  await expect.poll(() => marked(page, 'buttons')).toEqual(['button-soft']);
  // The page agrees with the matching module.
  const expected = await page.evaluate(() => {
    const id = window.Hawiya.state.identity();
    return window.Hawiya.match.best(
      'buttons',
      window.Hawiya.library.view().templates.buttons,
      id.selections,
      window.Hawiya.library.find
    );
  });
  expect(await marked(page, 'buttons')).toEqual([expected]);
  await page.locator('#lang-toggle').click();
  await expect(page.locator('#g-panel-buttons [data-fit]')).toHaveText(en['gallery.fit']);
});

test('with a session asking for a playful identity, the calm identity is offered the soft button', async ({ page }) => {
  await start(page);
  await page.locator('[data-identity="calm-corporate"]').click();
  await page.evaluate(() => {
    window.Hawiya.session = { tags: ['playful', 'soft'] };
  });
  await openPanel(page, 'buttons');
  expect(await marked(page, 'buttons')).toEqual(['button-soft']);
});
