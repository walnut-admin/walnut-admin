# Monorepo 架构地图

> **这一页回答「这个仓长什么样、东西该放哪」。** 逐主题的细节见各专题文档（见下方索引）；
> 每条架构决策的**理由**在 [ADR](../adr/index.md) 里，本页只描述现状。

## 概述

Walnut Admin 是一个**全栈 TypeScript monorepo**，采用 **Turborepo + pnpm workspaces** 管理 15 个包（3 个 app + 3 个 platform-any 包 + 3 个 platform-web 包 + 6 个 tooling 包）。项目从三个独立仓库合并而来，通过 pnpm catalog 统一依赖版本、Turborepo 编排任务、pnpm 原生 release management（`versioning.fixed` 单一组）管理版本号。

- 仓库形态与包分组：[ADR 0017](../adr/0017-package-reorganization.md)
- 版本策略：[ADR 0008](../adr/0008-unified-versioning-separate-deploy.md) / [ADR 0011](../adr/0011-dependency-governance-release.md)
- 前后端工具链分歧：[ADR 0012](../adr/0012-toolchain-divergence.md)

### 技术栈速览

| 层级 | 技术 |
|------|------|
| 包管理 | pnpm 12+（workspace + catalog，`catalogMode: strict`） |
| 任务编排 | Turborepo 2.9（任务拓扑 + 缓存 + 架构边界） |
| 类型系统 | TypeScript 6.0（前端 ESM + 后端 CJS，双轨 toolchain） |
| 代码检查 | ESLint 10.3 flat config + `@antfu/eslint-config` + `@walnut/eslint-config` |
| 格式化 | ESLint stylistic（无 Prettier，`lint:fix` / lint-staged 即格式化入口） |
| 版本管理 | pnpm 原生 release management（`versioning.fixed` 单一组：**全部 workspace 包**永远同版本，组成员数由 `versioning-config.test.ts` 机械拦） |
| 变更日志 | git-cliff 逐包渲染 `CHANGELOG.md`（PR 链接 + 贡献者）；`pnpm release` 另生成根 `changelog-latest.md` |
| 死代码检测 | Knip 6.29（**当前是红的且有意维持**，见 [Knip](./knip.md)） |
| Git Hooks | lefthook（`lefthook.yml`）+ lint-staged |
| 前端框架 | Vue 3 + Vite 8 + Naive UI + UnoCSS |
| 后端框架 | NestJS 11 + SWC + Mongoose + Redis |
| 文档引擎 | VitePress 1.6 |
| Node 要求 | >= 24.13.0 |

## 「我要加 X，该放哪」

> 这是本页最该被查的一张表。**判据写在最后一列** —— 它比位置更重要，因为它解释了为什么。
> 拿不准时先看最后一列：多数错误都来自「把只服务一个 app 的东西放进了共享包」。

| 我要加… | 放哪 | 具体位置 | 判据 / 陷阱 |
|---------|------|---------|------------|
| 跨端常量（响应码、枚举、路由） | `@walnut/contract` | `packages/platform-any/contract/src/` | 前后端**直接消费**、不加包装层（ADR 0004）；有快照测试守护，改了会 diff |
| 跨端类型（前后端都要用） | `@walnut/types` | `packages/platform-any/types/src/<x>.d.ts`，并在 `src/index.d.ts` 补具名 re-export | 纯类型、零运行时；子路径 `@walnut/types/<x>` 与根 `@walnut/types` 都可用 |
| 纯函数工具（不碰 DOM、不碰 Vue） | `@walnut/utils` | `packages/platform-any/utils-core/src/` | 目标是**后端也能以 CJS 消费** ⇒ 引 Vue/DOM 就出界（ADR 0006）；必须补测试 |
| 浏览器工具 / Vue composable | `@walnut/client` | `packages/platform-web/client/src/` | 仅浏览器；Vue / pinia 是 peerDependency |
| HTTP 适配器 / 拦截器 | `@walnut/http` | `packages/platform-web/http/src/` | 包名是 `@walnut/http`（旧名 axios） |
| 可复用 UI 组件 | `@walnut/ui` | `packages/platform-web/ui/src/<Name>/{index.ts,index.vue}` | **只有「零 app 依赖 + 已被 ≥2 处复用」才迁**（待办 A7 / 评审的 D5），否则先留在 `apps/admin/src/components` |
| 只属于 admin 的组件 / store / 页面 | `apps/admin` | `src/components/**`、`src/store/modules/**`、`src/views/**` | 组件一律 `index.ts`（导出）+ `index.vue`（实现）；API 函数以 `API` 结尾 |
| 后端接口 | `apps/server` | `apps/api/src/modules/<domain>/` | 一模块一套 module / controller / service / basic.repository，规则见 `apps/server/AGENTS.md` |
| 后端内部共享能力 | `apps/server/libs/<x>` | 新建 lib 或在既有 9 个里加 | 它们**不是** workspace 包，走 tsconfig `paths`，namespace `@walnut-server/*`（ADR 0007） |
| 一条仓库门禁 / 脚本 | `@walnut/scripts` | `src/ci/<name>.ts` + `bin/<name>.ts` | 新增门禁有**五步接线清单**，少一步就等于没接上 —— 见下 |
| 共享配置预设（ESLint / tsconfig / Vitest / commitlint） | 对应的 `packages/tooling/<x>` | 已在册的 6 个包之一 | 新增第 7 个 tooling 包要同步单一 fixed 组、`versioning-config.test.ts`、以及一堆文档里的包清单 |
| 一篇架构决策记录 | 文档站 `content/adr/` | `NNNN-<slug>.md` | 形态由 `pnpm lint:adr` 机械强制，形状约定见 [ADR 索引](../adr/index.md) |
| 一篇架构 / 工程文档 | 文档站 `content/monorepo/` | 新页 **+ 在 `.vitepress/config/zh.ts` 的 sidebar 里登记** | 不登记 = 页面不可达（见 `apps/docs/AGENTS.md` 约定 3） |
| 一条**产品 / 功能**待办 | 仓库根 `TODO.md` | 按「重要紧急」四档 | 与下面的架构待办**刻意分开**：产品取舍没有机械判据 |
| 一条**架构 / 工程债** | [架构待办](./architecture-todo.md) | P2 / P3 / 搁置 / 未裁决 | 每条都要能写出**一条机械判据**，否则它属于根 `TODO.md` |

