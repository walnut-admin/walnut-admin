# 行业调研

## 概述

本目录收集了大型 TypeScript monorepo 项目的主流架构实践，作为 Walnut Admin 架构设计和决策的参考资料。

每篇调研文档覆盖一个主题，包含：业界共识（主流做法）、Walnut Admin 的做法对比、差异分析。

## 调研文档

| 文档 | 主题 |
|------|------|
| [TypeScript 配置策略](./01-typescript-configuration.md) | tsconfig 分层、Project References 决策、异构工具链 |
| [ESLint 与代码质量](./02-eslint-configuration.md) | Flat config、共享 config 包、oxlint/biome、Git Hooks |
| [CI/CD 流水线设计](./03-ci-cd-pipeline.md) | GitHub Actions、Turbo 远程缓存、affected-only、Docker |
| [测试体系](./04-testing-strategy.md) | Vitest 统一、分层策略、覆盖率、E2E |
| [Package Scripts 与 Turbo](./05-package-scripts.md) | 标准 scripts 约定、turbo.json 编排、缓存优化 |
| [版本管理与发布日志](./06-versioning-and-changelog.md) | Changesets 工作流、fixed vs independent、CI 自动化 |
| [Vue3 + NestJS 全栈架构](./07-fullstack-architecture.md) | 共享类型、Zod 验证、API 通信、安全 |

## 主要参考来源

| 来源 | 说明 |
|------|------|
| [Turborepo 官方文档](https://turbo.build/repo/docs) | 任务编排、缓存策略、remote cache |
| [pnpm 官方文档](https://pnpm.io/) | workspace 协议、catalog 协议、hoisting 策略 |
| [Changesets 官方文档](https://github.com/changesets/changesets) | 版本管理、changelog 生成、CI 集成 |
| [ESLint 官方文档](https://eslint.org/docs/latest/use/configure/) | Flat config 迁移、shareable configs |
| [Vitest 官方文档](https://vitest.dev/) | 配置、workspace 模式、覆盖率 |
| [Astro 仓库](https://github.com/withastro/astro) | 大型 pnpm monorepo + changesets 实践 |
| [tRPC 仓库](https://github.com/trpc/trpc) | 前后端类型共享、vitest 配置 |
