import type { DefaultTheme } from 'vitepress'
import type { SearchConfig } from 'vitepress-plugin-pagefind'
import { defineConfig } from 'vitepress'
import { chineseSearchOptimize } from 'vitepress-plugin-pagefind'

import versionInfo from '../../version.json'

const frontendContent = [
  {
    text: '介绍',
    link: '/content/frontend/introduction',
  },
  {
    text: '简化的项目配置',
    link: '/content/frontend/base/project',
  },
  {
    text: 'naive-ui',
    link: '/content/frontend/base/naive-ui',
  },
  {
    text: 'i18n',
    link: '/content/frontend/base/i18n',
  },
  {
    text: 'vite插件',
    link: '/content/frontend/base/plugin',
  },
  {
    text: '组件',
    link: '/content/frontend/component/',
  },
  {
    text: 'axios',
    link: '/content/frontend/base/axios',
  },
  {
    text: '图标icon',
    link: '/content/frontend/base/icon',
  },
  {
    text: '路由router',
    link: '/content/frontend/base/router',
  },
  {
    text: '第三方插件',
    link: '/content/frontend/base/vendor',
  },
  {
    text: 'hooks',
    link: '/content/frontend/base/hooks',
  },
  {
    text: 'google-analytics',
    link: '/content/frontend/features/ga',
  },
]

const backendContent = [
  {
    text: '介绍',
    link: '/content/backend/introduction',
  },
  {
    text: '跨域',
    link: '/content/backend/cors',
  },
  {
    text: '数据库设计',
    link: '/content/backend/mongodb',
  },
]

const nav: DefaultTheme.NavItem[] = [
  {
    text: '包含内容',
    activeMatch: '^/content/',
    items: [
      { text: '介绍', link: '/content/introduction' },
      { text: '架构', link: '/content/monorepo/' },
      { text: 'ADR', link: '/content/adr/' },
      { text: '行业调研', link: '/content/industry-research/' },
      { text: '前端', link: '/content/frontend/introduction' },
      { text: '后端', link: '/content/backend/introduction' },
      { text: '共享', link: '/content/shared/introduction' },
    ],
  },
  {
    text: '记录',
    activeMatch: '/record/',
    items: [
      { text: 'wsl', link: '/record/wsl' },
      { text: '日常记录', link: '/record/daily' },
      { text: '服务器记录', link: '/record/server' },
      { text: 'docker记录', link: '/record/docker' },
      { text: 'redis记录', link: '/record/redis' },
      { text: 'mongoDB记录', link: '/record/mongo' },
      { text: 'nginx记录', link: '/record/nginx' },
    ],
  },
  {
    text: '公告',
    items: [
      { text: '1.0.0', link: '/announcement/v1.0.0' },
    ],
  },
  {
    text: '支持',
    link: '/support',
  },
  {
    text: versionInfo.version,
    items: [
      {
        text: '更新日志',
        link: 'https://github.com/walnut-admin/walnut-admin-client/blob/main/changelog-latest.md',
      },
      { text: '参与贡献', link: 'https://github.com/walnut-admin' },
      { text: 'B站账号', link: 'https://space.bilibili.com/3546944343378671' },
      { text: '个人X账号', link: 'https://x.com/Martin971222' },
    ],
  },
]

