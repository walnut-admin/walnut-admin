import type { KnipConfig } from 'knip'

/**
 * **`pnpm knip` 当前是红的，而且这是已知的、有意维持的状态**（2026-09-23 决策）。
 *
 * 它**不在任何门禁里**（prepush / CI / 发版电池都没有它）⇒ 不影响交付，但也意味着**没人会看到
 * 它的提示** —— 这个文件里的注释就是那些提示的落脚点。也因此这里**不写命中计数**：数会变，
 * 要看就跑 `pnpm knip`。
 *
 * 为什么不为了变绿而删：**本仓是模板项目，「未用导出」不等于死代码** —— 最典型的是
 * `apps/server/libs/decorators/src/transformer/**` 里那批 `WalnutAdminDecoratorTransform*`，
 * 它们正是**留给模板使用者按需取用**的装饰器 API 面，仓内没有消费者是正常的
 * （`sleep` / `TransformToSeconds` / `TransformToBytes` 同理）。按「有没有人 import」来删，
 * 等于把模板的能力删掉。
 *
 * 如果将来要接进门禁：**先分类再开闸** —— 用 `entry` / `includeEntryExports` 之类把「有意的
 * 公共面」显式标出来，只让真正的死代码亮红。不要直接删。
 *
 * ## `packages/**` 直到 2026-11-02 才真正进入分析面（批次 2 · R2）
 *
 * 在这之前 `packages/**` **几乎没有发现**（2026-11-02 实测只有 `packages/tooling/eslint-config` 的 4 条）——
 * 不是因为它干净，而是因为它**整块不在分析面里**：
 * workspace 只写了 `entry`，knip 于是只分析「entry 领进来的文件」，非 entry 的深层文件死了
 * 也没人报。现在五个共享包各补了两行（`project` + `includeEntryExports`），两行的分工见下面
 * workspace 配置里的注释。改前 / 改后的实测数据与每个探针的结果记在
 * apps/docs/src/zh-CN/content/monorepo/knip.md 的「共享包进入分析面」一节 —— 这里不抄数字
 * （数会变，要看就跑 `pnpm knip`）。
 *
 * ## 已知盲区：barrel 自身的死导出**没有稳定可见性**
 *
 * 2026-11-02 用同一份配置做过 A/B 探针（往包的 `src/index.ts` 各追加一行
 * `export const __PROBE = 1`，跑 `pnpm knip`，然后 `git checkout --` 还原）：
 *   · `packages/platform-web/http/src/index.ts` —— **报出来了**；
 *   · `packages/platform-any/contract/src/index.ts` —— **没报**（同一个开关、同一次运行）。
 *
 * 所以「barrel 里的死导出能不能看见」目前**因包而异**，原因未查清（contract 是唯一带
 * `packages/platform-any/contract/scripts/build-barrel.ts` 生成 barrel 的包，怀疑与 entry
 * 推导有关 —— 未验证）。
 * 结论只有一条可依赖的：**别把「barrel 已覆盖」当结论**。要守这一面只能另立一个
 * 「barrel 符号 0 引用」的专用脚本（读 `src/index.ts` 的具名导出 → 全仓 grep 消费方），
 * 调 knip 配置解决不了。在此之前，barrel 级死导出按**部分盲区**对待。
 *
 * ## 删桶之后的复测：噪音塌了，塌的是「一桶 N 行」那一类（批次 9 · C3）
 *
 * 批次 4 把 `packages/platform-web/{client,http}` 的 barrel 删掉、把
 * `packages/platform-any/utils-core` 的 barrel 收缩成两个模块之后，同一个命令的读数掉了**整整一档**，
 * 掉的那部分全是「barrel 里 re-export 了、但入口没人消费」的符号 —— **每个符号一行**。
 * 所以这一轮噪音的主因是**桶**，不是配置：`project` + `includeEntryExports` 只是把那批东西
 * **变可见**，删桶才是把它**变不见**。下次再看到读数暴涨，先查「是不是又多了个 barrel」。
 *
 * 复测之后「怎么看」按这三步（读数会变，判据不变）：
 *
 *   1. **先分段**：`packages/**` 与 `apps/**` 分开看 —— 前者是公共面问题，后者是模板 / 动态入口问题；
 *   2. **`packages/**` 逐条二分**（入口有没有消费）：
 *      `grep -rn "from '@walnut/<pkg>'" apps packages` = 0 ⇒ 它说的是「入口没人走」，**不是死代码**
 *      （消费方走的是深路径 `@walnut/<pkg>/<file>`）；**入口与深路径都 0 消费**才是真死候选；
 *   3. **`apps/**` 那一批是有意维持的，别删**：`libs/decorators` 的 transformer 是留给模板使用者的
 *      API 面；`apps/{cli,worker}/src/main.ts` 与 `apps/api/migrations/**` 是**被命令行执行**的入口 ——
 *      knip 只看 import 图，看不见「谁在命令行里跑它」。
 *
 * **不要**用 `ignoreIssues` 把它们抹绿：桶已经删了，剩下每一条都该能说出「它为什么还在」；
 * 抹掉等于把这一面重新变回盲区。真要进门禁，先按上面三步分类，只给「真死」开红。
 *
 * 逐条读数与归因**不写在这里**（数会变）：真要引用数字，就写明是哪天的 `pnpm knip` ——
 * 历史上那份带日期的记录已随 2026-11-04 收尾归档至 git 历史；
 * 要现读就跑 `pnpm knip`（人读）/ `pnpm knip --reporter json`（要精确路径 —— 文本报告会按终端宽度
 * 截断长路径）。
 */
