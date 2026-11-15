// Browser tests of the page (tests/e2e/). Run: npm run test:e2e
// Uses the Chrome already installed on this machine (channel "chrome"), so no browser is downloaded.
// Set HAWIYA_PW_CHANNEL=chromium to use Playwright's own Chromium (after `npx playwright install chromium`).
'use strict';
const { defineConfig } = require('@playwright/test');

const channel = process.env.HAWIYA_PW_CHANNEL || 'chrome';

module.exports = defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    browserName: 'chromium',
    channel: channel === 'chromium' ? undefined : channel,
    headless: true
  }
});
