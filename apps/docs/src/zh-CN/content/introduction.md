# 简介

## Walnut Admin 是什么

Walnut Admin 是一个**全栈 TypeScript monorepo**，采用 Turborepo + pnpm workspaces 管理多包，提供开箱即用的企业级中后台解决方案。

项目涵盖三个应用和五个共享包：

| 应用 | 技术栈 | 说明 |
|------|--------|------|
| `apps/admin` | Vue 3 + Vite 8 + Naive UI + UnoCSS | 前端 SPA，含二次封装组件、动态菜单、权限校验、按钮级权限控制 |
| `apps/server` | NestJS 11 + MongoDB + Redis + SWC | 后端 API，含 JWT/OAuth/WebAuthn/MFA 多层认证、18 个守卫 |
| `apps/docs` | VitePress | 本文档站 |

| 共享包 | 说明 |
|--------|------|
| `@walnut/contract` | 前后端共享类型、DTO、枚举、API 契约 |
| `@walnut/utils` | 纯函数工具（regex、queue、crypto） |
| `@walnut/client` | 浏览器工具 + Vue composables |
| `@walnut/axios` | HTTP 客户端框架（instance + adapters） |
| `@walnut/eslint-config` | 共享 ESLint 预设（vue / nest / base） |

## 架构文档

项目采用分层的架构文档体系：

- **[架构](./monorepo/)** — TypeScript 配置、ESLint、pnpm Catalog、Turbo、Release、Knip 等 10 篇专题
- **[ADR](./adr/)** — 16 条架构决策记录，覆盖包命名、工具链、测试、验证等
- **[行业调研](./industry-research/)** — 业界主流 monorepo 实践与 Walnut Admin 的差异分析

## 所需知识

### 前端

- [Vue 3](https://vuejs.org/) — 组合式 API + `<script setup>`
- [Vite](https://vitejs.dev/) — 构建工具
- [TypeScript](https://www.typescriptlang.org/) — 类型系统
- [Naive UI](https://www.naiveui.com/) — 组件库
- [UnoCSS](https://unocss.dev/) — 原子化 CSS
- [Vue Router](https://router.vuejs.org/) — 路由
- [Pinia](https://pinia.vuejs.org/) — 状态管理
- [Vue I18n](https://vue-i18n.intlify.dev/) — 国际化

### 后端

- [NestJS](https://nestjs.com/) — 服务端框架
- [MongoDB](https://www.mongodb.com/) + [Mongoose](https://mongoosejs.com/) — 数据库
- [Redis](https://redis.io/) — 缓存 + 队列
- [SWC](https://swc.rs/) — 编译器

### 工程化

- [pnpm](https://pnpm.io/) — 包管理（workspace + catalog）
- [Turborepo](https://turbo.build/repo/docs) — 任务编排
- [ESLint](https://eslint.org/) — 代码检查（flat config）
- [Changesets](https://github.com/changesets/changesets) — 版本管理
- [git-cliff](https://git-cliff.org/) — 变更日志

## 仓库地址

- [walnut-admin](https://github.com/walnut-admin/walnut-admin) — monorepo 主仓库
- [在线演示](https://www.walnut-admin.com/)
- [文档站](https://walnut-admin-doc.netlify.app/)

## 参与贡献

- [Discord 讨论](https://discord.gg/kfVuasVXs2)
- [GitHub Discussions](https://github.com/orgs/walnut-admin/discussions)

项目持续更新中，欢迎提交 PR 和建议。
