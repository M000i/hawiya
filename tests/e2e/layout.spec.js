// Tasks 10.1 and 10.2 (CHG-9, R-111, AC-31): on a wide screen the preview stays in view while the choices scroll;
// taller than the screen, it scrolls inside. The choices column keeps its side per language and the rule messages
// stay pinned. Under 760 px the preview is not pinned: the «المثال» button opens it over the page instead.
'use strict';
const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const PAGE = pathToFileURL(path.join(__dirname, '../../picker/index.html')).href;
const ELEMENTS = require('../../picker/js/core/resolve.js').ELEMENTS;
const ar = require('../../picker/i18n/ar.js');
const en = require('../../picker/i18n/en.js');
const WIDE = [
  { width: 1440, height: 900 },
  { width: 1100, height: 600 }
];

function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

async function start(page) {
  await page.route('https://fonts.googleapis.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '' })
  );
  await page.goto(PAGE);
}

// Opens every part of the page that has controls, so the choices column is as long as it gets.
async function openEverything(page) {
  for (const e of ['identities'].concat(ELEMENTS)) {
    await page.locator(`[data-element="${e}"] > .g-toggle`).click();
  }
  await page.locator('#guided-start').click();
  await expect(page.locator('#guided-body')).toBeVisible();
  await page.locator('#export-btn').click();
  await expect(page.locator('#export-actions')).toBeVisible();
}

// Scrolls the page so the given heading is at the top of the screen, then measures the preview.
const previewAfterScrollTo = (page, id) =>
  page.evaluate((target) => {
    document.getElementById(target).scrollIntoView({ block: 'start' });
    const wrap = document.querySelector('.preview-wrap');
    const r = wrap.getBoundingClientRect();
    return {
      scrolled: Math.round(window.scrollY),
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      height: window.innerHeight,
      inner: wrap.scrollHeight - wrap.clientHeight
    };
  }, id);

for (const viewport of WIDE) {
  test(`wide screen ${viewport.width}x${viewport.height}: the preview stays in view down to the export, in both languages`, async ({
    page
  }) => {
    await page.setViewportSize(viewport);
    const errors = watchErrors(page);
    await start(page);
    await openEverything(page);
    for (const lang of ['ar', 'en']) {
      if (lang === 'en') await page.locator('#lang-toggle').click();
      // The choices column keeps its side: right of the preview in Arabic, left in English (R-032).
      const sides = await page.evaluate(() => ({
        controls: document.getElementById('controls').getBoundingClientRect().x,
        preview: document.querySelector('.preview-wrap').getBoundingClientRect().x
      }));
      expect([lang, lang === 'ar' ? sides.controls > sides.preview : sides.controls < sides.preview]).toEqual([
        lang,
        true
      ]);
      for (const id of ['guided-title', 'export-title']) {
        const m = await previewAfterScrollTo(page, id);
        expect(m.scrolled, `${lang} ${id}: the page really scrolled`).toBeGreaterThan(viewport.height);
        // The whole preview box is on screen: its top at the screen's top edge (the 6 px focus margin above it).
        expect([lang, id, m.top >= -6 && m.top <= 0, m.bottom <= m.height + 6]).toEqual([lang, id, true, true]);
      }
    }
    expect(errors).toEqual([]);
  });
}

test('wide screen 1100x600: a preview taller than the screen scrolls inside, so its last line can be reached', async ({
  page
}) => {
  await page.setViewportSize({ width: 1100, height: 600 });
  await start(page);
  await page.locator('#guided-title').scrollIntoViewIfNeeded();
  const end = await page.evaluate(() => {
    window.scrollTo(0, document.documentElement.scrollHeight);
    const wrap = document.querySelector('.preview-wrap');
    const taller = wrap.scrollHeight > wrap.clientHeight;
    wrap.scrollTop = wrap.scrollHeight;
    const last = wrap.lastElementChild.getBoundingClientRect();
    return { taller, lastBottom: Math.round(last.bottom), height: window.innerHeight };
  });
  expect(end.taller).toBe(true);
  expect(end.lastBottom).toBeLessThanOrEqual(end.height);
  expect(end.lastBottom).toBeGreaterThan(0);
});

test('wide screen: the rule messages still stay pinned above the choices while the page scrolls', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await start(page);
  await openEverything(page);
  await page.locator('[data-contrast-level="AAA"]').click(); // a blocking message with its suggestion
  await expect(page.locator('#rules [data-rules-block]')).toBeVisible();
  const m = await page.evaluate(() => {
    document.getElementById('export-title').scrollIntoView({ block: 'start' });
    const rules = document.getElementById('rules').getBoundingClientRect();
    return { scrolled: window.scrollY, top: Math.round(rules.top), bottom: Math.round(rules.bottom) };
  });
  expect(m.scrolled).toBeGreaterThan(900);
  expect(m.top).toBe(0);
  expect(m.bottom).toBeGreaterThan(0);
});

