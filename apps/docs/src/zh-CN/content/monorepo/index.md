# Monorepo 架构与设计

> **这个仓长什么样、东西该放哪** → 先看 [**架构地图**](./architecture.md)，那里有仓库全景、
> 共享包依赖图，以及一张「**我要加 X，该放哪**」的判据表。
>
> 本页只是这一节的目录。

## 从这里开始

| 你想知道 | 去哪 |
|---------|------|
| 仓库形态、包分组、**新东西该放哪**、新增门禁怎么接线 | [架构地图](./architecture.md) |
| 还剩哪些架构 / 工程债没还 | [架构待办](./architecture-todo.md)（P2 / P3 / 搁置 / 未裁决） |
| 还剩哪些**产品 / 功能**没做 | 仓库根的 [`TODO.md`](https://github.com/walnut-admin/walnut-admin/blob/main/TODO.md) |
| 某条设计**为什么**是这样 | [ADR 索引](../adr/index.md)（含已否决的决策） |

> 两本账**刻意分开**：本节的待办记的是**工程债**（每条都能写出一条机械判据 —— 门禁 / 测试 / 脚本），
> 根 `TODO.md` 记的是**产品取舍**。别把产品功能塞进架构待办，也别把门禁缺口塞进根 `TODO.md`。

## 专题文档

| 文档 | 主题 |
|------|------|
| [架构地图](./architecture.md) | 仓库全景、双层级 monorepo、共享包依赖图、「我要加 X 该放哪」 |
| [TypeScript 配置](./typescript.md) | `@walnut/tsconfig` 三预设（base / ts / vue）、server 不继承任何预设、不用 Project References |
| [ESLint 配置](./eslint.md) | Flat config、`@walnut/eslint-config` 三预设、pre-commit / pre-push 门禁 |
| [package.json & Scripts](./package-scripts.md) | 标准 script 约定、根只做委托、按包类型差异化 |
| [pnpm Catalog](./pnpm-catalog.md) | `catalogMode: strict`、精确版本锁死、`workspace:*` vs `catalog:` |
| [pnpm-workspace.yaml 详解](./pnpm-workspace-config.md) | workspace 声明、`versioning` 段、hoisting 与供应链防护 |
| [Turbo](./turbo.md) | 任务拓扑编排、缓存策略、环境变量感知、Tag-Based 架构边界 |
| [Syncpack 版本一致性](./syncpack.md) | 依赖版本一致性检测 |
| [发布 & 发版指南](./release.md) | 单一 fixed 版本策略、`pnpm change` / `pnpm version -r` 消费意图、git-cliff 渲染、发版实操 |
| [CI/CD 与容器构建](./ci-cd.md) | 触发矩阵（commit 只跑门禁 / tag 才构建镜像）、薄镜像与 buildx 缓存 scope、两条硬约束 |
| [Knip 死代码检测](./knip.md) | 死代码检测、配置设计、已知局限、日常维护 |
| [环境变量加密管理](./env-management.md) | dotenvx 加密方案、多环境密钥、新成员入职流程 |
| [架构待办事项](./architecture-todo.md) | 未完成的架构 / 工程债 |

## 相关

- [ADR 索引](../adr/index.md) ｜ [归档：设计 / 计划 / 评审](../archive/index.md) ｜ [行业调研](../industry-research/03-ci-cd-pipeline.md)
