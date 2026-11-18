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

// Task 6.3 (R-103): the preview and the font cards draw the Latin family through the same @font-face rules the
// exported CSS writes (size-adjust), declared once in the page, never scaled a second time. No network: Google Fonts
// answers with an empty stylesheet and the font files are refused, so only the rules and names are checked here.
test('the preview and the font cards use the exported @font-face rules; nothing is scaled twice', async ({ page }) => {
  const errors = watchErrors(page);
  await recordFonts(page);
  await page.route('https://fonts.gstatic.com/**', (route) => route.abort());
  await page.goto(PAGE);
  await page.locator('#identity-list [data-identity="classic-naskh"]').click();

  const rules = (css) => [...css.matchAll(/@font-face \{[^}]*\}/g)].map((m) => m[0]);
  const exported = await page.evaluate(
    () => window.Hawiya.generate.valueFiles(window.Hawiya.state.identity())['tokens.css']
  );
  const declared = () => page.evaluate(() => (document.getElementById('hawiya-font-faces') || {}).textContent || '');
  expect(rules(exported)).toHaveLength(6);
  for (const r of rules(exported)) expect(await declared()).toContain(r);
  expect(rules(await declared())).toHaveLength(6); // declared once, however often the preview renders

  // The preview (in its shadow root) uses that family, then the plain one, then Arabic.
  for (const scene of ['landing', 'dashboard', 'form', 'mobile']) {
    await page.locator(`[data-preview-scene="${scene}"]`).click();
    const family = await page.evaluate(() => {
      const sr = document.getElementById('preview').shadowRoot;
      return getComputedStyle(sr.querySelector('.scene')).getPropertyValue('--font-body').trim();
    });
    expect(family, scene).toMatch(/^"EB Garamond Hawiya 135", "EB Garamond", "Amiri", /);
  }
  // The document knows the faces with their size adjustment, so the shadow root can use them.
  const faces = await page.evaluate(() =>
    [...document.fonts].filter((f) => f.family.replace(/"/g, '') === 'EB Garamond Hawiya 135').map((f) => f.sizeAdjust)
  );
  expect(faces).toEqual(Array(6).fill('135%'));

  // The cards: the adjusted family, no font-size scaling on top of it.
  await openFonts(page);
  const card = async (id) =>
    panel(page)
      .locator(`[data-template="${id}"]`)
      .evaluate((n) => {
        const l = n.querySelector('.f-latin');
        return {
          family: l.style.fontFamily,
          adjusted: l.getAttribute('data-adjusted-family'),
          scaled: l.style.getPropertyValue('--f-adjust'),
          ratio:
            parseFloat(getComputedStyle(l).fontSize) / parseFloat(getComputedStyle(n.querySelector('.f-ar')).fontSize)
        };
      });
  const amiri = await card('pair-amiri-eb-garamond');
  expect(amiri).toMatchObject({ adjusted: 'EB Garamond Hawiya 135', scaled: '', ratio: 1 });
  expect(amiri.family).toMatch(/^"EB Garamond Hawiya 135", "EB Garamond", /);
  const beiruti = await card('pair-beiruti-instrument-sans');
  expect(beiruti).toMatchObject({ adjusted: 'Instrument Sans Hawiya 75', scaled: '', ratio: 1 });
  // A pair with the value 1: no rule, no name, as before.
  expect(await card('pair-zain-figtree')).toMatchObject({ adjusted: null, scaled: '1', ratio: 1 });
  expect(await declared()).toContain('"Instrument Sans Hawiya 75"');
  expect(await declared()).not.toContain('Figtree Hawiya');

  // A single-family font: the preview stacks have no adjusted family.
  await panel(page).locator('[data-template="pair-cairo"]').click();
  const cairo = await page.evaluate(() =>
    getComputedStyle(document.getElementById('preview').shadowRoot.querySelector('.scene'))
      .getPropertyValue('--font-body')
      .trim()
  );
  expect(cairo).toMatch(/^"Cairo", /);
  expect(errors).toEqual([]);
});

// Task 6.8 (CHG-5, R-105): a page that links the exported tokens.css alone, with no Google Fonts link of its own,
// draws the Arabic text in the identity's Arabic family and the Latin text in the adjusted Latin family (as the
// page Claude Code built in /verify 6.7 did, where the Arabic heading fell back to a system font). Needs internet.
test('a page linking only the exported tokens.css draws Amiri and the adjusted EB Garamond (needs internet)', async ({
  page
}) => {
  const fs = require('fs');
  await page.goto(PAGE);
  await page.locator('#identity-list [data-identity="classic-naskh"]').click();
  const tokens = await page.evaluate(
    () => window.Hawiya.generate.valueFiles(window.Hawiya.state.identity())['tokens.css']
  );
  const dir = test.info().outputPath('site');
  fs.mkdirSync(path.join(dir, 'design'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'design', 'tokens.css'), tokens);
  fs.writeFileSync(
    path.join(dir, 'index.html'),
    '<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8">' +
      '<link rel="stylesheet" href="design/tokens.css">' +
      '<style>body{font-family:var(--font-body)} h1{font-family:var(--font-heading);font-weight:700}' +
      ' span{font-size:40px}</style></head><body>' +
      '<h1 id="ar">مرحبا بكم في هوية</h1><p><span id="en" lang="en">Hawiya Design</span></p>' +
      '<p><span id="plain" lang="en" style="font-family:\'EB Garamond\'">Hawiya Design</span></p></body></html>'
  );
  await page.goto(pathToFileURL(path.join(dir, 'index.html')).href);
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(async () => {
    await document.fonts.load('700 32px Amiri', 'مرحبا');
    await document.fonts.load('40px "EB Garamond Hawiya 135"', 'Hawiya');
    await document.fonts.load('40px "EB Garamond"', 'Hawiya');
  });

  // The font the browser really draws each text with.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument');
  const drawn = async (selector) => {
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    return Object.fromEntries(fonts.map((f) => [f.familyName, f.glyphCount]));
  };
  // Every Arabic letter in Amiri; only the spaces come from EB Garamond (the Latin family leads the stack, and the
  // space is in its range). No system font (in /verify 6.7: Geeza Pro).
  const ar = await drawn('#ar');
  expect(ar.Amiri).toBe('مرحبا بكم في هوية'.replace(/ /g, '').length);
  expect(Object.keys(ar).filter((f) => f !== 'Amiri' && f !== 'EB Garamond')).toEqual([]);
  expect(Object.keys(await drawn('#en'))).toEqual(['EB Garamond']);
  // Loaded by the @import lines of tokens.css, not by a copy installed on the machine.
  const loaded = await page.evaluate(() =>
    [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/"/g, ''))
  );
  expect(loaded).toEqual(expect.arrayContaining(['Amiri', 'EB Garamond', 'EB Garamond Hawiya 135']));
  // The Latin text is drawn through the adjusted copy: 1.35 times as wide as the plain family at the same size.
  const ratio = await page.evaluate(
    () =>
      document.getElementById('en').getBoundingClientRect().width /
      document.getElementById('plain').getBoundingClientRect().width
  );
  expect(ratio).toBeCloseTo(1.35, 2);
});