test('under 760 px nothing changes: the preview is not pinned and still comes after the choices', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await start(page);
  const m = await page.evaluate(() => {
    const wrap = document.querySelector('.preview-wrap');
    const style = getComputedStyle(wrap);
    return {
      position: style.position,
      overflowY: style.overflowY,
      afterChoices:
        wrap.getBoundingClientRect().top >= document.getElementById('controls').getBoundingClientRect().bottom
    };
  });
  expect(m).toEqual({ position: 'static', overflowY: 'visible', afterChoices: true });
});

// What the narrow-screen sheet looks like right now.
const sheet = (page) =>
  page.evaluate(() => {
    const wrap = document.querySelector('.preview-wrap');
    const r = wrap.getBoundingClientRect();
    const btn = document.getElementById('preview-open');
    const close = document.getElementById('preview-close');
    let el = document.activeElement;
    return {
      open: document.body.classList.contains('preview-sheet-open'),
      role: wrap.getAttribute('role'),
      modal: wrap.getAttribute('aria-modal'),
      expanded: btn.getAttribute('aria-expanded'),
      covers:
        Math.round(r.top) === 0 &&
        Math.round(r.height) === window.innerHeight &&
        Math.round(r.width) === window.innerWidth,
      choicesInert: document.getElementById('controls').inert && document.querySelector('.top').inert,
      closeShown: getComputedStyle(close).display !== 'none',
      focus: el && el.id,
      scrolled: Math.round(window.scrollY),
      sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth
    };
  });

