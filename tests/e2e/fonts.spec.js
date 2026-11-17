// Task 2.11 (R-043, R-030, R-090, R-094): fonts load from Google Fonts only when their card is on screen;
// the project language decides which fonts show; offline, the system font is used with a notice; cards show
// the pair's size adjustment and the numerals font.
'use strict';
const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const PAGE = pathToFileURL(path.join(__dirname, '../../picker/index.html')).href;
// Written on the first library (37 templates, 2 identities): run on a copy of the page with that data (task 3.14).
const FIRST = require('../helpers/first-library.js').firstPickerPage();
const ar = require('../../picker/i18n/ar.js');

// Does a font draw the Eastern Arabic digits itself? Its width with two different fallbacks that both draw them
// (Noto Kufi Arabic and Amiri): the same width = the font's own digits. (Comparing with a generic family is not
// enough: Chrome falls back to a system Arabic font, so a monospaced Latin font looked as if it drew them.)
const DRAWS_EASTERN = async () => {
  const sheet = (family) =>
    new Promise((resolve) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=' + family.replace(/ /g, '+') + '&display=block';
      link.onload = () => resolve(true);
      link.onerror = () => resolve(false);
      document.head.appendChild(link);
    });
  const digits = String.fromCharCode(...Array.from({ length: 10 }, (_, i) => 0x0660 + i));
  for (const f of ['Noto Kufi Arabic', 'Amiri']) {
    await sheet(f);
    await document.fonts.load(`32px "${f}"`, digits);
  }
  window.__sheet = sheet;
  window.__drawsEastern = async (font, s, c) => {
    await sheet(font);
    await document.fonts.load(`32px "${font}"`, s + 'x');
    c.font = `100px "${font}", "Noto Kufi Arabic"`;
    const a = c.measureText(s).width;
    c.font = `100px "${font}", "Amiri"`;
    return Math.abs(a - c.measureText(s).width) < 0.01;
  };
};

function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/fonts\.googleapis|ERR_FAILED|net::/.test(m.text())) errors.push(m.text());
  });
  return errors;
}

// Google Fonts requests are answered locally (an empty stylesheet) and counted: no real network needed.
async function recordFonts(page) {
  const families = [];
  await page.route('https://fonts.googleapis.com/**', (route) => {
    const url = new URL(route.request().url());
    for (const f of url.searchParams.getAll('family')) families.push(f.split(':')[0]);
    route.fulfill({ status: 200, contentType: 'text/css', body: '/* test */' });
  });
  return families;
}
const panel = (page) => page.locator('#g-panel-fonts');
const visibleCards = (page) => panel(page).locator('[data-template]:not([hidden])');
async function openFonts(page) {
  await page.locator('[data-element="fonts"] > .g-toggle').click();
  await expect(panel(page).locator('[data-project-lang]')).toHaveCount(3);
}

test('a font is requested from Google Fonts only when its card comes on screen', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 600 });
  const errors = watchErrors(page);
  const families = await recordFonts(page);
  await page.goto(PAGE);
  // At start: the chosen font (for the preview) and the quick list cards on screen; never the gallery's others.
  await expect.poll(() => families.includes('IBM Plex Sans Arabic')).toBe(true);
  await openFonts(page);
  const kufi = panel(page).locator('[data-template="font-noto-kufi-arabic"]');
  await expect(kufi).toBeAttached();
  const onScreen = await kufi.evaluate((n) => {
    const r = n.getBoundingClientRect();
    return r.top < innerHeight && r.bottom > 0;
  });
  expect(onScreen).toBe(false); // the gallery sits below the first screen
  expect(families).not.toContain('Noto Kufi Arabic');
  await kufi.scrollIntoViewIfNeeded();
  await expect.poll(() => families.includes('Noto Kufi Arabic')).toBe(true);
  // Inter is for English projects: its card is hidden in an Arabic project, so it is never requested.
  expect(families).not.toContain('Inter');
  // Each family is requested once.
  expect(families.filter((f) => f === 'Noto Kufi Arabic').length).toBe(1);
  expect(errors).toEqual([]);
});

