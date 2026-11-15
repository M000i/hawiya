// Task 2.6 (R-028, R-029): the landing scene follows every choice at once, in Arabic/English × light/dark,
// and its styles never mix with the tool's.
'use strict';
const { test, expect } = require('@playwright/test');
const path = require('path');
const { pathToFileURL } = require('url');

const PAGE = pathToFileURL(path.join(__dirname, '../../picker/index.html')).href;

function watchErrors(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  return errors;
}

// Everything is read from inside the shadow root.
const scene = (page) =>
  page.evaluate(() => {
    const root = document.getElementById('preview').shadowRoot;
    const wrap = root.querySelector('.scene');
    const btn = root.querySelector('.hw-btn');
    const card = root.querySelector('.hw-card');
    const cs = (n) => getComputedStyle(n);
    return {
      dir: wrap.getAttribute('dir'),
      lang: wrap.getAttribute('lang'),
      mode: wrap.getAttribute('data-mode'),
      background: cs(wrap).backgroundColor,
      title: root.querySelector('h1').textContent,
      buttonText: btn.textContent,
      buttonRadius: cs(btn).borderTopLeftRadius,
      cardRadius: cs(card).borderTopLeftRadius,
      cardTitle: root.querySelector('.hw-card-title').textContent,
      lineHeight: cs(wrap).getPropertyValue('--line-height').trim()
    };
  });
const identity = (page) => page.evaluate(() => window.Hawiya.state.identity());
const sceneText = (page) => page.evaluate(() => window.Hawiya.scenes.landing.text);
const rgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;

for (const lang of ['ar', 'en']) {
  for (const mode of ['light', 'dark']) {
    test(`the scene follows every choice at once: ${lang} / ${mode}`, async ({ page }) => {
      const errors = watchErrors(page);
      await page.goto(PAGE);
      await page.locator(`[data-preview-lang="${lang}"]`).click();
      await page.locator(`[data-preview-mode="${mode}"]`).click();
      await expect(page.locator(`[data-preview-lang="${lang}"]`)).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator(`[data-preview-mode="${mode}"]`)).toHaveAttribute('aria-pressed', 'true');
      const T = await sceneText(page);

      let s = await scene(page);
      expect([s.dir, s.lang, s.mode]).toEqual([lang === 'ar' ? 'rtl' : 'ltr', lang, mode]);
      expect(s.title).toBe(T[lang].title);
      expect(s.buttonText).toBe(T[lang].primary);
      expect(s.cardTitle).toBe(T[lang].cards[0][0]);

      // Corners: the scene's button takes the new medium radius, the card keeps the large one.
      await page.locator('#radius-input').fill('18');
      s = await scene(page);
      let id = await identity(page);
      expect(s.buttonRadius).toBe('18px');
      expect(s.cardRadius).toBe(`${id.tokens.radius.lg}px`);

      // Color: the button fill and the page background are the identity's colors for this mode.
      await page.locator('#swatches input[value="#b91c1c"]').check();
      id = await identity(page);
      s = await scene(page);
      const set = id.tokens.color[mode];
      expect(s.background).toBe(rgb(set.background));
      const fill = await page.evaluate(
        () => getComputedStyle(document.getElementById('preview').shadowRoot.querySelector('.hw-btn')).backgroundColor
      );
      expect(fill).toBe(rgb(set.primary));
      expect(s.lineHeight).toBe(String(id.tokens.font.lineHeight[lang]));
      expect(errors).toEqual([]);
    });
  }
}

test('light and dark really differ, and switching back restores light', async ({ page }) => {
  await page.goto(PAGE);
  await page.locator('[data-preview-mode="light"]').click();
  const light = await scene(page);
  await page.locator('[data-preview-mode="dark"]').click();
  const dark = await scene(page);
  const id = await identity(page);
  expect(light.background).toBe(rgb(id.tokens.color.light.background));
  expect(dark.background).toBe(rgb(id.tokens.color.dark.background));
  expect(dark.background).not.toBe(light.background);
  await page.locator('[data-preview-mode="light"]').click();
  expect((await scene(page)).background).toBe(light.background);
});