test('phone 375x800: the «المثال» button opens the preview over the page; Esc and the close key bring you back', async ({
  page
}) => {
  await page.setViewportSize({ width: 375, height: 800 });
  const errors = watchErrors(page);
  await start(page);
  const button = page.locator('#preview-open');
  for (const lang of ['ar', 'en']) {
    const dict = lang === 'ar' ? ar : en;
    if (lang === 'en') await page.locator('#lang-toggle').click();
    await expect(button).toBeVisible();
    await expect(button).toHaveText(dict['preview.open']);
    // Always in reach: still on screen after scrolling down to the guided choices.
    await page.evaluate(() => document.getElementById('guided-title').scrollIntoView({ block: 'start' }));
    const before = await page.evaluate(() => Math.round(window.scrollY));
    expect(before).toBeGreaterThan(800);
    const box = await button.boundingBox();
    expect(box.y + box.height).toBeLessThanOrEqual(800);

    for (const how of ['Escape', 'close key']) {
      await button.click();
      let s = await sheet(page);
      expect([lang, how, s]).toEqual([
        lang,
        how,
        {
          open: true,
          role: 'dialog',
          modal: 'true',
          expanded: 'true',
          covers: true,
          choicesInert: true,
          closeShown: true,
          focus: 'preview-close',
          scrolled: before,
          sideways: 0
        }
      ]);
      await expect(page.locator('#preview-close')).toHaveText(dict['preview.close']);
      // The close key stays on screen while the open preview scrolls to its end.
      const closeAtEnd = await page.evaluate(() => {
        const wrap = document.querySelector('.preview-wrap');
        wrap.scrollTop = wrap.scrollHeight;
        const r = document.getElementById('preview-close').getBoundingClientRect();
        const out = { scrolledInside: wrap.scrollTop > 0, onScreen: r.top >= 0 && r.bottom <= window.innerHeight };
        wrap.scrollTop = 0;
        return out;
      });
      expect([lang, how, closeAtEnd]).toEqual([lang, how, { scrolledInside: true, onScreen: true }]);
      // The preview's own keys still work inside.
      await page.locator('[data-preview-mode="dark"]').click();
      await expect(page.locator('[data-preview-mode="dark"]')).toHaveAttribute('aria-pressed', 'true');
      await page.locator('[data-preview-mode="light"]').click();
      await expect(page.locator('[data-preview-mode="light"]')).toHaveAttribute('aria-pressed', 'true');

      if (how === 'Escape') await page.keyboard.press('Escape');
      else await page.locator('#preview-close').click();
      s = await sheet(page);
      expect([lang, how, s]).toEqual([
        lang,
        how,
        {
          open: false,
          role: null,
          modal: null,
          expanded: 'false',
          covers: false,
          choicesInert: false,
          closeShown: false,
          focus: 'preview-open',
          scrolled: before,
          sideways: 0
        }
      ]);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
  }
  expect(errors).toEqual([]);
});

test('phones: the button leaves every card on the first screen tappable, and the first card whole at 375x800', async ({
  page
}) => {
  for (const viewport of [
    { width: 375, height: 800 },
    { width: 360, height: 640 }
  ]) {
    await page.setViewportSize(viewport);
    await start(page);
    for (const lang of ['ar', 'en']) {
      if ((await page.locator('html').getAttribute('lang')) !== lang) await page.locator('#lang-toggle').click();
      await expect(page.locator('html')).toHaveAttribute('lang', lang);
      if (viewport.height === 800) {
        const card = await page.locator('#identity-list [data-identity]').first().boundingBox();
        const btn = await page.locator('#preview-open').boundingBox();
        expect([lang, card.y + card.height <= btn.y]).toEqual([lang, true]);
      }
      // Every card that shows on the first screen can still be tapped at its middle (B-139).
      const blocked = await page.evaluate(() =>
        [...document.querySelectorAll('#identity-list [data-identity]')]
          .map((c) => {
            const r = c.getBoundingClientRect();
            const y = Math.min(r.top + r.height / 2, (r.top + window.innerHeight) / 2);
            return { id: c.getAttribute('data-identity'), r, y };
          })
          .filter((c) => c.r.top < window.innerHeight)
          .filter(
            (c) => !c.r.width || !document.elementFromPoint(c.r.left + c.r.width / 2, c.y).closest('[data-identity]')
          )
          .map((c) => c.id)
      );
      expect([viewport.height, lang, blocked]).toEqual([viewport.height, lang, []]);
    }
  }
});

test('wide screen: no «المثال» button and no close key; widening the window closes an open preview', async ({
  page
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await start(page);
  await expect(page.locator('#preview-open')).toBeHidden();
  await expect(page.locator('#preview-close')).toBeHidden();
  await page.setViewportSize({ width: 375, height: 800 });
  await page.locator('#preview-open').click();
  expect((await sheet(page)).open).toBe(true);
  expect((await sheet(page)).focus).toBe('preview-close');
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect.poll(async () => (await sheet(page)).open).toBe(false);
  const s = await sheet(page);
  expect([s.role, s.choicesInert, s.closeShown]).toEqual([null, false, false]);
  // The close key is hidden now, so the focus moves to the preview's first key, on screen (B-140).
  const focus = await page.evaluate(() => {
    const el = document.activeElement;
    const r = el.getBoundingClientRect();
    return { key: el.getAttribute('data-preview-lang'), shown: r.width > 0 && r.top >= 0 && r.bottom <= innerHeight };
  });
  expect(focus).toEqual({ key: 'ar', shown: true });
});

test('wide screen: a preview taller than its box takes a tab stop and scrolls from the keyboard; otherwise no stop', async ({
  page
}) => {
  await start(page);
  const stop = () => page.evaluate(() => document.getElementById('preview-wrap').getAttribute('tabindex'));
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect.poll(stop).toBe(null);
  await page.setViewportSize({ width: 375, height: 800 });
  await expect.poll(stop).toBe(null);
  await page.setViewportSize({ width: 1100, height: 600 });
  await expect.poll(stop).toBe('0');
  await page.evaluate(() => document.getElementById('guided-title').scrollIntoView({ block: 'start' }));
  await page.locator('#preview-wrap').focus({ preventScroll: true });
  await page.keyboard.press('End');
  await expect.poll(() => page.evaluate(() => document.getElementById('preview-wrap').scrollTop)).toBeGreaterThan(0);
  // The note under the scene is reachable (End may scroll smoothly, so wait until it settles).
  await expect
    .poll(() =>
      page.evaluate(() => {
        const r = document.getElementById('mobile-notice').getBoundingClientRect();
        return r.bottom <= innerHeight && r.top >= 0;
      })
    )
    .toBe(true);
});

test('phone 375x800: the «المثال» button and the close key reach WCAG AA in both languages', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await start(page);
  const ratioOf = (id) =>
    page.evaluate((target) => {
      const rgb = (s) => s.match(/\d+(\.\d+)?/g).map(Number);
      const lum = (c) => {
        const f = (x) => ((x /= 255) <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
        return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
      };
      const cs = getComputedStyle(document.getElementById(target));
      const a = lum(rgb(cs.color));
      const b = lum(rgb(cs.backgroundColor));
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    }, id);
  for (const lang of ['ar', 'en']) {
    if (lang === 'en') await page.locator('#lang-toggle').click();
    expect([lang, (await ratioOf('preview-open')) >= 4.5]).toEqual([lang, true]);
    await page.locator('#preview-open').click();
    expect([lang, (await ratioOf('preview-close')) >= 4.5]).toEqual([lang, true]);
    await page.keyboard.press('Escape');
  }
});

test('the line is at 760 px: 760 is wide (pinned preview, no button), 759 is narrow (button, not pinned)', async ({
  page
}) => {
  await start(page);
  const at = async (width) => {
    await page.setViewportSize({ width, height: 900 });
    return page.evaluate(() => ({
      position: getComputedStyle(document.querySelector('.preview-wrap')).position,
      columns: getComputedStyle(document.querySelector('.layout')).gridTemplateColumns.split(' ').length,
      button: getComputedStyle(document.getElementById('preview-open')).display !== 'none'
    }));
  };
  expect(await at(760)).toEqual({ position: 'sticky', columns: 2, button: false });
  expect(await at(759)).toEqual({ position: 'static', columns: 1, button: true });
});
