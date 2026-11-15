'use strict';

/* Shared server cases against the Python implementation (same cases, same runner as Node). */
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { defineServerTests, defineFaultTests } = require('./runner.js');

const PYTHON = process.env.HAWIYA_PYTHON || 'python3';
const probe = spawnSync(PYTHON, ['-c', 'import sys; print("%d.%d" % sys.version_info[:2])'], { encoding: 'utf8' });

if (probe.status !== 0) {
  test('[python] python3 not found: Python server cases skipped', { skip: true }, () => {});
} else {
  // -I: isolated mode (ignore PYTHON* env vars and the user site dir), as the skill will run it.
  const label = 'python ' + probe.stdout.trim();
  const serve = path.join(__dirname, '..', '..', 'scripts', 'serve.py');
  defineServerTests(label, [PYTHON, '-I', serve]); // the same case list as Node (task 1.14)
  defineFaultTests(label, [PYTHON, '-I', path.join(__dirname, 'inject.py'), serve], [PYTHON, '-I', serve]);
}
