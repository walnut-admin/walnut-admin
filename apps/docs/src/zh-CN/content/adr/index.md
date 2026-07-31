# 架构决策记录 (ADR)

## 概述

ADR（Architecture Decision Record）记录 Walnut Admin monorepo 项目中的关键架构决策。每一条 ADR 包含：决策背景（Context）、决策内容（Decision）、以及后果（Consequences）。

当前共 17 条 ADR，涵盖包命名、TypeScript 配置、依赖治理、发布流水线、测试策略、验证策略、包重组等领域。

## ADR 列表

| ADR | 决策 | 状态 |
|-----|------|------|
| [0001](./0001-package-naming.md) | 包命名——诚实命名，不用 "shared" / "core" | ✅ 已实现 |
| [0002](./0002-dual-mode-consumption.md) | 双模式消费——`"source"` 给 Vite，CJS 构建给后端 | ✅ 已实现 |
| [0003](./0003-no-env-defaults.md) | 共享包不做环境变量默认值 | ✅ 已实现 |
| [0004](./0004-direct-contract-consumption.md) | 直接 import `@walnut/contract`，不加包装层 | ✅ 已实现 |
| [0005](./0005-jit-vs-build.md) | 前端 only 包 JIT（源码），共享包构建 CJS | ✅ 已实现 |
| [0006](./0006-runtime-api-separation.md) | 按运行时 API 依赖分层 | ✅ 已实现 |
| [0007](./0007-backend-libs-not-workspace.md) | 后端 libs 保留为 NestJS CLI 内部 monorepo | ✅ 已实现 |
| [0008](./0008-unified-versioning-separate-deploy.md) | 统一版本号，独立部署 | ⚠️ deploy.yml 待更新 |
| [0009](./0009-ci-quality-gates.md) | 三级质量门禁：commit → push → CI | ⚠️ 测试和 CI 待完善 |
| [0010](./0010-no-ts-project-references.md) | 不用 TypeScript Project References | ✅ 已实现 |
| [0011](./0011-dependency-governance-release.md) | `catalogMode: strict`、changesets + git-cliff 发布 | ✅ 已实现 |
| [0012](./0012-toolchain-divergence.md) | 前后端工具链分歧（tsconfig 独立、env 加载、hoisting、边界） | ✅ 已实现 |
| [0013](./0013-barrel-exports-policy.md) | Barrel export 策略——选择性 barrel，不用 `export *` | ✅ 已实现 |
| [0014](./0014-eslint-config-strategy.md) | ESLint 配置策略——共享 config 包 + 三预设 | ✅ 已实现 |
| [0015](./0015-testing-strategy.md) | 测试策略——Vitest 统一、co-located、分层覆盖率 | ✅ 已接受 |
| [0016](./0016-validation-strategy.md) | 验证策略——保持 class-validator，暂不迁移 Zod | ✅ 已接受 |
| [0017](./0017-package-reorganization.md) | Package 重组——多维标签 + 目录分组 + 新增包规划 | 📋 Proposed |

## 补充文档

- [Zod vs class-validator 评估](./zod-evaluation.md) — 技术对比评估，记录为何暂不迁移 Zod
