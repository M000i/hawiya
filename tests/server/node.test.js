'use strict';

/* Shared server cases against the Node implementation. */
const path = require('node:path');
const { defineServerTests } = require('./runner.js');

defineServerTests('node', [process.execPath, path.join(__dirname, '..', '..', 'scripts', 'serve.js')]);

// The same disk-fault checks run against the Python server (python.test.js), with the faults injected the same way.
const { defineFaultTests } = require('./runner.js');
defineFaultTests('node', [process.execPath, '--require', path.join(__dirname, 'inject.js'), path.join(__dirname, '..', '..', 'scripts', 'serve.js')], [process.execPath, path.join(__dirname, '..', '..', 'scripts', 'serve.js')]);
