import type { KnipConfig } from 'knip'

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
    // Vite 插件设为 false：vite.config.ts 在模块顶层调用 JSON.parse(env)，
    // knip 的 jiti 加载器无法执行它（env 未定义 → JSON.parse(undefined) 抛异常）。
    // 改为手动指定 entry，效果一样。
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
    'packages/tooling/eslint-config': {
      entry: ['base.mjs', 'vue.mjs', 'nest.mjs', 'nest-local-rules.mjs'],
    },
  },

  // ============================================================
  // 路径别名：knip 不读 vite.config.ts，需手动告知路径映射
  // ============================================================
  paths: {
    '~build/package': ['./apps/admin/build/package.ts'],
    '~build/time': ['./apps/admin/build/time.ts'],
  },

  // ============================================================
  // 全局忽略
  // ============================================================
  ignore: [
    '**/dist/**',
    '**/.turbo/**',
    '**/node_modules/**',

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
    '**/migration-guide/**',
    '**/docker/**',
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
    'ts-loader',

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
    '@types/jest',
    '@types/supertest',
    '@types/codemirror',
    '@types/intro.js',
    '@standard-schema/spec',

    // --- 测试工具 ---
    'supertest',
    'playwright',

    // --- Git hooks & 代码质量 ---
    'simple-git-hooks',
    'lint-staged',
    'knip',

    // --- 版本 & 发布 ---
    '@changesets/cli',
    'git-cliff',
    'deploy-cli-service',

    // --- Dev 工具链 ---
    'taze',
    'rimraf',
    'tsx',
    'turbo',
    'madge',
    'concurrently',
    'cross-env',
    'nodemon',
    'ts-node',
    'ts-jest',
    'jest',
    'tsconfig-paths',
    'vite-tsconfig-paths',

    // --- ESLint config 包在 devDependencies 中的引用 ---
    '@walnut/eslint-config',
  ],
}

export default config
