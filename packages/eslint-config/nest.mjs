import antfu from '@antfu/eslint-config'
import localRules from './nest-local-rules.mjs'

export default function nestConfig() {
  return antfu(
    {
      typescript: {
        tsconfigPath: './tsconfig.json',
      },
      jsonc: false,
      yaml: false,
      markdown: false,
      ignores: [
        '**/node_modules/**',
        '**/dist/**',
        '**/public/js/**',
        '**/*.d.ts',
        '**/*/strategy.ts',
        'playwright/**/*.ts',
        'scripts/**/*.ts',
      ],
      rules: {
        'no-console': 'off',
        'ts/no-this-alias': 'off',
        'no-empty-pattern': 'off',
        // Relax type-aware rules that produce false positives with pnpm workspace cross-package `as const` imports.
        // TypeScript's own tsc --noEmit has 0 errors; these rules cannot resolve literal types through workspace symlinks.
        'ts/no-unsafe-assignment': 'warn',
        'ts/no-unsafe-member-access': 'warn',
        'ts/no-unsafe-argument': 'warn',
        'ts/no-unsafe-return': 'warn',
        'ts/no-unsafe-call': 'warn',
        'no-restricted-imports': ['error', {
          patterns: [
            {
              group: ['@walnut/client', '@walnut/client/*'],
              message: '@walnut/client contains Vue composables and browser-only APIs (Web Crypto, DOM, IndexedDB). Do not import from NestJS server code.',
            },
            {
              group: ['@walnut/axios', '@walnut/axios/*'],
              message: '@walnut/axios is the frontend HTTP client (browser interceptors, cache, retry). Server should use @nestjs/axios or raw axios.',
            },
          ],
        }],
      },
    },
    {
      files: ['packages/config/**/*.ts'],
      rules: {
        'ts/strict-boolean-expressions': 'off',
      },
    },
    {
      files: ['**/*.ts'],
      plugins: {
        local: localRules,
      },
      rules: {
        'ts/consistent-type-imports': ['error', {
          prefer: 'type-imports',
          disallowTypeAnnotations: false,
          fixStyle: 'separate-type-imports',
        }],
        'local/sort-nestjs-decorators': 'error',
      },
    },
  )
}
