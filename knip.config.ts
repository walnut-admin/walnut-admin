import type { KnipConfig } from 'knip'

/**
 * ⚠️ **`pnpm knip` 当前是红的，而且这是已知的、有意维持的状态**（2026-09-23 决策）。
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
 */
const config: KnipConfig = {
  // ============================================================
  // Workspace 包入口
  //
  // 注意：Vue3 项目用了 unplugin-auto-import + unplugin-vue-components
  // 组件和 composable 是自动注册的，knip 追踪不到这些隐式依赖。
  // 因此 apps/admin 的 components/ 排除在 unused files 检测之外。
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
        // 以下目录的文件通过 auto-import / Pinia 动态注册 / barrel 聚合引用，
        // knip 追踪不到这些隐式 import 链 → 不应报告为 unused
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
    'packages/platform-any/contract': {
      entry: ['src/index.ts'],
    },
    'packages/platform-any/utils-core': {
      entry: ['src/index.ts'],
    },
    'packages/platform-any/types': {
      entry: ['src/universal.d.ts', 'src/storage.d.ts', 'src/deep-ref.d.ts', 'src/object-key.d.ts'],
    },
    'packages/platform-web/client': {
      entry: ['src/index.ts'],
    },
    'packages/platform-web/http': {
      entry: ['src/index.ts'],
    },
    // ⚠️ packages/tooling/* 刻意**不写 entry**：knip 能从 package.json 的 `exports`（预设/通用能力）
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
    '**/auto-imports.d.ts',
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

    // --- Admin: 通过 vue-codemirror / Pinia / auto-import 等间接引用 ---
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
    'unplugin-auto-import',
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
