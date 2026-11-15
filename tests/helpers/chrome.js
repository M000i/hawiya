'use strict';

/*
 * Minimal headless Chrome driver over the DevTools protocol (Node's built-in WebSocket, no dependencies).
 * Tests call launch(); it resolves to null when Chrome is not installed, so the test can skip instead of failing.
 *
 *   const c = await launch();             // { open(url), eval(expr), media(features), errors(), close() } or null
 *   c.errors() lists page exceptions, console errors and browser log errors (CSP violations, failed loads) so far.
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
].filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  return CANDIDATES.find((p) => fs.existsSync(p)) || null;
}

async function launch() {
  const bin = findChrome();
  if (!bin || typeof WebSocket !== 'function') return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hawiya-chrome-'));
  const proc = spawn(bin, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
  const cleanup = () => {
    try {
      proc.kill();
    } catch {}
    setTimeout(() => fs.rmSync(dir, { recursive: true, force: true }), 300).unref();
  };
  try {
    let port;
    for (let i = 0; i < 150 && !port; i++) {
      const f = path.join(dir, 'DevToolsActivePort');
      if (fs.existsSync(f)) port = fs.readFileSync(f, 'utf8').split('\n')[0];
      else await sleep(100);
    }
    if (!port) throw new Error('Chrome did not start');
    let page;
    for (let i = 0; i < 50 && !page; i++) {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
      page = targets.find((t) => t.type === 'page');
      if (!page) await sleep(100);
    }
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve);
      ws.addEventListener('error', reject);
    });
    let id = 0;
    const pending = new Map();
    const loaded = [];
    const errors = [];
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.method === 'Runtime.exceptionThrown') errors.push({ kind: 'exception', text: String(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text) });
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push({ kind: 'console', text: JSON.stringify(m.params.args.map((a) => a.value)) });
      if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push({ kind: 'log', text: m.params.entry.text, url: m.params.entry.url || '' });
      if (m.id && pending.has(m.id)) {
        pending.get(m.id)(m);
        pending.delete(m.id);
      }
      if (m.method === 'Page.loadEventFired') loaded.splice(0).forEach((r) => r());
    });
    const send = (method, params = {}) =>
      new Promise((resolve) => {
        const i = ++id;
        pending.set(i, resolve);
        ws.send(JSON.stringify({ id: i, method, params }));
      });
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Log.enable');
    return {
      async open(url) {
        const done = new Promise((r) => loaded.push(r));
        await send('Page.navigate', { url });
        await Promise.race([done, sleep(10000)]);
      },
      async eval(expression) {
        const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        if (r.result.exceptionDetails) throw new Error('page error: ' + JSON.stringify(r.result.exceptionDetails).slice(0, 300));
        return r.result.result.value;
      },
      errors() {
        return errors.slice();
      },
      async media(features) {
        await send('Emulation.setEmulatedMedia', { features });
      },
      close() {
        try {
          ws.close();
        } catch {}
        cleanup();
      }
    };
  } catch (e) {
    cleanup();
    throw e;
  }
}

module.exports = { launch, findChrome };
