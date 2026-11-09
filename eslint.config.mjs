import { defineConfig, globalIgnores } from 'eslint/config';
import angular from 'angular-eslint';
import tseslint from 'typescript-eslint';

const layer = (message, ...group) => ({
  patterns: [{ group, message }],
});

export default defineConfig([
  globalIgnores(['dist/**', 'coverage/**', '.angular/**', 'node_modules/**']),
  {
    files: ['**/*.ts'],
    extends: [
      tseslint.configs.recommended,
      tseslint.configs.stylistic,
      angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: 'app', style: 'camelCase' },
      ],
      '@angular-eslint/component-selector': [
        'error',
        { type: 'element', prefix: 'app', style: 'kebab-case' },
      ],
      '@angular-eslint/prefer-signals': 'error',
      '@angular-eslint/prefer-output-readonly': 'error',
      '@angular-eslint/component-max-inline-declarations': [
        'error',
        { template: 0, styles: 0, animations: 0 },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/explicit-member-accessibility': 'off',
      'no-warning-comments': ['error', { terms: ['todo', 'fixme', 'xxx', 'hack'] }],
    },
  },
  {
    files: ['src/app/core/**/*.ts', 'src/app/shared/**/*.ts'],
    ignores: ['**/*.spec.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        layer(
          'core and shared are leaf layers and cannot import other app layers',
          '**/mcp/**',
          '**/features/**',
        ),
      ],
    },
  },
  {
    files: ['src/app/mcp/**/*.ts'],
    ignores: ['**/*.spec.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        layer(
          'mcp is a reusable platform and cannot import features or Material',
          '**/features/**',
          '@angular/material',
          '@angular/material/**',
        ),
      ],
    },
  },
  {
    files: ['**/*.html'],
    extends: [angular.configs.templateRecommended, angular.configs.templateAccessibility],
    rules: {
      '@angular-eslint/template/prefer-control-flow': 'error',
      '@angular-eslint/template/prefer-self-closing-tags': 'error',
    },
  },
]);
