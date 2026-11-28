import type { OptionsConfig } from '@antfu/eslint-config'
import type { WalnutEslintConfig } from './base.ts'
import antfu from '@antfu/eslint-config'
import eslintConfigPrettier from 'eslint-config-prettier/flat'
// oxlint 的 ignores / rules 两段与 base 共用同一份真源（批次 5 的两段式接法）。
// 这里**刻意不带 `.ts` 扩展名**：本文件会进 apps/server 的 commonjs 类型程序，
// value import 带扩展名会报 TS5097（type-only import 不受限，所以上面那行可以带）。
import { buildOxlintIgnores, oxlintRules } from './base'
// 这个相对导入**刻意不写 `.ts` 扩展名**：本文件会被消费方的类型程序一起编译
// （`apps/server/tsconfig.json` 按 ADR 0012 是自包含的，没有开 `allowImportingTsExtensions`），
// 带扩展名会让 `@walnut/server` 的 types:check 直接报 TS5097。
// ESLint 经 jiti 加载本文件，扩展名推断由它负责 ⇒ 不带扩展名两边都能解析。
import { commentPolicyConfig } from './comment-rules'
import localRules from './nest-local-rules'
import { sortOwnershipConfig } from './sort-ownership'
import { turboEnvVarsConfig } from './turbo-env-vars'

/**
 * `walnut/data-scope/direct-repository` 的 selector 与提示语。
 *
 * 导出而不是只内联在配置里：`apps/server/eslint.config.ts` 的 libs 配置要追加动态 import
 * 禁令，而 flat config 里同一 rules key 后份整体覆盖前份 —— 那条配置必须把本 selector
 * 一起带上，否则 libs 里已有的显式 disable 会变成「未使用指令」，直连保护也会静默消失。
 */
export const DATA_SCOPE_DIRECT_REPOSITORY_SELECTOR =
  "CallExpression[callee.property.name='getRepository'][arguments.0.name=/^(SysUserEntity|SysLogOperateEntity|SysLogAuthEntity|AppMonitorUserEntity|SysDeletedEntity|AppDemoEntity|SysEmployeeEntity)$/]"

export const DATA_SCOPE_DIRECT_REPOSITORY_MESSAGE =
  '数据权限：已注册实体必须经 WalnutAdminCommonPgBaseRepository（common/repository）访问；系统通道请加 eslint-disable-next-line no-restricted-syntax 并写明理由。'

/**
 * NestJS 后端预设：apps/server。
 *
 * 生效方式：`apps/server/eslint.config.ts` → `export default nestConfig()`。
 * 注意 `typescript.tsconfigPath` 是**相对被 lint 的包根**解析的，所以这里写 `./tsconfig.json`。
 */
