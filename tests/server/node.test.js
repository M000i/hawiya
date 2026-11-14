'use strict';

/*
 * Runs the shared server cases (tests/server/cases.json) against scripts/serve.js.
 * Each case gets a fresh temp project and a fresh server process.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SERVER = path.join(__dirname, '..', '..', 'scripts', 'serve.js');
const SPEC = JSON.parse(fs.readFileSync(path.join(__dirname, 'cases.json'), 'utf8'));

function fixture(v) {
  if (typeof v === 'string' && v.startsWith('@')) return SPEC.fixtures[v.slice(1)];
  return v;
}

function resolveBody(body) {
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
    fs.writeFileSync(p, content);
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

function startServer(project, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SERVER, project, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
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

function lastStatus(stdout) {
  const lines = stdout.trim().split('\n').filter(Boolean);
  try {
    return JSON.parse(lines[lines.length - 1]).status;
  } catch {
    return undefined;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('ready line: loopback URL, random port, long token in the URL fragment', async () => {
  const a = makeProject();
  const b = makeProject();
  const s1 = await startServer(a.project);
  const s2 = await startServer(b.project);
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
  }
});

test('listens on loopback only: not reachable on any other local address', async (t) => {
  const others = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i.address);
  const { root, project } = makeProject();
  const s = await startServer(project);
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

test('ready line lists design files that already exist', async () => {
  const p = makeProject({ files: { 'design/DESIGN.md': 'x', 'design/notes.txt': 'y' } });
  const s = await startServer(p.project);
  try {
    assert.deepEqual(s.ready.existing, ['DESIGN.md']);
  } finally {
    s.child.kill();
  }
});

test('refuses to start on a project folder that does not exist', async () => {
  const missing = path.join(os.tmpdir(), 'hawiya-does-not-exist-' + process.pid);
  await assert.rejects(startServer(missing), /exited before ready/);
});

for (const c of SPEC.cases) {
  test(`case: ${c.name}`, async () => {
    const { root, project } = makeProject(c.setup);
    const s = await startServer(project, c.args || []);
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
        if (r.body) body = JSON.stringify(resolveBody(r.body));
        if (r.bodyRaw != null) body = r.bodyRaw;
        if (r.bodyFiller) body = '{"files":{"DESIGN.md":"' + 'a'.repeat(r.bodyFiller) + '"}}';
        const mode = r.reset ? 'reset' : r.hold ? 'hold' : r.chunked ? 'chunked' : 'normal';
        if (r.delayBeforeMs) await sleep(r.delayBeforeMs);
        const times = r.repeat || 1;
        for (let i = 0; i < times; i++) {
          const res = await rawRequest(ctx.port, { method: r.method, path: fill(r.path, ctx), headers, body, mode });
          if (mode === 'reset') continue;
          assert.equal(res.status, r.expectStatus, `${r.method} ${r.path} -> ${res.status} ${res.body}`);
          assert.equal(res.headers['access-control-allow-origin'], undefined, 'no CORS header may be sent');
          if (r.expectBodyContains) assert.ok(res.body.includes(r.expectBodyContains));
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

      for (const [rel, content] of Object.entries(e.files || {})) {
        assert.equal(fs.readFileSync(path.join(project, rel), 'utf8'), fixture(content), rel);
      }
      for (const rel of e.absent || []) {
        assert.equal(fs.existsSync(path.join(project, rel)), false, `${rel} must not exist`);
      }
      assert.equal(s.stdout.includes(ctx.token) && s.stdout.split('\n').slice(1).join('\n').includes(ctx.token), false,
        'token must appear only in the ready line');
      assert.doesNotMatch(s.stderr, /Error|EACCES|EEXIST/, 'server must not crash: ' + s.stderr);
    } finally {
      if (!s.exited) s.child.kill();
      cleanup(root, project);
    }
  });
}
