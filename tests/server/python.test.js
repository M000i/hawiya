'use strict';

/* Shared server cases against the Python implementation (same cases, same runner as Node). */
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { defineServerTests } = require('./runner.js');

const PYTHON = process.env.HAWIYA_PYTHON || 'python3';
const probe = spawnSync(PYTHON, ['-c', 'import sys; print("%d.%d" % sys.version_info[:2])'], { encoding: 'utf8' });

if (probe.status !== 0) {
  test('[python] python3 not found: Python server cases skipped', { skip: true }, () => {});
} else {
  // -I: isolated mode (ignore PYTHON* env vars and the user site dir), as the skill will run it.
  defineServerTests('python ' + probe.stdout.trim(), [PYTHON, '-I', path.join(__dirname, '..', '..', 'scripts', 'serve.py')]);
}
