'use strict';

/* Shared server cases against the Node implementation. */
const path = require('node:path');
const { defineServerTests } = require('./runner.js');

defineServerTests('node', [process.execPath, path.join(__dirname, '..', '..', 'scripts', 'serve.js')]);

/*
 * Node-only checks with injected disk faults (the operating system cannot produce these on demand).
 * The shared cases above run against both servers; these protect the failure paths of scripts/serve.js.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const R = require('./runner.js');

const SERVE = path.join(__dirname, '..', '..', 'scripts', 'serve.js');
const INJECT = path.join(__dirname, 'inject.js');
const CMD = [process.execPath, '--require', INJECT, SERVE];
const NAMES = ['identity.json', 'DESIGN.md', 'tokens.json', 'tokens.css', 'theme.css', 'style-guide.html'];
R.setSpec('cases.json');

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

test('[node] --replace: a rename that fails midway loses nothing (originals back, no backup or temp left)', async () => {
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

test('[node] a write that fails halfway leaves no partial temp file and removes the design folder it created', async () => {
  const r = await exportOnce({}, [], { writeFail: 'tokens.json' });
  try {
    assert.equal(r.first.status, 500, r.first.body);
    assert.equal(listDesign(r.design), null, 'design/ removed');
  } finally {
    r.s.child.kill();
    R.cleanup(r.p.root, r.p.project);
  }
});

test('[node] after a failed write the token still works: the retry saves', async () => {
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

test('[node] --replace keeps permissions and gives the canonical name on a case-insensitive disk', async (t) => {
  const r0 = R.makeProject({ files: { 'design/Identity.json': '{}\n', 'design/DESIGN.md': 'OLD\n' } });
  const caseInsensitive = fs.existsSync(path.join(r0.project, 'design', 'identity.json'));
  R.cleanup(r0.root, r0.project);
  const setup = { files: { 'design/DESIGN.md': 'OLD\n' } };
  if (caseInsensitive) setup.files['design/Identity.json'] = '{}\n';
  const p = R.makeProject(setup);
  fs.chmodSync(path.join(p.project, 'design', 'DESIGN.md'), 0o600);
  const s = await R.startServer([process.execPath, SERVE], p.project, ['--replace']);
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

test('[node] a FIFO in place of the session file never hangs the server', async () => {
  const p = R.makeProject({ files: { 'design/.keep': '' } });
  execFileSync('mkfifo', [path.join(p.project, 'design', 'hawiya-session.json')]);
  const s = await R.startServer([process.execPath, SERVE], p.project);
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
