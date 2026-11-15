// ESLint (flat config): catches real mistakes (undefined names, unused variables, unreachable code).
// Formatting is Prettier's job. Run: npm run lint
'use strict';
const js = require('@eslint/js');

const browser = {
  window: 'readonly',
  document: 'readonly',
  self: 'readonly',
  navigator: 'readonly',
  location: 'readonly',
  console: 'readonly',
  fetch: 'readonly',
  Blob: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  AbortController: 'readonly',
  CustomEvent: 'readonly',
  localStorage: 'readonly',
  Storage: 'readonly',
  DOMException: 'readonly',
  Intl: 'readonly',
  NodeFilter: 'readonly',
  getComputedStyle: 'readonly',
  TextEncoder: 'readonly',
  TextDecoder: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  module: 'readonly',
  require: 'readonly'
};

const node = {
  require: 'readonly',
  module: 'writable',
  exports: 'writable',
  __dirname: 'readonly',
  __filename: 'readonly',
  process: 'readonly',
  console: 'readonly',
  Buffer: 'readonly',
  URL: 'readonly',
  TextDecoder: 'readonly',
  TextEncoder: 'readonly',
  WebSocket: 'readonly',
  URLSearchParams: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  setImmediate: 'readonly',
  structuredClone: 'readonly',
  fetch: 'readonly',
  AbortController: 'readonly'
};

module.exports = [
  { ignores: ['node_modules/', 'sandbox/', 'test-results/', 'playwright-report/', 'picker/data/'] },
  js.configs.recommended,
  {
    rules: {
      // The checkers and the zip writer match control characters on purpose.
      'no-control-regex': 'off',
      // `catch {}` is used where a failed cleanup must never hide the real result.
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Style only, no effect on behavior: reported, not blocking.
      'no-useless-escape': 'warn',
      'no-useless-assignment': 'warn'
    }
  },
  {
    files: ['picker/**/*.js'],
    languageOptions: { sourceType: 'script', ecmaVersion: 2020, globals: browser },
    rules: { 'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }] }
  },
  {
    files: ['tools/**/*.js', 'scripts/**/*.js', 'tests/**/*.js', '*.js'],
    languageOptions: { sourceType: 'commonjs', ecmaVersion: 2024, globals: node },
    rules: { 'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }] }
  },
  {
    // Tests feed numbers beyond double precision and rethrow with their own messages on purpose.
    files: ['tests/**/*.js'],
    rules: { 'no-loss-of-precision': 'off', 'preserve-caught-error': 'off' }
  },
  {
    // Page code run inside the browser by the tests.
    files: ['tests/e2e/**/*.js'],
    languageOptions: { globals: { ...node, ...browser } }
  }
];
