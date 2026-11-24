/**
 * Turbo 环境变量声明检查（`turbo/no-undeclared-env-vars`）—— 三个预设共用的那一段。
 *
 * **为什么需要它**：Turbo 的**严格 env 模式**会把「没在 `env` / `globalEnv` / `passThroughEnv` /
 * `globalPassThroughEnv` 里声明过」的环境变量从任务进程里**剥掉**。被剥掉时**没有任何报错** ——
 * 只是那个变量在构建期变成 `undefined`，产物静默地少一块。参考仓上线这条规则时一次抓出 5 个真实缺口。
 *
 * 判据的唯一真源是根 `turbo.json`（插件自己按被 lint 文件的目录向上找），所以它同时守着
 * 「新增外部环境变量必须同步 turbo.json」这条纪律。
 *
 * 为什么单独成文件：`base` / `vue` / `nest` 三个预设各自直接调 `antfu(...)`（nest 不经过 base），
 * 所以共用的一段必须显式共享 —— 放在某一个预设里，另外两个就**静默没有这道检查**。
 */
import turbo from 'eslint-plugin-turbo'

/**
 * **框架编译期内建**：由打包器在编译期替换成字面量，既不来自进程环境、也不该进 turbo.json。
 * Vite 保证 `import.meta.env` 上恒有这几个（`MODE` 我们另外在 `build.env` 里声明过，故不在列）。
 * 实测：不豁免它们，`apps/admin/src/utils/constant/vue.ts` 的 `import.meta.env.DEV/PROD/SSR`
 * 会被报成「未声明」——规则同时匹配 `process.env.X` 与 `import.meta.env.X`。
 */
const FRAMEWORK_BUILTINS = ['DEV', 'PROD', 'SSR', 'BASE_URL']

/** 运行时环境自己注入的变量：声明进 turbo.json 没有意义，规则里豁免 */
const RUNTIME_INJECTED = [
  // npm / pnpm 在执行脚本时注入（`apps/server` 的 main.ts 读它）
  'npm_package_version',
  // npm 的配置面（代理 / registry 等），由包管理器注入
  'npm_config_*',
]

/**
 * **测试夹具**：用例自己 `process.env.X = …` 造出来的变量，用来验证「env 的克隆 / 净化」这类行为
 * （如 `WALNUT_TEST_MARKER`）。它们不是任何代码的依赖 —— 用例先设再断言，缺了也照样跑。
 * 所以只在测试文件里豁免，**不进 turbo.json**（把它写进全局清单会让那份清单失去「都是真依赖」的含义）。
 *
 * `DATABASE_NAME` —— server 集成测试（`apps/server/apps/api/test/integration/`）的
 * setup-env 把它写成集成库名 `walnut-admin-integration`，是夹具而不是外部依赖：
 * 正常运行时它由 `env-encrypted/.env.*` 提供（那一运行期配置面在 `nest.ts` 里对
 * `libs/config/src/modules` 整段豁免），声明进全局清单反而会让 shell 里偶发的同名
 * 变量压过 env 文件。`DATABASE_PG_NAME` 同理（PG 集成库，Phase 3 PG 迁移起同款用法）。
 */
const TEST_FIXTURES = [
  // worker standalone 的分支测试（schedule.composition.spec）：spec 自己 set env 验证让位/静默两分支
  'WORKER_STANDALONE',
  'WALNUT_TEST_MARKER',
  'DATABASE_NAME',
  'DATABASE_PG_NAME',
]

const TEST_FILE_GLOBS = [
  '**/__tests__/**/*.{ts,tsx}',
  '**/*.test.{ts,tsx}',
  '**/*.spec.{ts,tsx}',
  // integration 测试基建整段（含 vitest 的 setupFiles，如 server 的
  // `apps/api/test/integration/helpers/setup-env.ts` —— 不是 .test/.spec 命名，
  // 但性质同样是「测试自己写 env」的夹具代码）
  '**/test/integration/**',
]

export function turboEnvVarsConfig() {
  // 返回**可变元组**：`as const` 会得到 `readonly [...]`，而 flat config 的 `RuleEntry` 要求可变元组
  // —— 实测会报 TS2345（`readonly` is not assignable to the mutable type）。
  const rule = (allow: string[]): ['error', { allowList: string[] }] => ['error', { allowList: allow }]
  return [
    {
      name: 'walnut/turbo-env-vars',
      plugins: { turbo },
      rules: {
        'turbo/no-undeclared-env-vars': rule([...RUNTIME_INJECTED, ...FRAMEWORK_BUILTINS]),
      },
    },
    {
      // 测试文件放宽：用例里的 env 是夹具不是依赖（理由见 TEST_FIXTURES）。
      // 放在后面 = 优先级更高，只覆盖测试文件。
      name: 'walnut/turbo-env-vars/tests',
      files: TEST_FILE_GLOBS,
      plugins: { turbo },
      rules: {
        'turbo/no-undeclared-env-vars': rule([...RUNTIME_INJECTED, ...FRAMEWORK_BUILTINS, ...TEST_FIXTURES]),
      },
    },
  ]
}
