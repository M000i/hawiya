'use strict';

/*
 * Shared runner: executes tests/server/cases.json (and a few extra checks) against one server
 * implementation. node.test.js and python.test.js call defineServerTests with their command.
 * Each case gets a fresh temp project and a fresh server process.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const bundleMod = require('../../picker/js/core/bundle.js');

let SPEC = null;

// "@bundle" is a complete, valid export bundle built from tests/fixtures/identity/valid/<SPEC.bundleIdentity>
// (the runner is Node for both servers, so both receive exactly the same bytes).
let BUNDLE = null;
function theBundle() {
  if (!BUNDLE) {
    const id = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'identity', 'valid', SPEC.bundleIdentity), 'utf8'));
    BUNDLE = bundleMod.build(id);
  }
  return BUNDLE;
}

function fixture(v) {
  if (typeof v === 'string' && v.startsWith('@bundle:')) return theBundle().files[v.slice('@bundle:'.length)];
  if (typeof v === 'string' && v.startsWith('@')) return SPEC.fixtures[v.slice(1)];
  return v;
}

/*
 * change: list of edits applied to a copy of the bundle, in order:
 *   { set: [key, key, ...], value }   set a nested value (keys are taken literally, so "DESIGN.md" is one key)
 *   { set: [key], nested: N }         set arrays nested so that the whole body is N levels deep
 *   { delete: [key, ...] }            remove a nested key
 *   { rehash: "name" }                recompute sha256[name] after changing files[name]
 *   { identityFromText: true }        set identity = JSON.parse(files["identity.json"]) (keeps them consistent)
 *   { duplicateKey: "name" }          write that key twice in identity.json and update its fingerprint
 */
function applyChanges(b, changes) {
  for (const ch of changes || []) {
    if (ch.set || ch.delete) {
      const keys = ch.set || ch.delete;
      let node = b;
      for (const k of keys.slice(0, -1)) node = node[k];
      const last = keys[keys.length - 1];
      let value = ch.value;
      if (ch.nested != null) {
        // arrays nested so that the whole body reaches exactly ch.nested levels (the bundle object is level 1)
        value = 0;
        for (let i = 0; i < ch.nested - keys.length; i++) value = [value];
      }
      if (ch.set) Object.defineProperty(node, last, { value, enumerable: true, writable: true, configurable: true });
      else delete node[last];
    } else if (ch.rehash) {
      b.sha256[ch.rehash] = bundleMod.sha256(b.files[ch.rehash]);
    } else if (ch.duplicateKey) {
      // identity.json with one key written twice (first value fake, last value the real one), fingerprint updated
      const text = b.files['identity.json'];
      b.files['identity.json'] = text.replace('"' + ch.duplicateKey + '":', '"' + ch.duplicateKey + '": "FAKE", "' + ch.duplicateKey + '":');
      b.sha256['identity.json'] = bundleMod.sha256(b.files['identity.json']);
    } else if (ch.identityFromText) {
      b.identity = JSON.parse(b.files['identity.json']);
    } else {
      throw new Error('unknown change ' + JSON.stringify(ch));
    }
  }
  return b;
}

function resolveBody(body, changes) {
  if (body === '@bundle') return applyChanges(structuredClone(theBundle()), changes);
  const out = JSON.parse(JSON.stringify(body));
  if (out.files && typeof out.files === 'object') {
    for (const k of Object.keys(out.files)) out.files[k] = fixture(out.files[k]);
  }
  return out;
}

function fill(s, ctx) {
  return String(s).replaceAll('{TOKEN}', ctx.token).replaceAll('{ORIGIN}', ctx.origin);
}

function makeProject(setup = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hawiya-srv-'));
  const project = path.join(root, 'project');
  fs.mkdirSync(project);
  fs.mkdirSync(path.join(root, 'outside'));
  for (const [rel, content] of Object.entries(setup.files || {})) {
    const p = path.join(project, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, fixture(content));
  }
  for (const [rel, target] of Object.entries(setup.symlinks || {})) {
    fs.mkdirSync(path.dirname(path.join(project, rel)), { recursive: true });
    fs.symlinkSync(target, path.join(project, rel));
  }
  if (setup.readonlyProject) fs.chmodSync(project, 0o555);
  return { root, project };
}

