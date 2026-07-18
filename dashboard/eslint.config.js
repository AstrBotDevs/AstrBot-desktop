import js from '@eslint/js';
import jsxA11y from 'eslint-plugin-jsx-a11y';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['coverage/**', 'dist/**', 'node_modules/**', 'src/api/generated/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ['src/**/*.{ts,tsx}', 'vite.config.ts'],
  })),
  {
    files: ['src/**/*.{ts,tsx}', 'vite.config.ts'],
    languageOptions: {
      globals: globals.browser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'jsx-a11y': jsxA11y,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      'jsx-a11y/alt-text': 'error',
      'jsx-a11y/anchor-is-valid': 'error',
      'jsx-a11y/iframe-has-title': 'error',
      'jsx-a11y/label-has-associated-control': [
        'warn',
        {
          assert: 'either',
          depth: 3,
        },
      ],
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': [
        'error',
        {
          checksVoidReturn: {
            arguments: false,
            attributes: false,
          },
        },
      ],
      complexity: ['warn', 35],
      'max-lines': ['warn', { max: 1200, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['warn', { max: 400, skipBlankLines: true, skipComments: true }],
      'no-extra-boolean-cast': 'off',
    },
  },
  {
    files: ['scripts/**/*.mjs', 'eslint.config.js', 'stylelint.config.mjs'],
    languageOptions: {
      globals: globals.node,
    },
  },
);