test('the preview language is separate from the tool language', async ({ page }) => {
  await page.goto(PAGE);
  await page.locator('[data-preview-lang="en"]').click();
  expect((await scene(page)).dir).toBe('ltr');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await page.locator('#lang-toggle').click(); // tool to English
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await page.locator('[data-preview-lang="ar"]').click();
  expect((await scene(page)).dir).toBe('rtl');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
});

test('until a key is pressed, the preview follows the identity and the device', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(PAGE);
  // The starter identity: Arabic project, modes template "follow the device".
  let s = await scene(page);
  expect([s.lang, s.mode]).toEqual(['ar', 'dark']);
  await expect(page.locator('[data-preview-mode="dark"]')).toHaveAttribute('aria-pressed', 'true');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.reload();
  s = await scene(page);
  expect(s.mode).toBe('light');
});

test('styles never mix: tool rules stay out of the scene, scene rules stay out of the tool', async ({ page }) => {
  await page.goto(PAGE);
  await page.locator('[data-preview-mode="light"]').click();
  const id = await identity(page);

  // Scene rules (recipes and scene CSS) do not reach tool elements that use the same class names.
  const outside = await page.evaluate(() => {
    const b = document.createElement('button');
    b.className = 'hw-btn';
    const d = document.createElement('div');
    d.className = 'hw-card sc-landing';
    document.body.append(b, d);
    const bs = getComputedStyle(b);
    const ds = getComputedStyle(d);
    return { radius: bs.borderTopLeftRadius, padding: ds.paddingTop, display: ds.display };
  });
  expect(outside).toEqual({ radius: '0px', padding: '0px', display: 'block' });

  // Tool rules, even !important ones, do not reach the scene.
  await page.addStyleTag({
    content:
      'button, h1, .hw-btn, .scene { background: rgb(1, 2, 3) !important; color: rgb(4, 5, 6) !important; border-radius: 0 !important; }'
  });
  const inside = await page.evaluate(() => {
    const root = document.getElementById('preview').shadowRoot;
    const b = getComputedStyle(root.querySelector('.hw-btn'));
    return {
      bg: b.backgroundColor,
      radius: b.borderTopLeftRadius,
      scene: getComputedStyle(root.querySelector('.scene')).backgroundColor
    };
  });
  expect(inside.bg).toBe(rgb(id.tokens.color.light.primary));
  expect(inside.radius).toBe(`${id.tokens.radius.md}px`);
  expect(inside.scene).toBe(rgb(id.tokens.color.light.background));

  // Inherited settings of the tool (spacing, italics, capitals) do not flow into the scene either:
  // Arabic must never get them by accident.
  await page.addStyleTag({
    content: 'body, #preview { letter-spacing: 5px; font-style: italic; text-transform: uppercase; word-spacing: 9px; }'
  });
  const inherited = await page.evaluate(() => {
    const cs = getComputedStyle(document.getElementById('preview').shadowRoot.querySelector('.sc-lead'));
    return [cs.letterSpacing, cs.fontStyle, cs.textTransform, cs.wordSpacing];
  });
  expect(inherited).toEqual(['normal', 'normal', 'none', '0px']);
});

test('the brand name in the scene is the identity name, shown as text', async ({ page }) => {
  await page.goto(PAGE);
  await page.locator('#identity-name').fill('متجر & <b>ورد</b>');
  await expect(page.locator('#identity-name-error')).toBeVisible(); // "<" is not allowed in a name
  await page.locator('#identity-name').fill('متجر & ورد');
  const logo = await page.evaluate(() => {
    const n = document.getElementById('preview').shadowRoot.querySelector('.sc-logo');
    return { text: n.textContent, children: n.children.length };
  });
  expect(logo).toEqual({ text: 'متجر & ورد', children: 0 });
});