### 新增一条门禁的接线清单（五步，缺一不可）

以 `@walnut/scripts` 的某个 bin 为例 —— 本仓已有多条门禁，历史上漏接过步骤：

1. `src/ci/<name>.ts` 写**纯逻辑**（`collectFindings()` 之类）+ `bin/<name>.ts` 一行 `process.exit(main())`；
2. `packages/tooling/scripts/package.json` 的 `bin` 里登记；
3. 根 `package.json` 加一条 `lint:<name>` 脚本；
4. **接进 `pnpm prepush`**（那是一条 `&&` 串起来的聚合命令；`lefthook-config.test.ts` 会整表校验它有没有漏段）；
5. **接进 `ci.yml` 的 quality job**（CI 无缓存，是唯一能兜住本地跳过的闸）；若它也属于发版前必须过的，再加进 `packages/tooling/release/src/release/steps.ts` 的电池（`steps.test.ts` 会校验整表）。

> 另外两条约定：门禁**由 `pnpm install --force` 才会重新链接 bin**（`pnpm install` 有时不重链）；
> 以及**宁可漏报不可误报** —— 一个开始误报的门禁会被无视，等于没做（各门禁模块顶部都写了这条取舍）。

## 仓库全景

### 双层级 monorepo

项目存在**两层**包管理结构：

```
walnut-admin/                        ← Turborepo + pnpm workspace（外层）
├── apps/
│   ├── admin/                       ← @walnut/admin（Vue3 SPA）
│   ├── server/                      ← @walnut/server（NestJS API）
│   │   ├── apps/api/                ← NestJS 应用入口
│   │   └── libs/                    ← NestJS CLI monorepo（内层，9 个 lib）
│   └── docs/                        ← @walnut/docs（VitePress 文档站）
├── packages/                        ← 共享库（按平台分组，ADR 0017）
│   ├── platform-any/                ← 运行时无关
│   │   ├── contract/                ← @walnut/contract（类型 + 常量）
│   │   ├── types/                   ← @walnut/types（类型声明）
│   │   └── utils-core/              ← @walnut/utils（纯函数工具；目录名 ≠ 包名）
│   ├── platform-web/                ← 浏览器 / Vue（纯源码，不构建）
│   │   ├── client/                  ← @walnut/client
│   │   ├── http/                    ← @walnut/http（原名 axios）
│   │   └── ui/                      ← @walnut/ui
│   └── tooling/                     ← 工具链 6 包（ADR 0019）
│       ├── tsconfig/                ← @walnut/tsconfig（纯 JSON 预设 base / ts / vue）
│       ├── eslint-config/           ← @walnut/eslint-config（base / vue / nest）
│       ├── commitlint-config/       ← @walnut/commitlint-config
│       ├── vitest-config/           ← @walnut/vitest-config（共享 Vitest 预设）
│       ├── scripts/                 ← @walnut/scripts（仓库级脚本：lib / ci / env + bin）
│       └── release/                 ← @walnut/release（发版编排，bin walnut-release）
├── turbo.json                       ← 任务定义 + 缓存 + 架构边界
├── pnpm-workspace.yaml              ← workspace 声明 + catalog + versioning
├── tsconfig.json                    ← 仓库根 TS 配置（extends @walnut/tsconfig/base.json）
├── eslint.config.ts                 ← 根 ESLint 入口
├── knip.config.ts                   ← 死代码检测配置
└── TODO.md                          ← 产品 / 功能待办（与架构待办分开的两本账）
```