export default function nestConfig(options: OptionsConfig = {}): WalnutEslintConfig {
  // `ignores` 单独拆出来合并（oxlint 的全局 ignore 面与调用方的 ignores 并列，不能互相覆盖）
  const { ignores: userIgnores, ...restOptions } = options
  return antfu(
    {
      typescript: {
        tsconfigPath: './tsconfig.json',
      },
      jsonc: false,
      yaml: false,
      markdown: false,
      ignores: buildOxlintIgnores(userIgnores, [
        '**/node_modules/**',
        '**/dist/**',
        '**/public/js/**',
        // ambient 声明文件（.d.ts）豁免分层规则：它们只有类型声明、没有运行时 import，
        // 不产生可执行的依赖边。已知盲区：.d.ts 里的 type-only 跨层依赖不在机器守卫内
        // （tsc 只校验可解析、不校验方向），靠评审把关；当前 .d.ts 的内部 import 全部向下合法。
        // （根 `.oxlintrc.json` 的 ignorePatterns 也带 `**/*.d.ts`，两边同一口径。）
        '**/*.d.ts',
        // 这里曾有一条 `**/*/strategy.ts`（本意是豁免 passport 的 strategy 文件），但 passport
        // 的命名是 `*.strategy.ts`，该 pattern 实际只命中 `libs/const/src/app/strategy.ts`
        // （业务常量）与两个 vendored OAuth strategy —— 等于给分层守卫切出一块盲区。
        // 2026-10-31 移除；vendor 文件若报错，按 lint 结论最小修复，不再靠路径豁免。
        'scripts/**/*.ts',
      ]),
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
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['@walnut/client', '@walnut/client/*'],
                message:
                  '@walnut/client contains Vue composables and browser-only APIs (Web Crypto, DOM, IndexedDB). Do not import from NestJS server code.',
              },
              {
                group: ['@walnut/http', '@walnut/http/*'],
                message:
                  '@walnut/http is the frontend HTTP client (browser interceptors, cache, retry). Server should use @nestjs/axios or raw axios.',
              },
            ],
          },
        ],
      },
      ...restOptions,
      // 硬边界：格式的唯一真源是 oxfmt（根 `.oxfmtrc.json`），调用方也改不回去
      stylistic: false,
    },
    {
      files: ['**/*.ts'],
      plugins: {
        local: localRules,
      },
      rules: {
        // ── 双轨期刻意关闭（批次 5 · P3）────────────────────────────────────
        // 为什么：该规则的 autofix 在 NestJS 里是**运行时危险**的 —— 它会把「只在构造器
        // 签名里充当类型」的类改成 `import type`，而 `emitDecoratorMetadata` 依赖那个值
        // 引用生成 `design:paramtypes`；import 一被擦除，DI 要到启动时才炸
        // （Twenty 记录 3,814 处后直接禁用该规则）。本仓当前 tsconfig 开了
        // emitDecoratorMetadata，类型感知的规则实测不报 DI 的那个类；但 lint-staged 的
        // `eslint --fix` 是不可控入口，且 ESLint 没有「保留规则、只关 fix」的开关 ——
        // 按执行计划 §7.4 的最稳形态整条降级，比赌「配置永远这么写」安全。
        // 复盘条件：ADR 0007 的装饰器元数据纪律与 lint 边界合并后再议。
        'ts/consistent-type-imports': 'off',
        'local/sort-nestjs-decorators': 'error',
      },
    },
    // 三个预设共用的一段 —— 为什么单独成文件见 turbo-env-vars.ts 顶部。
    // 这里的相对导入同样**不写扩展名**（理由见文件头那段注释）。
    turboEnvVarsConfig(),
    // 注释里不许有 emoji（纯文字）—— 三个预设共用，理由见 comment-rules.ts 顶部
    commentPolicyConfig(),
    {
      // ── 数据权限：已注册实体必须经基类仓库访问（防直连绕过 scope）──────────────
      // 一期注册清单（apps/api/src/common/repository/data-scope.ts）里的实体，
      // 任何 `xxx.getRepository(SysUserEntity)` 形态的直连都绕过行级数据权限。
      // 系统通道（登录链 user.repo / 日志旁写 / 恢复器 / monitor 会话记账）确实
      // 需要直连，必须在该文件/该行显式 `eslint-disable-next-line no-restricted-syntax`
      // 并写明理由 —— 这是「显式 bypass + 审计」的静态落点，不允许静默新增。
      name: 'walnut/data-scope/direct-repository',
      files: ['**/*.ts'],
      ignores: ['**/common/repository/**'],
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            selector: DATA_SCOPE_DIRECT_REPOSITORY_SELECTOR,
            message: DATA_SCOPE_DIRECT_REPOSITORY_MESSAGE,
          },
        ],
      },
    },
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
    // ── oxlint 去重段 ── 把 oxlint 已覆盖的规则在 ESLint 侧关掉（只关规则、不摘插件注册）。
    // 位置固定：各包自己的配置之后、prettier 兜底之前（见 base.ts 顶部的两段式说明）。
    // apps/server/eslint.config.ts 在预设之后 `.append()` 的 libs 分层配置只剩
    // no-restricted-imports / no-restricted-syntax / 本地规则 —— 都不在 oxlint 的覆盖面里。
    ...oxlintRules,
    // ── 排序所有权 ── 语句级 import 排序归 oxfmt（根 `.oxfmtrc.json`）；具名 specifier /
    // export 语句的排序仍归 ESLint。本预设 `jsonc: false`，所以不生成 package.json 的
    // `jsonc/sort-keys` 段（未注册的插件不能出现在 rules 里）—— 见 sort-ownership.ts 顶部。
    ...sortOwnershipConfig({ packageJsonKeyOrder: false }),
    // 兜底：关掉任何漏网的格式化规则（必须最后，flat config 后份覆盖前份）。
    // 格式的唯一真源是 oxfmt（根 `.oxfmtrc.json`）。
    eslintConfigPrettier,
  )
}