const sidebar: DefaultTheme.Sidebar = {
  '/content/': [
    {
      text: '架构',
      items: [
        { text: 'Monorepo 架构与设计', link: '/content/monorepo/' },
        { text: 'TypeScript 配置', link: '/content/monorepo/typescript' },
        { text: 'ESLint 配置', link: '/content/monorepo/eslint' },
        { text: 'package.json & Scripts', link: '/content/monorepo/package-scripts' },
        { text: 'pnpm Catalog', link: '/content/monorepo/pnpm-catalog' },
        { text: 'Turbo', link: '/content/monorepo/turbo' },
        { text: 'Release & Changeset', link: '/content/monorepo/release-changeset' },
        { text: 'Git-cliff', link: '/content/monorepo/git-cliff' },
        { text: 'Knip 死代码检测', link: '/content/monorepo/knip' },
        { text: 'pnpm-workspace.yaml 详解', link: '/content/monorepo/pnpm-workspace-config' },
        { text: 'Syncpack 版本一致性', link: '/content/monorepo/syncpack' },
        { text: '环境变量加密管理', link: '/content/monorepo/env-management' },
        { text: '📋 架构待办事项', link: '/content/monorepo/architecture-todo' },
      ],
    },
    {
      text: '架构决策记录 (ADR)',
      items: [
        { text: 'ADR 索引', link: '/content/adr/' },
        { text: '0001 包命名', link: '/content/adr/0001-package-naming' },
        { text: '0002 双模式消费', link: '/content/adr/0002-dual-mode-consumption' },
        { text: '0003 无默认环境值', link: '/content/adr/0003-no-env-defaults' },
        { text: '0004 直接契约消费', link: '/content/adr/0004-direct-contract-consumption' },
        { text: '0005 JIT vs 构建', link: '/content/adr/0005-jit-vs-build' },
        { text: '0006 运行时 API 分离', link: '/content/adr/0006-runtime-api-separation' },
        { text: '0007 后端不参与 workspace', link: '/content/adr/0007-backend-libs-not-workspace' },
        { text: '0008 统一版本独立部署', link: '/content/adr/0008-unified-versioning-separate-deploy' },
        { text: '0009 CI 质量门禁', link: '/content/adr/0009-ci-quality-gates' },
        { text: '0010 不用 TS Project References', link: '/content/adr/0010-no-ts-project-references' },
        { text: '0011 依赖治理与发布', link: '/content/adr/0011-dependency-governance-release' },
        { text: '0012 前后端工具链分歧', link: '/content/adr/0012-toolchain-divergence' },
        { text: '0013 Barrel Export 策略', link: '/content/adr/0013-barrel-exports-policy' },
        { text: '0014 ESLint 配置策略', link: '/content/adr/0014-eslint-config-strategy' },
        { text: '0015 测试策略', link: '/content/adr/0015-testing-strategy' },
        { text: '0016 验证策略', link: '/content/adr/0016-validation-strategy' },
        { text: 'Zod vs class-validator 评估', link: '/content/adr/zod-evaluation' },
      ],
    },
    {
      text: '行业调研',
      items: [
        { text: '调研索引', link: '/content/industry-research/' },
        { text: 'TypeScript 配置策略', link: '/content/industry-research/01-typescript-configuration' },
        { text: 'ESLint 与代码质量', link: '/content/industry-research/02-eslint-configuration' },
        { text: 'CI/CD 流水线设计', link: '/content/industry-research/03-ci-cd-pipeline' },
        { text: '测试体系', link: '/content/industry-research/04-testing-strategy' },
        { text: 'Package Scripts 与 Turbo', link: '/content/industry-research/05-package-scripts' },
        { text: '版本管理与发布日志', link: '/content/industry-research/06-versioning-and-changelog' },
        { text: 'Vue3 + NestJS 全栈架构', link: '/content/industry-research/07-fullstack-architecture' },
      ],
    },
    {
      text: '前端',
      items: frontendContent,
    },
    {
      text: '后端',
      items: backendContent,
    },
    {
      text: '共享',
      items: [
        { text: '介绍', link: '/content/shared/introduction' },
        { text: '设备追踪', link: '/content/shared/device' },
        { text: 'Cap.js简易人机验证', link: '/content/shared/capjs' },
        { text: '接口签名安全防护', link: '/content/shared/sign' },
        { text: 'opaque认证', link: '/content/shared/opaque' },
      ],
    },
  ],

  '/record/': [
    {
      text: '记录',
      items: [
        { text: 'wsl', link: '/record/wsl' },
        { text: '日常记录', link: '/record/daily' },
        { text: '服务器记录', link: '/record/server' },
        { text: 'docker记录', link: '/record/docker' },
        { text: 'redis记录', link: '/record/redis' },
        { text: 'mongoDB记录', link: '/record/mongo' },
        { text: 'nginx记录', link: '/record/nginx' },
      ],
    },
  ],
}

export const search: { [key: string]: SearchConfig } = {
  root: {
    btnPlaceholder: '搜索',
    placeholder: '搜索文档',
    emptyText: '空空如也',
    heading: '共: {{searchResult}} 条结果',
    showDate: false,
    customSearchQuery: chineseSearchOptimize,
  },
}

export const zh = defineConfig({
  lang: 'zh-Hans',
  description: '核桃仁中后台全栈模板文档，仍在编写中。。。',

  themeConfig: {
    nav,
    sidebar,

    search: {
      provider: 'local',
    },

    editLink: {
      pattern: 'https://github.com/walnut-admin/walnut-admin-doc/tree/main/src/:path',
      text: '在 GitHub 上编辑此页面',
    },

    footer: {
      message: '基于 MIT 许可发布',
      copyright: `版权所有 © 2019-${new Date().getFullYear()} 赵成林`,
    },

    docFooter: {
      prev: '上一页',
      next: '下一页',
    },

    outline: {
      label: '页面导航',
    },

    lastUpdated: {
      text: '最后更新于',
      formatOptions: {
        dateStyle: 'short',
        timeStyle: 'medium',
      },
    },

    langMenuLabel: '多语言',
    returnToTopLabel: '回到顶部',
    sidebarMenuLabel: '菜单',
    darkModeSwitchLabel: '主题',
    lightModeSwitchTitle: '切换到浅色模式',
    darkModeSwitchTitle: '切换到深色模式',
  },
})