function cleanup(root, project) {
  try {
    fs.chmodSync(project, 0o755);
  } catch {
    /* already gone */
  }
  fs.rmSync(root, { recursive: true, force: true });
}

// Every test server gets a random port (--port 0), so tests can run side by side; only tests/server/port.test.js
// asks for the real default (opts.defaultPort), the fixed port 47821 (task 3.0a).
function startServer(cmd, project, args = [], env = undefined, opts = {}) {
  if (!opts.defaultPort && !args.includes('--port')) args = [...args, '--port', '0'];
  return new Promise((resolve, reject) => {
    const child = spawn(cmd[0], [...cmd.slice(1), project, ...args], { stdio: ['ignore', 'pipe', 'pipe'], env: env ? { ...process.env, ...env } : process.env });
    const state = { child, stdout: '', stderr: '', exited: false, exitCode: null };
    const exitPromise = new Promise((r) => child.on('exit', (code) => { state.exited = true; state.exitCode = code; r(code); }));
    state.exitPromise = exitPromise;
    child.stderr.on('data', (d) => (state.stderr += d));
    let ready = false;
    child.stdout.on('data', (d) => {
      state.stdout += d;
      if (!ready && state.stdout.includes('\n')) {
        ready = true;
        try {
          state.ready = JSON.parse(state.stdout.split('\n')[0]);
          state.readyAt = Date.now();
          resolve(state);
        } catch (e) {
          reject(new Error('first stdout line is not JSON: ' + state.stdout));
        }
      }
    });
    exitPromise.then(() => { if (!ready) reject(new Error('server exited before ready: ' + state.stderr)); });
    setTimeout(() => { if (!ready) reject(new Error('server not ready in time')); }, 5000);
  });
}

/*
 * mode: 'normal' | 'chunked' (no Content-Length, body in pieces) | 'hold' (chunked, send 1 KB, never end)
 *       | 'reset' (send everything, then RST the socket without reading the reply).
 * For 'hold', resolves with serverClosed = whether the server closed the socket within 1.5 s.
 */
function rawRequest(port, { method, path: p, headers = {}, body, mode = 'normal' }) {
  return new Promise((resolve, reject) => {
    const h = { ...headers };
    if (mode === 'hold') {
      h['Transfer-Encoding'] = 'chunked'; // no declared length: the server cannot know when it ends
      h['Connection'] = 'keep-alive'; // like an attacker: do not ask the server to close
    }
    const req = http.request({ host: '127.0.0.1', port, method, path: p, headers: h, agent: false });
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };

    if (mode === 'reset') {
      req.on('error', () => {});
      req.end(body || undefined, () => {
        req.socket.resetAndDestroy();
        setTimeout(() => done({ status: null, reset: true }), 150);
      });
      return;
    }

    req.on('response', (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (data += c));
      const result = () => ({ status: res.statusCode, headers: res.headers, body: data });
      if (mode === 'hold') {
        let closed = false;
        req.socket.on('close', () => (closed = true));
        setTimeout(() => { const r = result(); r.serverClosed = closed; req.destroy(); done(r); }, 1500);
        return;
      }
      res.on('end', () => done(result()));
      res.on('error', () => done(result()));
    });
    req.on('error', (e) => { if (!settled) { settled = true; reject(e); } });

    if (mode === 'hold') {
      req.write('x'.repeat(1024));
    } else if (mode === 'chunked' && body != null) {
      const piece = 64 * 1024;
      for (let i = 0; i < body.length; i += piece) req.write(body.slice(i, i + piece));
      req.end();
    } else if (body != null) {
      req.end(body);
    } else {
      req.end();
    }
  });
}

/*
 * Smuggling probe: a refused POST whose Content-Length body is itself a complete GET request.
 * Keeps the socket open and counts how many HTTP responses come back. Exactly one is correct:
 * the unread body must never be parsed as a second request.
 */
function smuggleProbe(port) {
  const host = `127.0.0.1:${port}`;
  const inner = `GET / HTTP/1.1\r\nHost: ${host}\r\n\r\n`;
  const outer =
    `POST /nope HTTP/1.1\r\nHost: ${host}\r\nContent-Type: text/plain\r\nConnection: keep-alive\r\n` +
    `Content-Length: ${Buffer.byteLength(inner)}\r\n\r\n` + inner;
  return rawProbe(port, outer);
}

