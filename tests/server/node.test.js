'use strict';

/* Shared server cases against the Node implementation. */
const path = require('node:path');
const { defineServerTests } = require('./runner.js');

defineServerTests('node', [process.execPath, path.join(__dirname, '..', '..', 'scripts', 'serve.js')]);