test('the project language decides which fonts show, and sets the identity language', async ({ page }) => {
  await recordFonts(page);
  await page.goto(FIRST);
  await openFonts(page);
  const ids = () => visibleCards(page).evaluateAll((n) => n.map((x) => x.getAttribute('data-template')));
  // Starter identity: Arabic project.
  await expect(panel(page).locator('[data-project-lang="ar"]')).toHaveAttribute('aria-pressed', 'true');
  expect(await ids()).toEqual([
    'pair-plex-arabic-plex-sans',
    'pair-noto-sans-arabic-noto-sans',
    'pair-cairo',
    'font-noto-kufi-arabic'
  ]);

  await panel(page).locator('[data-project-lang="en"]').click();
  await expect(panel(page).locator('[data-project-lang="en"]')).toHaveAttribute('aria-pressed', 'true');
  expect(await ids()).toEqual([
    'pair-plex-arabic-plex-sans',
    'pair-noto-sans-arabic-noto-sans',
    'pair-cairo',
    'font-inter'
  ]);
  let id = await page.evaluate(() => window.Hawiya.state.identity());
  expect([id.project.language, id.project.direction]).toEqual(['en', 'ltr']);
  // The preview follows the project language until its own key is pressed.
  expect(
    await page.evaluate(() => document.getElementById('preview').shadowRoot.querySelector('.scene').getAttribute('dir'))
  ).toBe('ltr');

  await panel(page).locator('[data-project-lang="ar+en"]').click();
  expect(await ids()).toEqual(['pair-plex-arabic-plex-sans', 'pair-noto-sans-arabic-noto-sans', 'pair-cairo']);
  id = await page.evaluate(() => window.Hawiya.state.identity());
  expect([id.project.language, id.project.direction]).toEqual(['ar+en', 'both']);

  // Numerals and calendar adjustments of the direction survive a change of project language.
  await page.evaluate(() =>
    window.Hawiya.state.change((c) => {
      c.selections.direction.overrides = { numerals: 'arab' };
    })
  );
  await panel(page).locator('[data-project-lang="ar"]').click();
  expect(await page.evaluate(() => window.Hawiya.state.choices().selections.direction)).toEqual({
    template: 'direction-rtl',
    overrides: { numerals: 'arab' }
  });
});

test('a font card chooses the font; the card shows the size adjustment and the numerals font', async ({ page }) => {
  const families = await recordFonts(page);
  await page.goto(PAGE);
  await openFonts(page);
  const card = panel(page).locator('[data-template="pair-noto-sans-arabic-noto-sans"]');
  await card.click();
  await expect(card).toHaveAttribute('aria-pressed', 'true');
  const id = await page.evaluate(() => window.Hawiya.state.identity());
  expect(id.tokens.font.body).toMatchObject({ arabic: 'Noto Sans Arabic', latin: 'Noto Sans', latinSizeAdjust: 1 });
  // The chosen font is loaded for the preview.
  await expect.poll(() => families.includes('Noto Sans Arabic') && families.includes('Noto Sans')).toBe(true);
  // R-090: the Latin specimen is drawn at the pair's adjustment (font size = adjustment × the Arabic size).
  const sizes = await card.evaluate((n) => {
    const a = parseFloat(getComputedStyle(n.querySelector('.f-ar')).fontSize);
    const l = n.querySelector('.f-latin');
    return {
      ratio: parseFloat(getComputedStyle(l).fontSize) / a,
      adjust: Number(l.getAttribute('data-size-adjust')),
      applied: l.style.getPropertyValue('--f-adjust')
    };
  });
  expect(sizes.ratio).toBeCloseTo(sizes.adjust, 3);
  expect(sizes.applied).toBe(String(id.tokens.font.body.latinSizeAdjust));
  // R-094: the numerals font and the digits it draws.
  const digits = card.locator('.f-digits');
  await expect(digits).toHaveAttribute('data-numerals', 'Noto Sans Arabic');
  await expect(digits).toContainText('0123456789');
  await expect(digits).toContainText('٠١٢٣٤٥٦٧٨٩');
  await expect(card.locator('.f-meta')).toHaveText(ar['fonts.numerals'].replace('{font}', 'Noto Sans Arabic'));
  // An English-only font shows Latin digits only.
  await panel(page).locator('[data-project-lang="en"]').click();
  await expect(panel(page).locator('[data-template="font-inter"] .f-digits')).toHaveText('0123456789');
});

