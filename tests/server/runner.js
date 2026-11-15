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
      if (ch.set) Object.defineProperty(node, last, { value: ch.value, enumerable: true, writable: true, configurable: true });
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

function startServer(cmd, project, args = [], env = undefined) {
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

module.exports = { defineServerTests, makeProject, cleanup, startServer, rawRequest, theBundle: () => theBundle(), setSpec: (f) => (SPEC = JSON.parse(fs.readFileSync(path.join(__dirname, f), 'utf8'))) };
