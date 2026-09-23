# 架构决策记录 (ADR)

## 概述

ADR（Architecture Decision Record）记录 Walnut Admin monorepo 项目中的关键架构决策。

当前共 **19** 条 ADR，涵盖包命名、TypeScript 配置、依赖治理、发布流水线、测试策略、验证策略、包重组、Git 钩子等领域。

## 形态约定（2026-09-23 起，由 `pnpm lint:adr` 机械强制）

在此之前，19 篇 ADR 的 `**Status:**` 有**三种互不兼容**的取值（`Accepted` ×12 / `Implemented` ×4 /
`In Progress` ×1），「备选方案」则有四种记法（独立小节没有、Context 里的粗体表、Decision 里逐个子决策
各一段、散在正文的「为什么不…」段落）—— 等于没有约定。现在统一成下面这个形状：

```md
# ADR-NNNN: <标题>

**Date:** YYYY-MM-DD
**Status:** Accepted

## Context          ← 必需
## Decision …       ← 必需，至少一个（多决策写成 `## Decision 1: …`）
## Alternatives considered   ← 必需，恰好一个，排在第一个 `## Decision` 之后
## Consequences     ← 必需
## Related          ← 可选
```

### `**Status:**` 只有四种取值

| 取值 | 含义 |
|------|------|
| `Proposed` | 提出来了，还没定 |
| `Accepted` | 决策**在生效**（不是「代码写完了」—— 实现进度属于正文） |
| `Rejected` | 讨论过、明确否决了。**否决也要留痕**，这是本枚举存在的首要理由 |
| `Superseded by ADR-NNNN` | 被后来的某篇取代；`NNNN` 必须真实存在 |

⚠️ **`Implemented` / `In Progress` 不再合法** —— 它们把「决策算不算数」和「代码写完没有」混为一谈。
真需要表达「部分落地」，写进 `## Implementation Progress` 或 `## Consequences`（[ADR 0017](./0017-package-reorganization.md)
就是这么做的）。

### `## Alternatives considered` 写什么

**只写本篇文档真正记过的备选方案。** 允许两种来源：

1. 篇内已有的取舍论述（`**Alternatives considered:**` 块、表格里 `Rejected` 那一列、正文里的
   「为什么不…」段落）—— 把它们**搬进**这一节，别留两个家；
2. 把决策**取反**得到的那个显然备选（「不引入 X」的备选就是「引入 X」），但**理由只能来自本篇**；
   本篇没给理由就如实写「本文档未展开理由」。

**不许编造历史**：不引入本篇没引用过的来源，不引用更晚的 ADR，不写 `**Date:**` 之后才发生的事。
门禁只查形态（有这一节、有列表项），**内容质量是评审的活** —— 硬拦只会逼出凑格式的空话。

### 加一篇新 ADR 时

1. 文件名 `NNNN-<kebab-slug>.md`，编号**从 0001 起连续**（不许跳号、不许重号）；
2. 照上面的形状写全五个部分；
3. 在下面的表格里**加一行**，状态列写 `**Status:**` 的**原文**（门禁要求两处逐字一致）。

漏掉第 3 步、写错编号、状态不在枚举内、少了任何一个小节 —— `pnpm lint:adr`（在 `prepush`
十段里的第八段、`ci.yml` 的 quality job、以及发版电池里）都会直接红。

## ADR 列表

| ADR | 决策 | 状态 |
|-----|------|------|
| [0001](./0001-package-naming.md) | 包命名——诚实命名，不用 "shared" / "core" | Accepted |
| [0002](./0002-dual-mode-consumption.md) | 双模式消费——`"source"` 给 Vite，CJS 构建给后端 | Accepted |
| [0003](./0003-no-env-defaults.md) | 共享包不做环境变量默认值 | Accepted |
| [0004](./0004-direct-contract-consumption.md) | 直接 import `@walnut/contract`，不加包装层 | Accepted |
| [0005](./0005-jit-vs-build.md) | 前端 only 包 JIT（源码），共享包构建 CJS | Accepted |
| [0006](./0006-runtime-api-separation.md) | 按运行时 API 依赖分层 | Accepted |
| [0007](./0007-backend-libs-not-workspace.md) | 后端 libs 保留为 NestJS CLI 内部 monorepo | Accepted |
| [0008](./0008-unified-versioning-separate-deploy.md) | 统一版本号，独立部署 | Accepted |
| [0009](./0009-ci-quality-gates.md) | 三级质量门禁：commit → push → CI | Accepted |
| [0010](./0010-no-ts-project-references.md) | 不用 TypeScript Project References | Accepted |
| [0011](./0011-dependency-governance-release.md) | `catalogMode: strict`、pnpm 原生发版（单一 fixed 组）+ git-cliff | Accepted |
| [0012](./0012-toolchain-divergence.md) | 前后端工具链分歧（tsconfig 独立、env 加载、hoisting、边界） | Accepted |
| [0013](./0013-barrel-exports-policy.md) | Barrel export 策略——选择性 barrel，不用 `export *` | Accepted |
| [0014](./0014-eslint-config-strategy.md) | ESLint 配置策略——共享 config 包 + 三预设 | Accepted |
| [0015](./0015-testing-strategy.md) | 测试策略——Vitest 统一、co-located、分层覆盖率 | Accepted |
| [0016](./0016-validation-strategy.md) | 验证策略——保持 class-validator，暂不迁移 Zod | Accepted |
| [0017](./0017-package-reorganization.md) | Package 重组——多维标签 + 目录分组 + 新增包规划 | Accepted |
| [0018](./0018-git-hooks-lefthook.md) | Git Hooks——lefthook 取代 simple-git-hooks | Accepted |
| [0019](./0019-tsconfig-presets-and-no-mjs.md) | 共享 tsconfig 预设包与「无 `.mjs`」约束 | Accepted |

> 全部 19 篇目前都是 `Accepted` —— 这不是「列没意义」，而是这个仓到目前**没有被否决或取代过的决策**。
> 枚举的价值在于：真出现 `Rejected` / `Superseded by ADR-NNNN` 时，有地方放、也有门禁保证它被填对。

## 补充文档

- [Zod vs class-validator 评估](./zod-evaluation.md) —— 技术对比评估，记录为何暂不迁移 Zod。
  它不是 ADR（无编号、无 `**Status:**`），所以不参与形态校验；结论已固化进 [ADR 0016](./0016-validation-strategy.md)。