test('without internet: a notice, the system font, and everything still works', async ({ page }) => {
  const errors = watchErrors(page);
  await page.route('https://fonts.googleapis.com/**', (route) => route.abort('internetdisconnected'));
  await page.goto(PAGE);
  await expect(page.locator('#fonts-offline')).toBeVisible();
  await expect(page.locator('#fonts-offline')).toHaveText(ar['fonts.offline']);
  // The stacks end in system fonts, so text still has a font.
  const stack = await page.evaluate(
    () => getComputedStyle(document.getElementById('preview').shadowRoot.querySelector('.scene')).fontFamily
  );
  expect(stack).toMatch(/system-ui, sans-serif$/);
  await openFonts(page);
  await panel(page).locator('[data-template="pair-cairo"]').click();
  await page.locator('#export-btn').click();
  await expect(page.locator('html')).toHaveAttribute('data-hawiya-export', 'ready');
  expect(errors).toEqual([]);
});

// With the real Google Fonts: the digit support recorded in the library is what Chrome draws (R-094).
test('recorded Eastern Arabic digit support matches the real fonts (needs internet)', async ({ page }) => {
  await page.goto(PAGE);
  const data = await page.evaluate(async () => {
    await window.Hawiya.library.load('fonts');
    return window.Hawiya.data.templates.fonts.map((t) => ({
      id: t.id,
      font: t.extras.numeralsFont || t.extras.arabic || t.extras.latin,
      eastern: t.extras.easternArabicDigits
    }));
  });
  const online = await page
    .evaluate(() =>
      fetch('https://fonts.googleapis.com/css2?family=Inter', { mode: 'no-cors' }).then(
        () => true,
        () => false
      )
    )
    .catch(() => false);
  test.skip(!online, 'no internet: Google Fonts cannot be reached');
  await page.evaluate(DRAWS_EASTERN);
  const measured = await page.evaluate(async (list) => {
    const out = {};
    const c = document.createElement('canvas').getContext('2d');
    for (const d of list) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=' + d.font.replace(/ /g, '+') + '&display=block';
      document.head.appendChild(link);
      await new Promise((r) => link.addEventListener('load', r));
      const s = String.fromCharCode(...Array.from({ length: 10 }, (_, i) => 0x0660 + i));
      out[d.id] = await window.__drawsEastern(d.font, s, c);
    }
    return out;
  }, data);
  for (const d of data) expect([d.id, measured[d.id]]).toEqual([d.id, d.eastern]);
});

