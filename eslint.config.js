import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    files: ['**/*.js'],
    languageOptions: {
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.serviceworker, chrome: 'readonly' },
    },
  },
  // Classic scripts: loaded by the browser, not as modules.
  { files: ['content-core.js', 'popup.js', 'platforms/**'], languageOptions: { sourceType: 'script' } },
  { files: ['eslint.config.js', 'test/**'], languageOptions: { globals: globals.node } },
  {
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
];
