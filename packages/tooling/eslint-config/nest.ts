import type { OptionsConfig } from '@antfu/eslint-config'
import type { WalnutEslintConfig } from './base.ts'
import antfu from '@antfu/eslint-config'
// ⚠️ 这个相对导入**刻意不写 `.ts` 扩展名**：本文件会被消费方的类型程序一起编译
// （`apps/server/tsconfig.json` 按 ADR 0012 是自包含的，没有开 `allowImportingTsExtensions`），
// 带扩展名会让 `@walnut/server` 的 types:check 直接报 TS5097。
// ESLint 经 jiti 加载本文件，扩展名推断由它负责 ⇒ 不带扩展名两边都能解析。
import localRules from './nest-local-rules'
import { turboEnvVarsConfig } from './turbo-env-vars'

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
    // 三个预设共用的一段 —— 为什么单独成文件见 turbo-env-vars.ts 顶部。
    // ⚠️ 这里的相对导入同样**不写扩展名**（理由见文件头那段注释）。
    turboEnvVarsConfig(),
    {
      // ── 运行期配置模块：豁免 Turbo 的 env 声明检查 ────────────────────────────────
      // `libs/config/src/modules/*.config.ts` 是 `@nestjs/config` 的 `registerAs` 工厂，
      // 读的是**磁盘上的 `env-local/.env.*` 文件**（由 `pnpm setup-env` 解密而来），
      // `ConfigModule` 在**进程内**把这些值灌进 `process.env` —— 不是从外部进程环境传进来的。
      //
      // 所以把它们声明进 `turbo.json` 的 `globalPassThroughEnv` 是**语义错误**：那份清单的含义是
      // 「外部传给 turbo 任务、必须放行（或必须进哈希）的变量」。这里的 ~70 个是应用的运行期配置面，
      // 已经由 `env-encrypted/.env.*` 的注释模板 + `docs` 的后端配置页各自记了一份。
      //
      // 反过来说：在 turbo 下跑这些文件时，它们本来就不该读外部环境 —— 严格模式把偶发的同名 shell
      // 变量剥掉，反而让「测试结果只取决于 .env 文件」这件事成立。这与规则想拦的
      // 「构建期输入静默丢失」是两回事。
      //
      // 判据（2026-09-23 实测）：全仓 `process.env.*` 共 75 个不同变量名，其中 74 处集中在这个目录；
      // 剩下的（`npm_execpath` / `PATH` / `GITHUB_API_URL` / `GH_TOKEN` 等真依赖）都已在
      // turbo.json 里声明 —— 也就是说这份豁免**只**盖住了运行期配置面，没有盖住真缺口。
      name: 'walnut/turbo-env-vars/server-runtime-config',
      files: ['**/libs/config/src/modules/**/*.ts'],
      rules: {
        'turbo/no-undeclared-env-vars': 'off',
      },
    },
  )
}