// Task 3.8 (R-090, R-094): every font of the library, drafts too, with the real Google Fonts files: each family the
// page would load (weights 400 and 700) loads, the recorded digit support is what Chrome draws, and each measured
// pair's size adjustment is the measurement (Arabic body height of ه م س و over Latin x-height, relative to IBM Plex).
test('every library font loads, draws the recorded digits, and keeps its measured size adjustment (needs internet)', async ({
  page
}) => {
  test.setTimeout(180000);
  const fonts = JSON.parse(
    require('fs').readFileSync(path.join(__dirname, '../../library/elements/fonts.json'), 'utf8')
  );
  await page.goto('about:blank');
  const online = await page
    .evaluate(() =>
      fetch('https://fonts.googleapis.com/css2?family=Inter', { mode: 'no-cors' }).then(
        () => true,
        () => false
      )
    )
    .catch(() => false);
  test.skip(!online, 'no internet: Google Fonts cannot be reached');
  await page.evaluate(DRAWS_EASTERN);
  const families = [
    ...new Set(
      fonts.flatMap((t) => [
        t.extras.arabic,
        t.extras.latin,
        t.extras.headingArabic,
        t.extras.headingLatin,
        t.extras.numeralsFont
      ])
    )
  ].filter(Boolean);
  const m = await page.evaluate(async (list) => {
    const out = {};
    const c = document.createElement('canvas').getContext('2d');
    const digits = String.fromCharCode(...Array.from({ length: 10 }, (_, i) => 0x0660 + i));
    for (const f of list) {
      // The same request as the page's loader (picker/js/ui/elements/fonts.js).
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=' + f.replace(/ /g, '+') + ':wght@400;700&display=block';
      const loads = await new Promise((r) => {
        link.onload = () => r(true);
        link.onerror = () => r(false);
        document.head.appendChild(link);
      });
      await document.fonts.load(`100px "${f}"`, 'xvwz همسو');
      const bold = await document.fonts.load(`bold 100px "${f}"`, 'xvwz همسو');
      c.font = `100px "${f}", serif`;
      out[f] = {
        loads,
        bold: bold.some((face) => face.weight === '700' || /\d+ \d+/.test(face.weight)),
        eastern: await window.__drawsEastern(f, digits, c),
        arabicBody: c.measureText('همسو').actualBoundingBoxAscent,
        xHeight: c.measureText('xvwz').actualBoundingBoxAscent
      };
      c.font = `100px "${f}", serif`;
      out[f].arabicBody = c.measureText('همسو').actualBoundingBoxAscent;
      out[f].xHeight = c.measureText('xvwz').actualBoundingBoxAscent;
    }
    return out;
  }, families);
  for (const f of families) expect([f, m[f].loads, m[f].bold]).toEqual([f, true, true]);
  const plex = m['IBM Plex Sans Arabic'].arabicBody / m['IBM Plex Sans'].xHeight;
  const report = [];
  for (const t of fonts) {
    const x = t.extras;
    const numerals = x.numeralsFont || x.arabic || x.latin;
    expect([t.id, numerals, m[numerals].eastern]).toEqual([t.id, numerals, x.easternArabicDigits]);
    report.push(`${t.id}: ${numerals} ${m[numerals].eastern ? 'draws' : 'does not draw'} ٠١٢٣٤٥٦٧٨٩`);
    if (/relative to IBM Plex/.test(t.rtl.notes || '')) {
      const measured = Math.round((m[x.arabic].arabicBody / m[x.latin].xHeight / plex) * 20) / 20;
      expect([t.id, x.latinSizeAdjust]).toEqual([t.id, measured]);
    }
  }
  test.info().annotations.push({ type: 'eastern-digits', description: report.join('\n') });
});

// Task 3.8: a font card shows a pair's own heading family (bold, first) and loads it with the others when shown.
test('a font card shows the heading family of a pair and loads it', async ({ page }) => {
  await page.route('https://fonts.googleapis.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/css', body: '' })
  );
  await page.goto(PAGE);
  const out = await page.evaluate(async () => {
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
    const tpl = {
      id: 'x',
      extras: {
        languages: ['ar'],
        arabic: 'Tajawal',
        headingArabic: 'El Messiri',
        numeralsFont: 'Tajawal',
        easternArabicDigits: true
      }
    };
    const box = H.galleryParts.fonts.sample(tpl, ctx);
    document.body.appendChild(box);
    box.scrollIntoView(); // its files load only when it is on screen
    await new Promise((r) => setTimeout(r, 500));
    const head = box.querySelector('.f-heading');
    return {
      first: box.firstElementChild.className,
      heading: head && [head.getAttribute('data-heading'), head.style.fontFamily, getComputedStyle(head).fontWeight],
      body: box.querySelector('.f-ar').style.fontFamily,
      requested: H.fonts.requested()
    };
  });
  expect(out.first).toBe('f-heading');
  expect(out.heading[0]).toBe('El Messiri');
  expect(out.heading[1]).toMatch(/^"El Messiri"/);
  expect(out.heading[2]).toBe('700');
  expect(out.body).toMatch(/^"?Tajawal"?,/);
  expect(out.requested).toEqual(expect.arrayContaining(['Tajawal', 'El Messiri']));
});