const config: KnipConfig = {
  // ============================================================
  // Workspace 包入口
  //
  // 注意：Vue3 项目用了 unplugin-vue-components
  // 组件是自动注册的，knip 追踪不到这些隐式依赖。
  // 因此 apps/admin 的 components/ 排除在 unused files 检测之外。
  // （`unplugin-auto-import` 已于 2026-09-29 移除，隐式全局那一条不再成立。）
  // ============================================================
  workspaces: {
    // --- 前端 Vue3 应用 ---
    // vite: false：阻止 knip 的 vite 插件尝试 jiti 加载 vite.config.ts
    // （它依赖 loadEnv/回调执行，knip 无法安全执行）；entry 已手动指定。
    'apps/admin': {
      entry: [
        'src/main.ts',
        'src/router/index.ts',
        'src/router/routes/**/*.ts',
      ],
      project: ['src/**/*.{ts,vue}'],
      vite: false,
      ignore: [
        // 构建辅助脚本
        'build/**',
        // 以下目录的文件通过组件自动注册 / Pinia 动态注册 / barrel 聚合引用，
        // knip 追踪不到这些隐式 import 链 → 不应报告为 unused
        //
        // TODO: 这份清单是**移除 auto-import（2026-09-29）之前**按「自动导入」的理由列的；
        // 当时那些文件里确实有隐式全局。现在理由是「Pinia / barrel」，而 knip 本仓有意维持
        // 红色、没有门禁看着它 ⇒ 没人验证过收紧之后是否还有真实命中。要收紧就先跑 `pnpm knip`
        // 看这批目录里到底还剩什么，别直接删。
        'src/components/**',
        'src/composables/**',
        'src/hooks/**',
        'src/api/**',
        'src/store/**',
        'src/socket/**',
        // 类型 & 常量文件通常通过 barrel 或 ambient 引用
        'src/types/**',
        'src/const/**',
        'src/enums/**',
      ],
    },

    // --- 后端 NestJS 应用 ---
    'apps/server': {
      entry: ['apps/api/src/main.ts'],
      project: ['apps/**/*.ts', 'libs/**/*.ts'],
      ignore: [
        // NestJS 文件通过装饰器（@Module, @Controller, @Injectable）隐式组装
        '**/*.module.ts',
        '**/*.controller.ts',
        '**/*.service.ts',
        '**/*.dto.ts',
        '**/*.schema.ts',
        '**/*.guard.ts',
        '**/*.interceptor.ts',
        '**/*.pipe.ts',
        '**/*.filter.ts',
        '**/*.decorator.ts',
        '**/*.strategy.ts',
        '**/*.middleware.ts',
        // barrel exports（libs 通过 tsconfig paths 引用，不直接 import）
        'libs/*/src/index.ts',
        // 构建 & 测试配置
        'infra/**',
        '**/vitest.config.*.ts',
        '**/*.e2e-spec.ts',
        '**/test/**',
        '**/node-modules-inspector.config.ts',
      ],
    },

    // --- 文档站 ---
    'apps/docs': {
      entry: [
        '.vitepress/config/index.ts',
        '.vitepress/theme/index.ts',
      ],
      project: ['.vitepress/**/*.ts'],
      ignore: ['.vitepress/cache/**'],
    },

    // --- 共享包（严格检查 — 这里 knip 价值最大）---
    //
    // 每个包都比原来多两行，缺一不可（批次 2 的 R1 复核实测，逐条数据见
    // apps/docs/src/zh-CN/content/monorepo/knip.md）：
    //   · `project` —— 不写时 knip 只分析「entry 领进来的文件」，非 entry 的深层文件
    //     根本不在程序里，死了也不会有人报；
    //   · `includeEntryExports: true` —— **唯一**能让非 entry 文件的死导出现身的开关
    //     （实测：只加 `project` 或只删 `entry` 都是 0 变化，两行齐了才从 50 变 52）。
    //
    // 注意 `entry` **不要删**：knip 的 Configuration hints 里那 8 条
    // 「Remove redundant entry pattern」说的是「入口本来能从 package.json exports 推出来」，
    // 而实测删掉之后 knip 从 `exports` 推回来的还是同一个文件 —— 即「把 barrel 从 entry 摘出去」
    // 在物理上无法执行，摘了等于没摘（这才是 D18② 原先处方不可用的原因）。
    // 所以**barrel 自身的死导出依旧是盲区**：`src/index.ts` 是包入口，它的导出天然算
    // 「公共 API」。要查它只能另立一个「barrel 符号 0 引用」的专用脚本，knip 配置解决不了。
    'packages/platform-any/contract': {
      entry: ['src/index.ts'],
      project: ['src/**/*.ts'],
      includeEntryExports: true,
    },
    'packages/platform-any/utils-core': {
      entry: ['src/index.ts'],
      project: ['src/**/*.ts'],
      includeEntryExports: true,
    },
    'packages/platform-any/types': {
      entry: ['src/universal.d.ts', 'src/storage.d.ts', 'src/deep-ref.d.ts', 'src/object-key.d.ts'],
      project: ['src/**/*.ts'],
      includeEntryExports: true,
    },
    // client / http 的桶入口（`src/index.ts`）**已于 2026-11 批次 4 删除**（D8）：
    // 两个 barrel 共 75 个导出、全仓裸包名 import 站点 **0** 个，等于「公共 API 面」本身
    // 没有任何消费者 —— 之前 `entry: ['src/index.ts']` 会把这些导出全判成「公共 API」，
    // 于是 knip 一边报它们未用、一边说不出「谁该用」。
    //
    // 删桶之后**刻意不写 `entry`**：两个包的 `exports` 是 `./*` 子路径通配，按 knip 的
    // 推导规则「每个可被导入的文件都是入口」，这与事实一致（子路径就是公共面），也与
    // 上面 packages/tooling/* 的处理同口径。写回 `entry: ['src/index.ts']` 会立刻变成
    // 「指向不存在的文件」，那是配置错误而不是结论。
    'packages/platform-web/client': {
      project: ['src/**/*.ts'],
      includeEntryExports: true,
    },
    'packages/platform-web/http': {
      project: ['src/**/*.ts'],
      includeEntryExports: true,
    },
    // packages/tooling/* 刻意**不写 entry**：knip 能从 package.json 的 `exports`（预设/通用能力）
    // 与 `bin`（命令入口）自己推出入口文件。显式列一遍既是重复，也会随包结构变化而腐化 ——
    // knip 的 Configuration hints 一直在提示这一点，本轮按其建议删掉。
  },

  // ============================================================
  // 全局忽略
  // ============================================================
  ignore: [
    '**/dist/**',
    '**/.turbo/**',
    '**/node_modules/**',

    // 纯 JSON 的 tsconfig 预设包：没有源码、没有导入。knip 会把预设里的
    // `jsxImportSource: "vue"` 读成「未声明的依赖 vue」、把 `importHelpers: true` 读成
    // 「未解析的导入 tslib」—— 两者都是 tsconfig 选项，不是模块引用，属确定性误报。
    'packages/tooling/tsconfig/**',

    // 测试
    '**/*.test.ts',
    '**/*.spec.ts',
    '**/__tests__/**',
    '**/__mocks__/**',

    // 配置 & 构建
    '**/vite.config.ts',
    '**/vitest.config.ts',
    '**/vitest.*.config.ts',
    '**/playwright.config.ts',
    '**/eslint.config.*',
    '**/tsconfig*.json',

    // 脚本
    'scripts/**',
    '**/scripts/**',

    // 类型声明 & 生成
    '**/*.d.ts',
    '**/components.d.ts',

    // 环境 & 部署
    '**/env*/**',
    '**/env-*/**',
    '**/infra/**',
    '**/docker/**',
  ],

  // ============================================================
  // 以下**二进制**来自工具自身，不是任何依赖提供的（knip 会把它们报成 unlisted）
  // ============================================================
  ignoreBinaries: [
    // `pnpm change` 是 pnpm 12 的原生命令（发行版自带，不在 node_modules/.bin 里）。
    // 出现在根 `prepush` 脚本与 ci.yml 的 quality job 里（fixed 组锁步门禁）。
    'change',
  ],

  // ============================================================
  // 以下依赖 knip 会报告为 unused/missing，但实际上是需要的
  // ============================================================
  ignoreDependencies: [
    // --- 构建 & 编译器 ---
    '@swc/core',
    '@swc/cli',
    'unplugin-swc',
    'reflect-metadata',

    // --- ESLint 生态（通过 @antfu/eslint-config 间接引用） ---
    '@antfu/eslint-config',

    // --- NestJS CLI / 开发工具 ---
    '@nestjs/schematics',
    '@nestjs/cli',
    '@nestjs/testing',
    '@nestjs/swagger',
    '@compodoc/compodoc',

    // --- Admin: 通过 vue-codemirror / Pinia 等间接引用 ---
    'codemirror',
    '@codemirror/autocomplete',
    '@codemirror/commands',
    '@codemirror/lang-javascript',
    '@codemirror/lang-json',
    '@codemirror/merge',
    '@codemirror/search',
    '@codemirror/state',
    '@codemirror/theme-one-dark',
    '@codemirror/view',
    'vue-codemirror',
    '@fingerprintjs/fingerprintjs',
    '@serenity-kit/opaque',
    '@vueuse/router',
    'compare-versions',
    'detectincognitojs',
    'driver.js',
    'fflate',
    'idb',
    'js-base64',
    'socket.io-client',
    'superjson',

    // --- Server: 通过 NestJS DI / 运行时 require 间接引用 ---
    'hbs',
    'raw-body',
    'tencentcloud-sdk-nodejs',
    'csv-parse',

    // --- Vite 插件（在 vite.config.ts 中配置，knip 无法解析） ---
    '@vitejs/plugin-legacy',
    '@vitejs/plugin-vue',
    '@vitejs/plugin-vue-jsx',
    'vite-plugin-banner',
    'vite-plugin-bundle-obfuscator',
    'vite-plugin-cdn2',
    'vite-plugin-checker',
    'vite-plugin-compression2',
    'vite-plugin-csp-guard',
    'vite-plugin-devtools-json',
    'vite-plugin-image-optimizer',
    'vite-plugin-mkcert',
    'vite-plugin-restart',
    'vite-plugin-vue-devtools',
    'vite-bundle-analyzer',
    '@sentry/vite-plugin',
    'unplugin-vue-components',

    // --- Admin 构建辅助 ---
    '@iconify/json',
    '@iconify/tools',
    '@iconify/types',
    '@iconify/utils',
    '@unocss/preset-icons',
    '@unocss/transformer-variant-group',
    'chalk',
    'javascript-obfuscator',
    'mockjs',
    'sharp',
    'sharp-ico',
    'tinyglobby',
    'zod',

    // --- Docs 专用 ---
    '@mermaid-js/mermaid-mindmap',
    'segment',

    // --- 类型包 ---
    '@types/node',
    '@types/express',
    '@types/supertest',
    '@types/codemirror',
    '@types/intro.js',
    '@standard-schema/spec',

    // --- 测试工具 ---
    'supertest',
    'playwright',

    // --- Git hooks & 代码质量 ---
    // lefthook 只在 `pnpm install` 的 postinstall 与 .git/hooks 里被调用，源码不 import 它
    'lefthook',
    'lint-staged',
    'knip',

    // --- commitlint（通过 index.ts 的 extends 字符串引用，knip 追踪不到） ---
    '@commitlint/config-conventional',

    // --- 发版（git-cliff 走编程 API 调用，但平台二进制由它自己的 optionalDependencies 提供） ---
    'git-cliff',

    // --- Dev 工具链 ---
    'taze',
    'rimraf',
    'turbo',
    'madge',
    'concurrently',
    'cross-env',
    'nodemon',
    'vite-tsconfig-paths',

    // --- 工具链包在根 devDependencies 里的引用（都通过 bin 或 tsconfig extends 使用） ---
    '@walnut/eslint-config',
    '@walnut/commitlint-config',
    '@walnut/tsconfig',
    // 根 scripts 通过它们的 bin 调用：release / lint:workflows / setup-env / check-git-hooks
    '@walnut/scripts',
    '@walnut/release',
  ],
}

export default config