**外层**（Turborepo 层面）：`apps/*` + `packages/platform-any/*` + `packages/platform-web/*` + `packages/tooling/*` 的 workspace 包，通过 pnpm workspace 协议（`workspace:*`）相互引用。

**内层**（Server 内部）：`apps/server/libs/*` 下的 9 个 NestJS 内部库，通过 TypeScript `paths` 映射解析，不走 pnpm workspace。命名空间为 `@walnut-server/*`，与外层 `@walnut/*` 物理分离。

### 关键设计决策

1. **异构 Toolchain**：前端 ESM + Vite + `moduleResolution: "bundler"`；后端 CJS + NestJS CLI + SWC + `moduleResolution: "node"`。Server **不继承**任何 `@walnut/tsconfig` 预设（ADR 0012）。
2. **两个命名空间**：`@walnut/*`（外层，pnpm workspace 包）和 `@walnut-server/*`（内层，NestJS internal libs）。物理分离，无命名冲突。
3. **catalog 统一版本**：依赖版本只写在 `pnpm-workspace.yaml` 的 `catalog:` 段，`catalogMode: strict` 阻止包内直接写版本号。
4. **`hoist: false`**：严格依赖隔离 —— 每个包只能解析自己 `package.json` 中声明的依赖。仅有少数**精确包名**的 `publicHoistPattern` 例外被提升到根 `node_modules/`。
5. **供应链防护**：`minimumReleaseAge`（发布冷却期）、`trustPolicy: no-downgrade`（拒绝可信度下降的版本）、`blockExoticSubdeps`（传递依赖禁止异源）三项由 pnpm 在安装时校验 lockfile。
6. **依赖构建脚本白名单只放行两条**：`@sentry/cli` 与 `lefthook`（它的 postinstall 就是 `lefthook install`，不放行则 git 钩子静默消失，见 ADR 0018）；其余原生模块通过 `optionalDependencies` 分发预编译产物，不需要构建脚本。

## 共享包体系

### 依赖图

```
@walnut/contract          ← 基础层（类型 + 常量）
    ↑
@walnut/utils             ← 纯函数工具（依赖 contract + types）
    ↑
@walnut/client  @walnut/http   ← 浏览器/Vue 层（依赖 utils + contract）
    ↑              ↑
@walnut/ui                ← naive-ui 组件层（peer: naive-ui + vue）
    ↑
@walnut/admin             ← 消费所有共享包
```

### 各包职责

| 包 | 职责 | 关键依赖 |
|----|------|---------|
| `@walnut/contract` | 共享类型、DTO、枚举、API 契约 | 零运行时依赖 |
| `@walnut/utils` | 纯函数（regex、queue、crypto） | contract + types |
| `@walnut/types` | 环境类型声明（universal / storage / deep-ref / object-key） | 零依赖 |
| `@walnut/client` | 浏览器工具 + Vue composables + store 工厂 | Vue 3（peer） |
| `@walnut/http` | HTTP 客户端框架（instance + adapters） | axios + client |
| `@walnut/ui` | naive-ui 组件 | naive-ui + vue（peer） |
| `@walnut/eslint-config` | ESLint 共享预设（base / vue / nest） | ESLint（peer） |
| `@walnut/commitlint-config` | commitlint 规则（scope-enum 等） | commitlint |
| `@walnut/tsconfig` | 纯 JSON tsconfig 预设，无依赖、无源码 | 无 |
| `@walnut/vitest-config` | 共享 Vitest 预设（发现规则 / 环境 / 覆盖率） | vitest（peer） |
| `@walnut/scripts` | 仓库级脚本通用层：`lib/` 纯逻辑、`ci/` 门禁、`env/` 加解密，经 bin 被根 scripts 调用 | `@dotenvx/dotenvx`、`typescript` |
| `@walnut/release` | 发版编排（`src/release/`），bin `walnut-release` | `@walnut/scripts`、git-cliff、yaml |