/* Sends raw bytes, keeps the socket open, and reports every HTTP status line that comes back. */
function rawProbe(port, raw) {
  return new Promise((resolve) => {
    const net = require('node:net');
    const sock = net.connect({ host: '127.0.0.1', port });
    const outer = raw;
    let data = '';
    const done = () => {
      sock.destroy();
      const statuses = [...data.matchAll(/HTTP\/1\.[01] (\d{3})/g)].map((m) => Number(m[1]));
      resolve({ status: statuses[0], responses: statuses.length, statuses, bytes: data.length, data });
    };
    sock.on('connect', () => sock.write(outer));
    sock.on('data', (d) => (data += d.toString('latin1')));
    sock.on('error', () => {});
    sock.on('close', done);
    setTimeout(done, 1500);
  });
}

function lastStatus(stdout) {
  const lines = stdout.trim().split('\n').filter(Boolean);
  try {
    return JSON.parse(lines[lines.length - 1]).status;
  } catch {
    return undefined;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* cmd: [executable, ...args before the project dir]; casesFile: the case list in this folder */
function defineServerTests(label, cmd, casesFile = 'cases.json') {
  SPEC = JSON.parse(fs.readFileSync(path.join(__dirname, casesFile), 'utf8'));
  test(`[${label}] ready line: loopback URL, random port, long token in the URL fragment`, async () => {
    const a = makeProject();
    const b = makeProject();
    const s1 = await startServer(cmd, a.project);
    const s2 = await startServer(cmd, b.project);
    try {
      for (const s of [s1, s2]) {
        const u = new URL(s.ready.url);
        assert.equal(u.protocol, 'http:');
        assert.equal(u.hostname, '127.0.0.1');
        assert.ok(Number(u.port) > 0);
        assert.equal(u.search, '', 'token must not be in the query string');
        const token = new URLSearchParams(u.hash.slice(1)).get('token');
        assert.ok(token && token.length >= 32, 'token too short');
        assert.deepEqual(s.ready.existing, []);
      }
      assert.notEqual(s1.ready.url, s2.ready.url, 'two runs must differ in port and token');
      assert.doesNotMatch(s1.stderr, new RegExp(new URLSearchParams(new URL(s1.ready.url).hash.slice(1)).get('token')));
    } finally {
      s1.child.kill();
      s2.child.kill();
      cleanup(a.root, a.project);
      cleanup(b.root, b.project);
    }
  });

  test(`[${label}] listens on loopback only: not reachable on any other local address`, async (t) => {
    const others = Object.values(os.networkInterfaces())
      .flat()
      .filter((i) => i && i.family === 'IPv4' && !i.internal)
      .map((i) => i.address);
    const { root, project } = makeProject();
    const s = await startServer(cmd, project);
    const port = Number(new URL(s.ready.url).port);
    try {
      const net = require('node:net');
      const tryConnect = (host) =>
        new Promise((resolve) => {
          const sock = net.connect({ host, port });
          sock.once('connect', () => { sock.destroy(); resolve('connected'); });
          sock.once('error', (e) => resolve(e.code));
          setTimeout(() => { sock.destroy(); resolve('timeout'); }, 1000);
        });
      assert.equal(await tryConnect('127.0.0.1'), 'connected');
      if (others.length === 0) t.diagnostic('no non-loopback IPv4 address on this machine; only loopback checked');
      for (const addr of others) assert.notEqual(await tryConnect(addr), 'connected', `reachable on ${addr}`);
    } finally {
      s.child.kill();
      cleanup(root, project);
    }
  });

  test(`[${label}] ready line lists design files that already exist`, async () => {
    const p = makeProject({ files: { 'design/DESIGN.md': 'x', 'design/notes.txt': 'y' } });
    const s = await startServer(cmd, p.project);
    try {
      assert.deepEqual(s.ready.existing, ['DESIGN.md']);
    } finally {
      s.child.kill();
      cleanup(p.root, p.project);
    }
  });

  test(`[${label}] refuses to start on a project folder that does not exist`, async () => {
    const missing = path.join(os.tmpdir(), 'hawiya-does-not-exist-' + process.pid);
    await assert.rejects(startServer(cmd, missing), /exited before ready/);
  });

  for (const c of SPEC.cases) {
    test(`[${label}] case: ${c.name}`, async () => {
      const { root, project } = makeProject(c.setup);
      const s = await startServer(cmd, project, c.args || []);
      // The agent may stop reading stdout after the ready line; the server must still exit after saving.
      if (c.closeStdoutAfterReady) s.child.stdout.destroy();
      const u = new URL(s.ready.url);
      const ctx = {
        port: Number(u.port),
        origin: `http://127.0.0.1:${u.port}`,
        token: new URLSearchParams(u.hash.slice(1)).get('token')
      };
      try {
        for (const r of c.requests) {
          const headers = {};
          for (const [k, v] of Object.entries(r.headers || {})) headers[k] = fill(v, ctx);
          let body = null;
          if (r.body) body = JSON.stringify(resolveBody(r.body, r.change));
          if (r.bodyRaw != null) body = r.bodyRaw;
          if (r.bodyFiller) body = '{"files":{"DESIGN.md":"' + 'a'.repeat(r.bodyFiller) + '"}}';
          const mode = r.reset ? 'reset' : r.hold ? 'hold' : r.chunked ? 'chunked' : 'normal';
          if (r.delayBeforeMs) await sleep(r.delayBeforeMs);
          if (r.smuggle) {
            const res = await smuggleProbe(ctx.port);
            assert.equal(res.status, r.expectStatus, `smuggle probe statuses: ${res.statuses}`);
            assert.equal(res.responses, 1, `a hidden second request was handled: statuses ${res.statuses}`);
            continue;
          }
          if (r.raw != null) {
            const host = `127.0.0.1:${ctx.port}`;
            const raw = fill(r.raw, ctx).replaceAll('{HOST}', host).replaceAll('{LEN_INNER}', String(Buffer.byteLength(
              `GET / HTTP/1.1\r\nHost: ${host}\r\n\r\n`)));
            const res = await rawProbe(ctx.port, raw);
            if (r.expectStatus === null) {
              assert.equal(res.bytes, 0, `expected no reply at all, got ${res.bytes} bytes, statuses ${res.statuses}`);
            } else if (r.expectStatus !== undefined) {
              assert.equal(res.status, r.expectStatus, `raw statuses: ${res.statuses}`);
            }
            // Whatever comes back must be a real HTTP response (status line + headers), never raw content.
            if (res.bytes > 0) assert.match(res.data, /^HTTP\/1\.[01] \d{3} /, `reply without a status line: ${res.data.slice(0, 80)}`);
            if (r.expectNotContains) assert.ok(!res.data.includes(r.expectNotContains), `reply leaked: ${r.expectNotContains}`);
            if (r.maxResponses != null) {
              assert.ok(res.responses <= r.maxResponses, `too many responses (smuggling?): statuses ${res.statuses}`);
            }
            continue;
          }
          const times = r.repeat || 1;
          for (let i = 0; i < times; i++) {
            const res = await rawRequest(ctx.port, { method: r.method, path: fill(r.path, ctx), headers, body, mode });
            if (mode === 'reset') continue;
            assert.equal(res.status, r.expectStatus, `${r.method} ${r.path} -> ${res.status} ${res.body}`);
            assert.equal(res.headers['access-control-allow-origin'], undefined, 'no CORS header may be sent');
            for (const want of [].concat(r.expectBodyContains || [])) assert.ok(res.body.includes(want), `reply should mention ${want}: ${res.body.slice(0, 300)}`);
            for (const bad of [].concat(r.expectBodyNotContains || [])) assert.ok(!res.body.includes(bad), `reply must not contain ${bad}: ${res.body.slice(0, 300)}`);
            if (r.expectServerCloses) assert.equal(res.serverClosed, true, 'server should close a refused, unfinished request');
          }
        }

        const e = c.expect || {};
        if (e.exitsWithinMsOfReady) {
          await Promise.race([s.exitPromise, sleep(Math.max(0, s.readyAt + e.exitsWithinMsOfReady - Date.now()))]);
          assert.ok(s.exited, `server should have exited within ${e.exitsWithinMsOfReady} ms of starting`);
        }
        if (e.exits) {
          await Promise.race([s.exitPromise, sleep(3000)]);
          assert.ok(s.exited, 'server should have exited');
          if (e.exitCode != null) assert.equal(s.exitCode, e.exitCode);
        } else {
          await sleep(200);
          assert.equal(s.exited, false, 'server should still be running');
        }
        if (e.stdoutStatus) assert.equal(lastStatus(s.stdout), e.stdoutStatus);
        if (e.stdoutReason) assert.equal(JSON.parse(s.stdout.trim().split('\n').pop()).reason, e.stdoutReason, 'reason on stdout');

        for (const [rel, content] of Object.entries(e.files || {})) {
          assert.equal(fs.readFileSync(path.join(project, rel), 'utf8'), fixture(content), rel);
        }
        for (const rel of e.absent || []) {
          assert.equal(fs.existsSync(path.join(project, rel)), false, `${rel} must not exist`);
        }
        if (e.backup !== undefined) {
          const designDir = path.join(project, 'design');
          const backups = fs.existsSync(designDir) ? fs.readdirSync(designDir).filter((n) => /^backup-\d{8}-\d{6}(-\d+)?$/.test(n)) : [];
          if (e.backup === null) {
            assert.deepEqual(backups, [], 'no backup folder expected');
          } else {
            assert.equal(backups.length, 1, `one backup folder expected, found ${backups}`);
            const dir = path.join(designDir, backups[0]);
            assert.deepEqual(fs.readdirSync(dir).sort(), Object.keys(e.backup).sort(), 'backup contents');
            for (const [name, content] of Object.entries(e.backup)) assert.equal(fs.readFileSync(path.join(dir, name), 'utf8'), fixture(content), `backup ${name}`);
          }
        }
        if (e.written) assert.deepEqual(JSON.parse(s.stdout.trim().split('\n').pop()).written, e.written, 'written list on stdout');
        assert.equal(s.stdout.includes(ctx.token) && s.stdout.split('\n').slice(1).join('\n').includes(ctx.token), false,
          'token must appear only in the ready line');
        assert.doesNotMatch(s.stderr, /Error|EACCES|EEXIST/, 'server must not crash: ' + s.stderr);
        assert.doesNotMatch(s.stdout, /internal error/, 'server must not crash: ' + s.stdout);
      } finally {
        if (!s.exited) s.child.kill();
        cleanup(root, project);
      }
    });
  }
}

/*
 * Checks with injected disk faults (the operating system cannot produce these on demand), for both servers.
 */
const { execFileSync } = require('node:child_process');
const R = { makeProject, cleanup, startServer, rawRequest, theBundle };
const NAMES = ['identity.json', 'DESIGN.md', 'tokens.json', 'tokens.css', 'theme.css', 'style-guide.html'];

/* injectCmd: the server started with fault injection (HAWIYA_INJECT, see inject.js / inject.py); plainCmd: without. */
function defineFaultTests(label, injectCmd, plainCmd) {
SPEC = SPEC || JSON.parse(fs.readFileSync(path.join(__dirname, 'cases.json'), 'utf8'));
const CMD = injectCmd;

async function exportOnce(setup, args, inject, opts = {}) {
  const p = R.makeProject(setup);
  const s = await R.startServer(CMD, p.project, args, inject ? { HAWIYA_INJECT: JSON.stringify(inject) } : undefined);
  const u = new URL(s.ready.url);
  const token = new URLSearchParams(u.hash.slice(1)).get('token');
  const post = () =>
    R.rawRequest(Number(u.port), {
      method: 'POST',
      path: '/api/export',
      headers: { 'X-Hawiya-Token': token, 'Content-Type': 'application/json', Origin: u.origin },
      body: JSON.stringify(R.theBundle())
    });
  const first = await post();
  const second = opts.retry ? await post() : null;
  await Promise.race([s.exitPromise, new Promise((r) => setTimeout(r, 1500))]);
  return { p, s, first, second, design: path.join(p.project, 'design') };
}

const listDesign = (d) => (fs.existsSync(d) ? fs.readdirSync(d).sort() : null);

test(`[${label}] --replace: a rename that fails midway loses nothing (originals back, no backup or temp left)`, async () => {
  const r = await exportOnce({ files: { 'design/DESIGN.md': 'OLD DESIGN\n', 'design/tokens.css': 'OLD TOKENS\n' } }, ['--replace'], { renameFail: 'tokens.css' });
  try {
    assert.equal(r.first.status, 500, r.first.body);
    assert.deepEqual(listDesign(r.design), ['DESIGN.md', 'tokens.css'], 'only the originals are left');
    assert.equal(fs.readFileSync(path.join(r.design, 'DESIGN.md'), 'utf8'), 'OLD DESIGN\n');
    assert.equal(fs.readFileSync(path.join(r.design, 'tokens.css'), 'utf8'), 'OLD TOKENS\n');
  } finally {
    r.s.child.kill();
    R.cleanup(r.p.root, r.p.project);
  }
});

test(`[${label}] a write that fails halfway leaves no partial temp file and removes the design folder it created`, async () => {
  const r = await exportOnce({}, [], { writeFail: 'tokens.json' });
  try {
    assert.equal(r.first.status, 500, r.first.body);
    assert.equal(listDesign(r.design), null, 'design/ removed');
  } finally {
    r.s.child.kill();
    R.cleanup(r.p.root, r.p.project);
  }
});

test(`[${label}] after a failed write the token still works: the retry saves`, async () => {
  const r = await exportOnce({}, [], { renameFail: 'theme.css', times: 1 }, { retry: true });
  try {
    assert.equal(r.first.status, 500, r.first.body);
    assert.equal(r.second.status, 200, r.second.body);
    assert.deepEqual(listDesign(r.design), [...NAMES].sort());
    assert.equal(r.s.exitCode, 0);
  } finally {
    if (!r.s.exited) r.s.child.kill();
    R.cleanup(r.p.root, r.p.project);
  }
});

test(`[${label}] --replace keeps permissions and gives the canonical name on a case-insensitive disk`, async (t) => {
  const r0 = R.makeProject({ files: { 'design/Identity.json': '{}\n', 'design/DESIGN.md': 'OLD\n' } });
  const caseInsensitive = fs.existsSync(path.join(r0.project, 'design', 'identity.json'));
  R.cleanup(r0.root, r0.project);
  const setup = { files: { 'design/DESIGN.md': 'OLD\n' } };
  if (caseInsensitive) setup.files['design/Identity.json'] = '{}\n';
  const p = R.makeProject(setup);
  fs.chmodSync(path.join(p.project, 'design', 'DESIGN.md'), 0o600);
  const s = await R.startServer(plainCmd, p.project, ['--replace']);
  const u = new URL(s.ready.url);
  const res = await R.rawRequest(Number(u.port), {
    method: 'POST',
    path: '/api/export',
    headers: { 'X-Hawiya-Token': new URLSearchParams(u.hash.slice(1)).get('token'), 'Content-Type': 'application/json' },
    body: JSON.stringify(R.theBundle())
  });
  try {
    assert.equal(res.status, 200, res.body);
    const design = path.join(p.project, 'design');
    assert.equal(fs.statSync(path.join(design, 'DESIGN.md')).mode & 0o777, 0o600, 'permissions kept');
    const entries = fs.readdirSync(design).filter((e) => !e.startsWith('backup-')).sort();
    assert.deepEqual(entries, [...NAMES].sort(), 'canonical names');
    if (!caseInsensitive) t.diagnostic('case-sensitive disk: name-case part not applicable');
  } finally {
    if (!s.exited) s.child.kill();
    R.cleanup(p.root, p.project);
  }
});

test(`[${label}] requests with the valid token during a slow save are answered, not counted as failures`, async () => {
  const p = R.makeProject({ files: { 'design/identity.json': '{}\n' } });
  const s = await R.startServer(CMD, p.project, [], { HAWIYA_INJECT: JSON.stringify({ slowLstat: 'identity.json', ms: 800 }) });
  const u = new URL(s.ready.url);
  const token = new URLSearchParams(u.hash.slice(1)).get('token');
  const port = Number(u.port);
  try {
    const exp = R.rawRequest(port, { method: 'POST', path: '/api/export', headers: { 'X-Hawiya-Token': token, 'Content-Type': 'application/json' }, body: JSON.stringify(R.theBundle()) });
    await new Promise((r) => setTimeout(r, 150));
    const sessions = await Promise.all([1, 2, 3, 4, 5].map(() => R.rawRequest(port, { method: 'GET', path: '/api/session', headers: { 'X-Hawiya-Token': token } })));
    assert.equal((await exp).status, 409, 'identity.json exists and --replace was not given');
    assert.deepEqual(sessions.map((x) => x.status), [404, 404, 404, 404, 404], 'valid token: no session file, never 401');
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(s.exited, false, 'the server is still running');
  } finally {
    if (!s.exited) s.child.kill();
    R.cleanup(p.root, p.project);
  }
});

test(`[${label}] file permissions follow the umask like Node; only a replaced file keeps its old permissions`, async () => {
  const withUmask = (mask) => ['/bin/sh', '-c', 'umask ' + mask + '; exec "$0" "$@"', ...plainCmd];
  const save = async (setup, mask, args) => {
    const p = R.makeProject(setup);
    if (setup.chmod) for (const [rel, mode] of Object.entries(setup.chmod)) fs.chmodSync(path.join(p.project, rel), mode);
    const s = await R.startServer(withUmask(mask), p.project, args);
    const u = new URL(s.ready.url);
    const res = await R.rawRequest(Number(u.port), { method: 'POST', path: '/api/export', headers: { 'X-Hawiya-Token': new URLSearchParams(u.hash.slice(1)).get('token'), 'Content-Type': 'application/json' }, body: JSON.stringify(R.theBundle()) });
    await Promise.race([s.exitPromise, new Promise((r) => setTimeout(r, 1500))]);
    return { p, s, res, design: path.join(p.project, 'design') };
  };
  const mode = (f) => fs.statSync(f).mode & 0o7777;
  const a = await save({}, '077', []);
  try {
    assert.equal(a.res.status, 200, a.res.body);
    for (const n of NAMES) assert.equal(mode(path.join(a.design, n)), 0o600, `${n} under umask 077`);
  } finally {
    if (!a.s.exited) a.s.child.kill();
    R.cleanup(a.p.root, a.p.project);
  }
  const b = await save({ files: { 'design/DESIGN.md': 'OLD\n' }, chmod: { 'design/DESIGN.md': 0o664 } }, '022', ['--replace']);
  try {
    assert.equal(b.res.status, 200, b.res.body);
    assert.equal(mode(path.join(b.design, 'DESIGN.md')), 0o664, 'the replaced file keeps its permissions');
    assert.equal(mode(path.join(b.design, 'tokens.css')), 0o644, 'a new file follows the umask');
    const backup = fs.readdirSync(b.design).find((e) => e.startsWith('backup-'));
    assert.equal(mode(path.join(b.design, backup, 'DESIGN.md')), 0o644, 'the backup copy follows the umask, as in Node');
  } finally {
    if (!b.s.exited) b.s.child.kill();
    R.cleanup(b.p.root, b.p.project);
  }
});

test(`[${label}] a FIFO in place of the session file never hangs the server`, async () => {
  const p = R.makeProject({ files: { 'design/.keep': '' } });
  execFileSync('mkfifo', [path.join(p.project, 'design', 'hawiya-session.json')]);
  const s = await R.startServer(plainCmd, p.project);
  const u = new URL(s.ready.url);
  try {
    const res = await R.rawRequest(Number(u.port), { method: 'GET', path: '/api/session', headers: { 'X-Hawiya-Token': new URLSearchParams(u.hash.slice(1)).get('token') } });
    assert.equal(res.status, 404);
    const again = await R.rawRequest(Number(u.port), { method: 'GET', path: '/' });
    assert.equal(again.status, 200, 'still serving');
  } finally {
    s.child.kill();
    R.cleanup(p.root, p.project);
  }
});
}

module.exports = { defineFaultTests, defineServerTests, makeProject, cleanup, startServer, rawRequest, theBundle: () => theBundle(), setSpec: (f) => (SPEC = JSON.parse(fs.readFileSync(path.join(__dirname, f), 'utf8'))) };
