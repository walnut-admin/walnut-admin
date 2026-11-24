# ADR-0028: tooling 提升为顶层目录组

**Date:** 2026-11-23
**Status:** Accepted

## Context

工具链各包（tsconfig、eslint-config、commitlint-config、vitest-config、scripts、release）此前住在
`packages/` 下的 tooling 组里，与业务共享包混在同一棵树。它们的消费者只有仓库自己的配置与根脚本，
不随业务发布；把它们和 `contract` / `client` 这类业务包放在一起，会让「这棵树是不是业务代码」这个
问题每次都要靠读 `package.json` 才能回答。

Turborepo 的官方口径是 `apps/` 放应用、`packages/` 放其余一切（含库与 tooling），也就是本仓此前的
形态。但「tooling 独占顶层目录」在成熟仓库里同样普遍（2026-11-23 用 GitHub API 逐个核实过根目录）：
Nx、NestJS、Deno、Angular、ESLint、typescript-eslint、TypeScript、Expo、AFFiNE 都有顶层 `tools/`；
Element Plus 用顶层 `internal/`，里面正是 eslint-config 与 build，且是刻意迁过去的
（[element-plus#6553](https://github.com/element-plus/element-plus/pull/6553)）；Vue core 用
`packages-private/`；dify 用 `dev/`。这些仓库的根目录同样留着各工具约定位置的入口文件（根 ESLint
配置、knip 配置等）—— 成熟做法是「根留薄入口、逻辑进 tooling 包」，而不是把根清空。

命名上 `tools`、`internal` 比 `tooling` 更常见。本仓沿用 `tooling`：它已经是目录组名，文档、turbo
tag、commit scope 都在用这个词。

## Decision 1: tooling 各包搬到仓库根的 tooling 目录

把原来的 tooling 组整体提到仓库根，与 `apps/`、`packages/` 同级；包名、版本号、turbo tags、
`versioning.fixed` 组成员都保持不变，因此没有任何 import 需要改（跨包 tsconfig extends 与 import
全部走包名）。`pnpm-workspace.yaml` 的 `packages` 字段以 `tooling/*` 取代原来的组 glob，并补一段
判据注释：「给仓库自己用、不随业务发布」的包住这里。

## Decision 2: 根目录只留各工具约定位置的薄入口

根 `package.json`、`turbo.json`、`pnpm-workspace.yaml`、`eslint.config.ts`、`knip.config.ts`、
`commitlint.config.ts`、`lefthook.yml`、`cliff.toml` 等继续留在根：它们是各工具默认会去读的入口，
搬走只会让每个工具都需要额外配置。逻辑（预设、门禁、发版编排）仍住在对应的 tooling 包里。

## Decision 3: 包目录形态收敛为单一真源

`@walnut/scripts` 与 `@walnut/release` 此前各有一份硬编码的「包目录形态正则」，只认 `apps/<x>` 与
`packages/<组>/<x>`；不匹配的目录会被**静默跳过**（门禁扫描面变小、发版归属漏包，都不报错）。
迁移后形态多了一种（`tooling/<x>`），两份正则更容易继续漂移。现在由 `@walnut/scripts` 的
`isWorkspacePackageDir` 独占这条判据，release 包改为 import 它；新增的 `workspace.test.ts` 读
`pnpm-workspace.yaml` 的 `packages` glob 做对账 —— 以后再调目录组而忘了改谓词，测试直接红。

## Decision 4: 文档门禁的顶层目录白名单收录 tooling

`check-doc-refs` 只认白名单里顶层目录开头的路径引用。不把 `tooling` 加进去，活文档里的新路径就
无人校验（写错了也全绿）。这是「一个开始误报的门禁等于没有门禁」的另一面：漏收一个目录等于给那批
路径开了永久豁免。

## Alternatives considered

- **保持原位（`packages/tooling/`）**：符合 Turborepo 官方建议，迁移成本为零；但「工具链与业务包
  混在一棵树」的问题仍在，且 `packages/` 的语义会继续含糊（有的组是业务、有的组是工具链）。
- **改名 `tools/` 或 `internal/`**：这是外部更常见的命名，但本仓的文档、turbo tag、commit scope
  与计划文件已经在用 `tooling`；改名要同步的面远大于搬家本身，收益只是「跟别人一样」。
- **把根级工具配置一并挪进 tooling**：能让根目录更空，但 `eslint.config.ts`、`knip.config.ts`、
  `turbo.json` 等是各工具默认读取位置的入口；搬走要给每个工具加一层间接配置，且会让「跑一条命令
  之前先找配置在哪」成为新的日常成本。根留薄入口是外部成熟仓库的同一选择。
- **为迁移期保留 `packages/tooling/` 的兼容路径**：会让同一批包出现两个家，文件系统层面无法表达
  「两个路径都算这个包」，pnpm 的 workspace 也会把同名的包发现两次；一次性搬到位的代价只是所有
  引用处同时改。

## Consequences

- 根目录结构变成 `apps/`（应用）、`packages/`（业务共享包）、`tooling/`（工具链）三棵树，
  「这棵树是不是业务代码」看一眼就够。
- 迁移必须同时改：`pnpm-workspace.yaml`、`turbo.json` 的 `globalDependencies`、根脚本
  （`clean:all` 与 knip 的 workspace glob）、workflow 里打包 seed 工具的那行、server 侧指向工具链的
  两处路径、文档门禁白名单与全部活文档路径。跨包 import 一处都不用改。
- 目录形态谓词从「两份手写正则」收敛成「一份谓词 + 一条对账测试」；以后再改目录组，红的是测试而
  不是线上门禁的扫描面。
- 历史记录（ADR 正文、冻结语料）保留旧路径不改：它们记的是当时的事实。
  `seed-verify` 的基线路径跟着默认基线提交走，不随本次迁移改。
- 风险：Windows 上 `git mv` 整个组目录可能被文件占用挡住（实测遇到），退路是逐个包 `git mv`。

## Related

- [ADR 0017](./0017-package-reorganization.md) —— 目录分组与 tooling 组的由来
- [ADR 0019](./0019-tsconfig-presets-and-no-mjs.md) —— tooling 组内的拆包与共享 tsconfig 预设
- [ADR 0009](./0009-ci-quality-gates.md) —— 门禁的分层与「静默弱化」问题