> **每个包自己的「契约 / 配置 / 扩展点 / 已知限制」写在它自己的 `README.md` 里**，不在这里重复 ——
> 那些内容离代码越近越不容易漂。逐包入口：
> [`contract`](https://github.com/walnut-admin/walnut-admin/blob/main/packages/platform-any/contract/README.md) ·
> [`types`](https://github.com/walnut-admin/walnut-admin/blob/main/packages/platform-any/types/README.md) ·
> [`utils`](https://github.com/walnut-admin/walnut-admin/blob/main/packages/platform-any/utils-core/README.md) ·
> [`client`](https://github.com/walnut-admin/walnut-admin/blob/main/packages/platform-web/client/README.md) ·
> [`http`](https://github.com/walnut-admin/walnut-admin/blob/main/packages/platform-web/http/README.md) ·
> [`ui`](https://github.com/walnut-admin/walnut-admin/blob/main/packages/platform-web/ui/README.md) ·
> [`tsconfig`](https://github.com/walnut-admin/walnut-admin/blob/main/packages/tooling/tsconfig/README.md) ·
> [`eslint-config`](https://github.com/walnut-admin/walnut-admin/blob/main/packages/tooling/eslint-config/README.md) ·
> [`commitlint-config`](https://github.com/walnut-admin/walnut-admin/blob/main/packages/tooling/commitlint-config/README.md) ·
> [`vitest-config`](https://github.com/walnut-admin/walnut-admin/blob/main/packages/tooling/vitest-config/README.md) ·
> [`scripts`](https://github.com/walnut-admin/walnut-admin/blob/main/packages/tooling/scripts/README.md) ·
> [`release`](https://github.com/walnut-admin/walnut-admin/blob/main/packages/tooling/release/README.md)；
> 后端内部 lib 的逐库说明在 `apps/server/libs/<x>/README.md`。

### 消费方式

- **前端**（Vite）：通过 `workspace:*` symlink 直接消费源码（JIT 模式，ADR 0005）
- **后端**（NestJS）：通过 `workspace:*` symlink 消费 CJS 构建产物（`exports` 的 `require` 条件，ADR 0002）
- **不发布 npm**：当前为内部 monorepo。平台包不含 `private` 字段（表示代码公开可见，**不**代表要发布到 npm）；各 app 与 `@walnut/scripts` / `@walnut/release` / `@walnut/tsconfig` 为 `private: true`。

## 后端内部库体系

Server 内部通过 NestJS CLI + SWC 管理 9 个内部库，命名空间 `@walnut-server/*`：

```
apps/server/libs/
├── config/       @walnut-server/config       — 环境配置 + 验证
├── const/        @walnut-server/const        — 常量 + 错误码
├── context/      @walnut-server/context      — ALS 上下文
├── db/           @walnut-server/db           — Mongoose + 事务
├── decorators/   @walnut-server/decorators   — 自定义装饰器体系
├── exceptions/   @walnut-server/exceptions   — 异常 + 全局过滤器
├── pipes/        @walnut-server/pipes        — 参数管道
├── types/        @walnut-server/types        — 类型声明
└── utils/        @walnut-server/utils        — 工具函数
```

这些 lib 通过 `apps/server/tsconfig.json` 的 `paths` 映射解析，由 NestJS CLI + SWC 统一编译。它们**不参与** pnpm workspace，不通过 `package.json` `exports` 消费。为什么这样：[ADR 0007](../adr/0007-backend-libs-not-workspace.md)。

## 相关 ADR

- [ADR 0002 双模式消费](../adr/0002-dual-mode-consumption.md) ｜ [ADR 0004 直接消费 contract](../adr/0004-direct-contract-consumption.md) ｜ [ADR 0005 JIT vs 构建](../adr/0005-jit-vs-build.md)
- [ADR 0006 运行时 API 分层](../adr/0006-runtime-api-separation.md) ｜ [ADR 0007 后端 lib 不提升为包](../adr/0007-backend-libs-not-workspace.md)
- [ADR 0008 统一版本](../adr/0008-unified-versioning-separate-deploy.md) ｜ [ADR 0010 不用 Project References](../adr/0010-no-ts-project-references.md) ｜ [ADR 0011 依赖治理与发版](../adr/0011-dependency-governance-release.md)
- [ADR 0012 前后端工具链分歧](../adr/0012-toolchain-divergence.md) ｜ [ADR 0013 Barrel 策略](../adr/0013-barrel-exports-policy.md) ｜ [ADR 0017 包重组](../adr/0017-package-reorganization.md) ｜ [ADR 0019 tsconfig 预设与无 `.mjs`](../adr/0019-tsconfig-presets-and-no-mjs.md)
- 全部决策（含**已否决**的）：[ADR 索引](../adr/index.md)
