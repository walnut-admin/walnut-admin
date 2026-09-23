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
  // 「后端规范」一簇：原 apps/server/AGENTS.md 的参考部分（2026-09-23 拆分）。
  // 每篇都在 AGENTS.md 的「先看哪份」表里有对应的 repo 相对路径。
  {
    text: '架构与模块结构',
    link: '/content/backend/architecture',
  },
  {
    text: 'DTO 与装饰器',
    link: '/content/backend/dto',
  },
  {
    text: 'MongoDB 事务',
    link: '/content/backend/transactions',
  },
  {
    text: '环境配置',
    link: '/content/backend/configuration',
  },
  {
    text: '代码风格',
    link: '/content/backend/code-style',
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
      { text: '归档', link: '/content/archive/' },
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
  // 组件文档：`/component/**` 是与 `/content/` **并列的另一棵树**，不共享 sidebar 键。
  // 此前它没有任何 sidebar 条目 ⇒ 42 篇真实组件文档只能手敲 URL 才看得到（违反本站
  // 「新增页面必须登记进 sidebar，否则页面不可达」的规矩）。见架构待办 F9。
  '/component/': [
    {
      text: '组件文档',
      items: [
        {
          text: 'Advanced —— 通用高级组件',
          collapsed: true,
          items: [
            { text: 'ApiSelect', link: '/component/Advanced/apiSelect' },
            { text: 'AreaCascader', link: '/component/Advanced/areaCascader' },
            { text: 'LocaleSelect', link: '/component/Advanced/localeSelect' },
          ],
        },
        {
          text: 'App —— 应用级全局组件',
          collapsed: true,
          items: [
            { text: '权限组件', link: '/component/App/authorize' },
            { text: '暗色模式', link: '/component/App/darkmode' },
            { text: '全屏组件', link: '/component/App/fullscreen' },
            { text: '国际化组件', link: '/component/App/localepicker' },
            { text: 'lock', link: '/component/App/lock' },
            { text: 'settings', link: '/component/App/settings' },
          ],
        },
        {
          text: 'Extra —— 通用辅助组件',
          collapsed: true,
          items: [
            { text: 'JSON 显示', link: '/component/Extra/JSON' },
            { text: '箭头', link: '/component/Extra/arrow' },
            { text: '翻转卡片', link: '/component/Extra/flipper' },
            { text: '图标选择器', link: '/component/Extra/iconPicker' },
            { text: '提示消息', link: '/component/Extra/message' },
            { text: '滚动条', link: '/component/Extra/scrollbar' },
            { text: '通用标题', link: '/component/Extra/title' },
            { text: '过渡', link: '/component/Extra/transition' },
            { text: '过渡下拉框', link: '/component/Extra/transitionSelect' },
          ],
        },
        {
          text: 'HOC —— 高阶组件',
          collapsed: true,
          items: [
            { text: 'WithValue', link: '/component/HOC/withValue' },
          ],
        },
        {
          text: 'UI —— 原子化基础组件',
          collapsed: true,
          items: [
            { text: '按钮', link: '/component/UI/button' },
            { text: '卡片', link: '/component/UI/card' },
            { text: '多选框（组）', link: '/component/UI/checkbox' },
            { text: '颜色选择器', link: '/component/UI/colorPicker' },
            { text: '日期选择器', link: '/component/UI/datePicker' },
            { text: '描述', link: '/component/UI/descriptions' },
            { text: '抽屉组件', link: '/component/UI/drawer' },
            { text: '下拉菜单组件', link: '/component/UI/dropdown' },
            { text: '动态标签组件', link: '/component/UI/dynamicTags' },
            { text: '图标', link: '/component/UI/icon' },
            { text: '图标按钮组件', link: '/component/UI/iconButton' },
            { text: '输入框组件', link: '/component/UI/input' },
            { text: '模态框组件', link: '/component/UI/modal' },
            { text: '单选框（组）', link: '/component/UI/radio' },
            { text: '下拉框', link: '/component/UI/select' },
          ],
        },
        {
          text: 'Vendor —— 第三方依赖组件',
          collapsed: true,
          items: [
            { text: '头像裁剪上传', link: '/component/Vendor/AvatarUpload' },
            { text: '代码编辑器', link: '/component/Vendor/CodeMirror' },
            { text: '图片裁剪', link: '/component/Vendor/Cropper' },
            { text: '图表', link: '/component/Vendor/Echarts' },
            { text: '坐标选择器(TODO)', link: '/component/Vendor/LocationPicker' },
            { text: '前端文件直传阿里 OSS', link: '/component/Vendor/OSSUpload' },
            { text: '签名板', link: '/component/Vendor/SignPad' },
            { text: '富文本编辑器', link: '/component/Vendor/Tinymce' },
          ],
        },
      ],
    },
  ],
  '/content/': [
    {
      text: '架构',
      items: [
        { text: 'Monorepo 架构与设计', link: '/content/monorepo/' },
        { text: '📍 架构地图（先看这个）', link: '/content/monorepo/architecture' },
        { text: '术语表', link: '/content/monorepo/glossary' },
        { text: 'TypeScript 配置', link: '/content/monorepo/typescript' },
        { text: 'ESLint 配置', link: '/content/monorepo/eslint' },
        { text: 'package.json & Scripts', link: '/content/monorepo/package-scripts' },
        { text: 'pnpm Catalog', link: '/content/monorepo/pnpm-catalog' },
        { text: 'Turbo', link: '/content/monorepo/turbo' },
        { text: '🧊 Turbo 缓存边界（实测判据表）', link: '/content/monorepo/turbo-cache-boundary' },
        { text: '🔍 与参考仓 Z 的基建交叉对比', link: '/content/monorepo/reference-repo-comparison' },
        { text: '📦 发布 & 发版指南', link: '/content/monorepo/release' },
        { text: '🚀 CI/CD 与容器构建', link: '/content/monorepo/ci-cd' },
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
        { text: '0017 包重组', link: '/content/adr/0017-package-reorganization' },
        { text: '0018 Git 钩子迁 lefthook', link: '/content/adr/0018-git-hooks-lefthook' },
        { text: '0019 tsconfig 预设与无 .mjs', link: '/content/adr/0019-tsconfig-presets-and-no-mjs' },
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
      text: '归档（设计 / 计划 / 评审）',
      items: [
        { text: '归档说明与索引', link: '/content/archive/' },
        { text: '2026-08-08 全容器化部署设计', link: '/content/archive/2026-08-08-dockerized-deployment-design' },
        { text: '2026-08-08 全容器化部署实施计划', link: '/content/archive/2026-08-08-dockerized-deployment-plan' },
        { text: '2026-09-21 CI/CD 重构实施记录', link: '/content/archive/2026-09-21-ci-cd-pipeline-plan' },
        { text: '2026-09-21 架构 Review', link: '/content/archive/2026-09-21-architecture-review' },
        { text: '2026-09-21 行业调研审计', link: '/content/archive/2026-09-21-industry-research-audit' },
        { text: '2026-09-21 pnpm 12 迁移计划', link: '/content/archive/2026-09-21-pnpm12-and-hoist-migration-plan' },
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
