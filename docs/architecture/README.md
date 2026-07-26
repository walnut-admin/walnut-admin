# Walnut Admin Monorepo 架构文档

> 本目录是 Walnut Admin monorepo 的**权威架构文档**。所有论断均附实测证据（文件路径、行号、grep 计数、字节数），数据采集时间：2026-07-26。

---

## 这是什么

本目录记录 Walnut Admin monorepo **当前的架构状态、存在的问题、以及推荐的改造方案**。

它解决一个具体问题：仓库经历了「三个独立仓库（client / server / doc）→ 物理合并成 monorepo」的迁移，但合并后存在一系列**底层架构层面的隐患**（命名空间冲突、空壳包、tsconfig 碎片化、缺失契约层、坏掉的 CI）。这些隐患不影响日常开发能跑起来，但会在未来某个时刻静默炸掉。

本文档的目标是：把所有隐患讲清楚，并给出**精确到文件、行号、命令的改造手册**，让任何人（包括未来的你、或额度重置后的 AI）都能照着改。

---

## 文档索引

| 文件 | 主题 | 回答什么问题 |
|------|------|--------------|
| [01-overview.md](./01-overview.md) | 现状全景 | 这个仓库现在长什么样？有哪些 app 和 package？它们互相依赖吗？ |
| [02-workspace-layout.md](./02-workspace-layout.md) | 物理布局与成员职责 | 每个 app/package 的边界是什么？哪些是真实包、哪些是空壳？ |
| [03-package-boundaries.md](./03-package-boundaries.md) | 依赖方向与命名空间策略 | `@walnut/*` 命名空间为什么是定时炸弹？应该怎么改？ |
| [04-toolchain.md](./04-toolchain.md) | 工具链 | pnpm catalog / Turbo / git hooks / ESLint 是怎么搭的？ |
| [05-tsconfig-strategy.md](./05-tsconfig-strategy.md) | TypeScript 策略 | tsconfig 怎么组织的？为什么不用 TS Project References？ |
| [07-known-issues.md](./07-known-issues.md) | 当前问题清单 | 11 个底层架构问题的逐条详述（含证据、影响、严重级别） |
| [08-refactor-plan.md](./08-refactor-plan.md) | **详尽改造方案** | 想动手改？照着这个文件，逐 Phase、逐文件、逐命令执行 |

> 编号说明：跳过 `06` 是有意为之——预留位置给未来可能的「运行时架构」（如 Docker 编排、PM2 部署拓扑）文档，目前这部分内容散落在 `08-refactor-plan.md` 的 Phase 5。

---

## 推荐阅读路径

### 我是新人 / 想快速了解仓库
1. 读 `01-overview.md` —— 5 分钟看懂全貌
2. 读 `02-workspace-layout.md` —— 知道每个目录是干嘛的
3. 跳到根 `README.md` 跑 `pnpm dev:admin`

### 我想动手改造
1. **必读** `07-known-issues.md` —— 先知道有哪些坑
2. **必读** `08-refactor-plan.md` —— 这是操作手册，5 个 Phase 顺序执行
3. 按需读 `03/04/05` 的相关章节深入背景

### 我是决策者 / Reviewer
1. 读 `01-overview.md` 看现状
2. 读 `07-known-issues.md` 看问题严重性
3. 读 `08-refactor-plan.md` 的「不改的部分」章节看边界

---

## 与历史文档的关系

仓库中存在两份**历史文档**，它们记录的是合并前/合并中的状态，**已与当前现实脱节**：

| 历史文档 | 状态 | 与本目录的关系 |
|----------|------|----------------|
| `docs/monorepo.md` | ⚠️ **已过时** | 这是合并**前**的前端-only 拆包方案（声称"仅前端，不纳入后端"，列了不存在的 `apps/mfa-demo`，pnpm 版本写错为 9.0.0）。本目录 `01-overview.md` 取代它 |
| `migration-guide/`（11 个文件） | ⚠️ **历史档案** | 这是三仓库合并过程的逐步操作记录（Phase 1 已完成）。保留作历史参考，但其中的 `09-known-issues.md` 部分问题已被后续 commit 解决（如 ESLint 版本统一）。本目录 `07-known-issues.md` 是它的更新版 |

**改造时**：建议把这两份历史文档移到 `docs/archive/` 下，避免新人误读。但「移动文件」属于改造动作，本目录只写文档不动文件，详见 `08-refactor-plan.md` Phase 0。

---

## 文档维护原则

1. **全中文**（与项目主文档语言一致，便于团队沟通）
2. **每个论断附实测证据**：文件路径 + 行号 + grep 数字 + 字节数。不写"大约""若干""一些"
3. **改造步骤可独立执行、可验证**：每个 Phase 都给出验证命令
4. **数据时效性**：所有数字基于 2026-07-26 的仓库快照。仓库演进后，相关数字需重新采集——文档顶部会标注采集日期
5. **不混入业务逻辑讨论**：本目录只讲架构、工具链、边界，不讲具体业务代码（Pinia store 怎么写、NestJS controller 怎么装饰等）

---

## 术语表

| 术语 | 含义 |
|------|------|
| **app** | `apps/` 下的可部署单元（admin / server / docs） |
| **package** | `packages/` 下的共享库（shared / axios / core / ui / ai，及未来的 contract） |
| **workspace 包** | 在 `pnpm-workspace.yaml` 中声明、通过 `"workspace:*"` 引用的真包 |
| **path 别名 lib** | 后端 `apps/server/libs/` 下的库，通过 tsconfig `paths` 映射，**不是** pnpm workspace 包 |
| **内部包模式** | packages 不构建、不发布，`exports` 直接指向 `.ts` 源码，由消费者（Vite/tsc）直接消费源码 |
| **scope** | npm 包名的前缀部分，如 `@walnut/shared` 的 scope 是 `@walnut` |
| **异构工具链** | 仓库同时存在 ESM/Vite（admin/docs）和 CJS/SWC/NestJS（server）两种构建体系 |
