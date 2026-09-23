# 术语表

> **只回答「这个词在本仓指什么」。** 结构与「东西该放哪」见[架构地图](./architecture.md)，
> 决策理由见 [ADR](../adr/index.md)，命令见仓库根 `AGENTS.md`。
>
> 2026-09-23 从仓库根 `CONTEXT.md` **搬到这里**（评审 §6 的「术语表」层）。搬的原因：那份文件
> 与本节文档讲的是同一批包，已经漂移过一次（它曾把已更名的 `@walnut/axios` 当作现存包）。
> 现在根 `CONTEXT.md` 只留一个指针。

## 仓库结构与分组

| 术语 | 在本仓指什么 |
|------|------------|
| **外层 / 内层** | 外层 = pnpm workspace 里的 workspace 包（`apps/*` + `packages/**`）；内层 = `apps/server/libs/*` 那 9 个 NestJS 内部库，**不是** workspace 包，走 tsconfig `paths` 解析 |
| **platform-any** | 运行时无关的共享包组：`contract` · `types` · `utils-core`。可被前端与后端同时消费 |
| **platform-web** | 浏览器 / Vue 包组：`client` · `http` · `ui`。**源码直消费、不构建** |
| **tooling** | 工具链包组（6 个）：`tsconfig` · `eslint-config` · `commitlint-config` · `vitest-config` · `scripts` · `release` |
| **内部 lib** | `apps/server/libs/` 下的 9 个库（`config` `const` `context` `db` `decorators` `exceptions` `pipes` `types` `utils`），namespace `@walnut-server/*`，与 workspace 包物理分离（ADR 0007） |
| **目录名 ≠ 包名** | 最典型的是 `packages/platform-any/utils-core/` —— 它的包名是 **`@walnut/utils`**，`utils-core` 只是目录名 |
| **boundary tag** | 各包 workspace 级 `turbo.json` 里声明的标签（`app` / `platform-any` / `platform-web` / `platform-node` / `tooling` / `shared` / `backend` …），由 `turbo boundaries` 强制依赖方向；`shared` 不得依赖 `app`、`platform-any` 不得依赖 `platform-web`/`platform-node`、`backend` 不得依赖 `platform-web` |

## 包

| 术语 | 在本仓指什么 |
|------|------------|
| **`@walnut/contract`** | 构成前后端 API 契约的共享类型与常量：响应码 / 响应信封、枚举、分页、菜单与角色常量、locale、HTTP headers、路由常量。**单一真源**，有快照测试守护（ADR 0004） |
| **`@walnut/utils`** | 平台无关的纯函数：regex、queue、crypto 原语、持久化增强。前后端都消费；因为后端要 CJS 消费，**不能引 Vue/DOM**（ADR 0006） |
| **`@walnut/types`** | 纯 ambient 类型声明（`universal` / `storage` / `deep-ref` / `object-key`），零运行时。子路径 `@walnut/types/<name>` 与根导出 `@walnut/types` 都可用 |
| **`@walnut/client`** | 仅浏览器的代码：Web Crypto 封装、文件工具、window 帮助函数、持久化存储、Vue composables、store 工厂。源码直消费，无构建 |
| **`@walnut/http`** | 基于 Axios 的 HTTP 客户端框架：instance、拦截器、适配器（cache / retry / throttle / cancel / merge）。**原名 `@walnut/axios`**（2026-07 更名） |
| **`@walnut/ui`** | 基于 naive-ui 的组件。**目前只有 3 个**（`Switch` / `DynamicTags` / `TimePicker`），迁移仍在进行（待办 A7） |
| **`@walnut/tsconfig`** | 纯 JSON 的 tsconfig 预设：`base` / `ts` / `vue`，按**运行环境**而不是「项目 vs 库」分（ADR 0019） |
| **`@walnut/scripts`** | 仓库级脚本的通用层：`lib/`（纯逻辑，供其它工具包复用）、`ci/`（仓库门禁）、`env/`（加解密），以及若干 bin。**只导出 `lib/*`**，`ci/` 与 `env/` 刻意不导出 |
| **`@walnut/release`** | 发版编排（`src/release/`），唯一 bin 是 `walnut-release`（根 `pnpm release`） |
| **`@walnut/vitest-config`** | 共享 Vitest 预设：只收敛用例发现规则 / 运行环境 / 覆盖率采集范围三件事 |

## 机制与约定

| 术语 | 在本仓指什么 |
|------|------------|
| **catalog** | `pnpm-workspace.yaml` 的 `catalog:` 段 —— 依赖版本的**唯一**书写处。`catalogMode: strict` 下包内只能写 `"catalog:"` |
| **`workspace:*`** | workspace 内部引用的唯一写法（syncpack 强制） |
| **双模式消费** | 同一个包经 `exports` 条件同时服务两端：`"source"` 给 Vite 读源码，`"require"` 给后端读 CJS 产物（ADR 0002） |
| **JIT / 源码直消费** | `exports` 直接指向 `.ts` 源码，由消费方的打包器编译，**没有构建步骤**。`platform-web/*` 与 `@walnut/types` 属于这一类（ADR 0005） |
| **barrel / 选择性 barrel** | 包入口的 `index.ts`。ADR 0013 规定包入口用**显式具名 re-export**，`export *` 一次都不用；app 代码则**不建** barrel |
| **意图（intent）** | 一次发版的版本变更声明。`pnpm change` 写、`pnpm version -r` 消费；文件仍是 changesets 格式（`.changeset/*.md`） |
| **ledger** | `.changeset/ledger.yaml` —— 意图的**消费台账**。「哪些意图已经被消费」的判据始终是它，不是文件在不在 |
| **fixed 组** | `versioning.fixed` 里的单一组：**全部** workspace 包永远同版本，因此 tag `vX.Y.Z` 永远有唯一来源（ADR 0008 / 0011） |
| **电池（release battery）** | 发版前必跑的聚合门禁表，定义在 `packages/tooling/release/src/release/steps.ts` |
| **可擦除语法** | Node 24 原生剥离类型只支持的写法：没有 `enum`、没有非 ambient `namespace`、没有构造函数参数属性、没有 `import =`。由 `@walnut/tsconfig/ts.json` 的 `erasableSyntaxOnly` 在编译期保证（ADR 0019） |
| **`@pseudo`** | 文档里**有意写不合法**的伪代码块，把 `// @pseudo` 放在块的第一行即可豁免 `pnpm lint:doc-ts` |
| **冻结语料** | `content/archive/` 与 `content/industry-research/`：有意保留当时样子的历史文档，**不参与**死链、路径引用、代码块校验 |

## 纪律（原根 `CONTEXT.md` 的 Rules）

1. **共享包不做环境相关默认值。** 工具函数收参数，由调用方决定 dev/prod 行为。
2. **共享包里不写 `import.meta.env` / `process.env`。** 那是 app 层的事。
3. **直接消费 `@walnut/contract`。** 不加包装层 —— 直接从源码 import 类型与常量（ADR 0004）。
4. **`private: true` 的包只被本仓源码消费。** CJS 构建产物**只**为后端消费而存在。

> 上面前三条由 `pnpm lint`（ESLint 预设里有对应规则）与 ADR 约束；第 4 条是约定 —— 它意味着
> 「`private` 字段的缺失**不**代表要发布到 npm」，见[架构地图](./architecture.md)的消费方式一节。
