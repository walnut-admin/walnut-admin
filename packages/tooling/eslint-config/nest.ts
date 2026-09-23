import type { OptionsConfig } from '@antfu/eslint-config'
import type { WalnutEslintConfig } from './base.ts'
import antfu from '@antfu/eslint-config'
// ⚠️ 这个相对导入**刻意不写 `.ts` 扩展名**：本文件会被消费方的类型程序一起编译
// （`apps/server/tsconfig.json` 按 ADR 0012 是自包含的，没有开 `allowImportingTsExtensions`），
// 带扩展名会让 `@walnut/server` 的 types:check 直接报 TS5097。
// ESLint 经 jiti 加载本文件，扩展名推断由它负责 ⇒ 不带扩展名两边都能解析。
import localRules from './nest-local-rules'

/**
 * NestJS 后端预设：apps/server。
 *
 * 生效方式：`apps/server/eslint.config.ts` → `export default nestConfig()`。
 * 注意 `typescript.tsconfigPath` 是**相对被 lint 的包根**解析的，所以这里写 `./tsconfig.json`。
 */
export default function nestConfig(options: OptionsConfig = {}): WalnutEslintConfig {
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
              group: ['@walnut/http', '@walnut/http/*'],
              message: '@walnut/http is the frontend HTTP client (browser interceptors, cache, retry). Server should use @nestjs/axios or raw axios.',
            },
          ],
        }],
      },
      ...options,
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
