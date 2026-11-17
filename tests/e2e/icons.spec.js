// Task 2.12 (R-047, R-093): icon sets, weights, fills and containers; 12–16 embedded sample icons per card with no
// request to the internet; arrows mirror in Arabic, check and clock never do.
'use strict';
const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const PAGE = pathToFileURL(path.join(__dirname, '../../picker/index.html')).href;
// Written on the first library (37 templates, 2 identities): run on a copy of the page with that data (task 3.14).
const FIRST = require('../helpers/first-library.js').firstPickerPage();
const PUBLISHED_ICONS = (() => {
  const b = require('../../tools/build.js');
  return b.select(b.load(path.join(__dirname, '../../library'))).data.templates.icons.length;
})();

function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}
const panel = (page) => page.locator('#g-panel-icons');
// n: how many icon styles the page shows (5 on the first library, every published one on the real page).
async function openIcons(page, n = 5) {
  await page.locator('[data-element="icons"] > .g-toggle').click();
  await expect(panel(page).locator('[data-template]')).toHaveCount(n);
}
// Transform of an icon's drawing inside the preview scene.
const sceneIcon = (page, selector) =>
  page.evaluate((sel) => {
    const n = document.getElementById('preview').shadowRoot.querySelector(sel);
    return n
      ? {
          transform: getComputedStyle(n.querySelector('svg')).transform,
          mirror: n.getAttribute('data-mirror'),
          cls: n.className,
          html: n.innerHTML
        }
      : null;
  }, selector);

test('every card shows 12 to 16 embedded icons; nothing but Google Fonts is requested', async ({ page }) => {
  const errors = watchErrors(page);
  const external = [];
  page.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith('file:') && !u.startsWith('data:')) external.push(u);
  });
  await page.route('https://fonts.googleapis.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '' })
  );
  await page.goto(PAGE);
  await openIcons(page, PUBLISHED_ICONS); // every published icon style (task 3.14)
  const counts = await panel(page)
    .locator('[data-template]')
    .evaluateAll((cards) =>
      cards.map((c) => [
        c.getAttribute('data-template'),
        c.querySelectorAll('.hw-icon svg > *').length > 0 ? c.querySelectorAll('.hw-icon').length : 0
      ])
    );
  for (const [id, n] of counts) expect([id, n >= 12 && n <= 16]).toEqual([id, true]);
  // Use every setting once, then check what was requested.
  await panel(page).locator('[data-template="icons-phosphor-regular"]').click();
  await panel(page).locator('[data-icon-fill="duotone"]').click();
  await panel(page).locator('[data-icon-container="circle"]').click();
  expect(external.filter((u) => !u.startsWith('https://fonts.googleapis.com/'))).toEqual([]);
  expect(errors).toEqual([]);
});

test('in Arabic the "next" arrow mirrors and the check mark does not; in English neither does', async ({ page }) => {
  await page.goto(PAGE);
  await page.locator('[data-preview-lang="ar"]').click();
  const arrow = await sceneIcon(page, '[data-next] .hw-icon');
  const check = await sceneIcon(page, '.sc-points .hw-icon');
  expect(arrow.mirror).toBe('true');
  expect(arrow.transform).toBe('matrix(-1, 0, 0, 1, 0, 0)');
  expect(check.mirror).toBeNull();
  expect(check.transform).toBe('none');
  await page.locator('[data-preview-lang="en"]').click();
  expect((await sceneIcon(page, '[data-next] .hw-icon')).transform).toBe('none');
  expect((await sceneIcon(page, '.sc-points .hw-icon')).transform).toBe('none');
  // The mobile tabs follow the same rules (home and check do not mirror).
  await page.locator('[data-preview-scene="mobile"]').click();
  await page.locator('[data-preview-lang="ar"]').click();
  expect((await sceneIcon(page, '.sc-tabs .hw-icon[data-meaning="check"]')).transform).toBe('none');
});

test('set, weight, fill and container: each choice reaches the identity and the preview', async ({ page }) => {
  await page.goto(FIRST);
  await openIcons(page);
  const ext = () => page.evaluate(() => window.Hawiya.state.identity().extensions.icons);

  // Weight: Lucide light draws with a 1.5 stroke.
  await panel(page).locator('[data-template="icons-lucide-light"]').click();
  expect(await ext()).toEqual({ library: 'lucide', weight: 'light', fill: 'outline', container: 'none' });
  expect(
    await page.evaluate(() =>
      document
        .getElementById('preview')
        .shadowRoot.querySelector('.sc-points .hw-icon [stroke-width]')
        .getAttribute('stroke-width')
    )
  ).toBe('1.5');
  // Lucide has no filled icons: the button cannot be pressed.
  await expect(panel(page).locator('[data-icon-fill="filled"]')).toBeDisabled();

  // Set: Phosphor regular offers filled and two-tone.
  await panel(page).locator('[data-template="icons-phosphor-regular"]').click();
  const outline = (await sceneIcon(page, '.sc-points .hw-icon')).html;
  await panel(page).locator('[data-icon-fill="filled"]').click();
  expect(await ext()).toEqual({ library: 'phosphor', weight: 'regular', fill: 'filled', container: 'none' });
  await expect(panel(page).locator('[data-icon-fill="filled"]')).toHaveAttribute('aria-pressed', 'true');
  expect((await sceneIcon(page, '.sc-points .hw-icon')).html).not.toBe(outline);

  // Container.
  await panel(page).locator('[data-icon-container="rounded"]').click();
  expect((await ext()).container).toBe('rounded');
  const icon = await sceneIcon(page, '.sc-points .hw-icon');
  expect(icon.cls).toContain('hw-icon--rounded');
  // Back to the template's own values: the adjustments are dropped.
  await panel(page).locator('[data-icon-fill="outline"]').click();
  await panel(page).locator('[data-icon-container="none"]').click();
  expect(await page.evaluate(() => window.Hawiya.state.choices().selections.icons)).toEqual({
    template: 'icons-phosphor-regular'
  });
  // The gallery strip shows the chosen set with the same mirroring.
  const strip = await panel(page)
    .locator('[data-icon-strip] .hw-icon')
    .evaluateAll((n) => n.map((x) => [x.getAttribute('data-meaning'), x.getAttribute('data-mirror')]));
  expect(strip).toEqual([
    ['arrow', 'true'],
    ['chevron', 'true'],
    ['undo', 'true'],
    ['check', null],
    ['clock', null],
    ['play', null]
  ]);
});

test('a sample is rebuilt from plain shapes only: scripts, events and links are dropped', async ({ page }) => {
  await page.goto(PAGE);
  const out = await page.evaluate(() => {
    const tpl = {
      extras: {
        library: 'lucide',
        viewBox: '0 0 24 24" onload="window.__x=1',
        samples: {
          outline: [
            {
              meaning: 'arrow',
              body: '<path d="M1 1" onclick="window.__x=2" fill="url(#a)"/><script>window.__x=3</script><image href="javascript:window.__x=4"/><g><circle r="2" style="x"/></g>'
            }
          ]
        }
      },
      tokens: {}
    };
    const n = window.Hawiya.icons.render(tpl, 'arrow', {});
    document.body.appendChild(n);
    return { html: n.innerHTML, x: window.__x };
  });
  expect(out.x).toBeUndefined();
  expect(out.html).toBe(
    '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M1 1"></path><g><circle r="2"></circle></g></svg>'
  );
});
