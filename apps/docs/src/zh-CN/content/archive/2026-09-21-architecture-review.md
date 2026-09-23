# 架构 Review：行业调研 × DeepSeek Harness 融合分析

> 📦 **归档文档（2026-09-21 评审）**：评审当时的仓库基线是 `5c64f2a`，其中的差距项有的已经落地（如 CI/CD 静默失效、pnpm 12 迁移），阅读时请以 `architecture-todo.md` 与各专题文档为准。

> **日期**：2026-09-21 ｜ **范围**：架构层面 review 与优化空间，**不含任何改版实施项**
> **基线**：仓库 HEAD `5c64f2a`（2026-08-13），`architecture-todo.md` 最后更新 2026-08-08，距今约 6 周
> **归档位置**：本文档原在仓库根 `docs/reviews/`，现已随文档整理迁入文档站 `content/archive/`（§6 讨论的层级归属问题即由此解决）。

---

## 摘要

三条判断：

**1. 调研文档整体仍然成立，但有 4 条结论已过时或需要修正。**
影响最大的一条是 TypeScript 7：`architecture-todo.md` 把「TS 7 / tsgo 迁移准备」列为 P3「远期，当前不做」（R7），但 TS 7.0 RC 已于 2026-06 进入主线，这个排期需要重估。

**2. DSH 值得借鉴的不是它的工具选型，而是它的六套治理机制。**
DSH 的规模（255 个 `packages/*/*` 包 / 约 29 万行源码 / 854 个测试文件 / 1742 篇决策记录）与产品形态（一个由插件组合而成的 agent 产品）决定了它必须用 oxlint、自研 release families、不用 pnpm catalog、写 70+ 道门禁。**这些选型直接照搬到 12 包 / 8.6 万行的项目上会得不偿失。** 真正可迁移的是它解决四类共性问题的机制（§2.2）。

**3. 当前最该优化的不是 packages 拆分，而是「文档 + 不变量」的治理结构。**
上一轮 review 的**结论**（packages 分组、ADR 0001-0017、12 篇架构文档）都是对的，但**治理机制缺失已经产生了可测量的结构性漂移**：34 处文档引用已改名的 `@walnut/axios`、4 处引用已删除的 `migration-guide/`、164 个不被 VitePress 渲染的重复文档、6 份互相重叠的根级架构/上下文文档、1 份与已接受 ADR 冲突且全仓无人引用的抽取报告（§4.1）。

**更严重的是**：有**两个被写进架构文档、列为设计决策的机制，实测从未生效**（§4.6）——`pnpm-workspace.yaml` 的 `hoisting: false` 不是合法的 pnpm 键（实测 `node_modules/.pnpm/node_modules` 有 **1647 个条目**，即默认提升仍然开着），`.npmrc` 的 5 条 `public-hoist-pattern[]` 同样未起作用（`@swc`/`esbuild` 不在根 `node_modules`）。**「文档说了假话」和「配置没说上话」是同一个病的两个症状：声明与现状之间没有机械校验。**

---

## 1. 调研文档回顾

### 1.1 文档地图

`apps/docs/src/zh-CN/content/` 下有两条与架构相关的线：

| 目录 | 篇数 | 定位 | 是否被文档站发布 |
|------|------|------|-----------------|
| `industry-research/` | 8 | **行业调研**：业界共识 + 与 Walnut Admin 的差距对比 | ✅（导航「行业调研」） |
| `adr/` | 19 | **决策记录**：ADR 0001-0017 + index + zod-evaluation | ✅（导航「ADR」） |
| `monorepo/` | 12 | **本项目架构说明**：每个顶层设计领域一篇 | ✅（导航「架构」） |

其中「前端后端都在一个仓库」这条线对应的是 **`industry-research/07-fullstack-architecture.md`**（Vue3 + NestJS 全栈 Monorepo 架构）+ `industry-research/index.md` 的来源清单，以及 `monorepo/` 整条线。

### 1.2 第三方参考链接清单

**真正的第三方资料**（指向非本项目仓库）：

| 链接 | 出现在 | 用途 |
|------|--------|------|
| [Turborepo 官方文档](https://turbo.build/repo/docs) | research/index | 任务编排、缓存策略、remote cache |
| [pnpm 官方文档](https://pnpm.io/) | research/index | workspace 协议、catalog 协议、hoisting |
| [Changesets](https://github.com/changesets/changesets) | research/index、06 | 版本管理、changelog、CI 集成 |
| [ESLint 官方文档](https://eslint.org/docs/latest/use/configure/) | research/index | flat config、shareable configs |
| [Vitest 官方文档](https://vitest.dev/) | research/index | 配置、workspace 模式、覆盖率 |
| [Astro 仓库](https://github.com/withastro/astro) | research/index | 大型 pnpm monorepo + changesets 实践 |
| [tRPC 仓库](https://github.com/trpc/trpc) | research/index | 前后端类型共享、vitest 配置 |
| [oxlint](https://oxc.rs/docs/guide/usage/linter.html) | 02 | 快速 lint 第一道扫描 |
| [biome](https://biomejs.dev/) | 02 | ESLint + Prettier 替代 |
| [syncpack](https://jamiemason.github.io/syncpack/) | 02、monorepo/syncpack | 依赖版本一致性 |
| [Knip](https://knip.dev/) | 02、monorepo/knip | 死代码检测 |
| [git-cliff](https://git-cliff.org/) | 06 | changelog 生成 |
| [Changeset Bot](https://github.com/apps/changeset-bot) | 06 | PR 自动提醒缺 changeset |
| [Codecov](https://about.codecov.io/) / [Coveralls](https://coveralls.io/) | 04 | PR 覆盖率评论 |
| [Playwright](https://playwright.dev/) / [Cypress](https://www.cypress.io/) / [Nightwatch](https://nightwatchjs.org/) | 04 | E2E 方案对比 |
| [taze](https://github.com/antfu/taze) | monorepo/syncpack | 交互式依赖升级 |

**指向本项目自己 GitHub 的链接**（`02`/`03`/`04`/`05`/`06` 与 `monorepo/*` 中大量使用）：这些是"点开即源码"的锚点，属于好的实践（DSH 的 `verify-md-links` 强制的正是这一点），但它们的**目标路径稳定性没有任何门禁保障**——见 §4.1。

### 1.3 时效性核查

逐条核实调研结论在 2026-09 是否仍成立：

| # | 原结论 | 判断 | 依据 |
|---|--------|------|------|
| 1 | **oxlint / biome 都不支持 Vue SFC**（`02` 与 `architecture-todo.md` P3-15，因此暂不引入） | ⚠️ **部分过时** | 已出现第三方方案 [`oxlint-vue`](https://socket.dev/npm/package/oxlint-vue)、[`oxlint-plugin-vue-sfc`](https://socket.dev/npm/package/oxlint-plugin-vue-sfc)；官方仍在 [RFC: Embedded Framework Support for Oxlint](https://github.com/oxc-project/oxc/discussions/21936) 阶段，**first-party 支持尚未落地**。结论「暂不作为主 linter」仍成立，但措辞应从"都不支持"改为"无官方支持，第三方插件可用但不成熟" |
| 2 | **TS 7 / tsgo 属远期**（R7 列为 P3） | ❌ **已过时（紧迫）** | [TypeScript 7.0 已于 2026-07-08 正式发布](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)——Go 原生重写，实测 8-12× 编译加速。原判断"等支持后再准备"已不适用。**风险点**：`apps/server/tsconfig.json` 未显式声明 `moduleResolution`，而 `"module": "commonjs"` 会使其落到默认的 `node10` 解析——这正是 TS 6.0 弃用、社区在推动[移除](https://github.com/microsoft/typescript/issues/62200)的选项；同时 `tsconfig.base.json:20` 的 `ignoreDeprecations: "6.0"` 在 7.0 下失去意义。**需实测 TS 7 对本仓的实际阻塞面**（已有社区迁移工具 [`ts6to7`](https://www.npmjs.com/package/ts6to7)） |
| 3 | Vitest 用 workspace 配置 + 复制 preset | ⚠️ **需修正** | 官方现行机制是 [`projects` 配置](https://vitest.dev/guide/projects)（见 `vitest.dev/guide/projects`）。P3-14「Vitest 共享 preset」的技术前提已变，重估时应以 `projects` 为基线 |
| 4 | **Turbo Remote Cache 不接入** | ✅ 仍成立（结论），⚠️ 但理由需更新 | 单人维护 + 单机缓存足够的判断没问题；补充：自托管方案存在（[turborepo-remote-cache](https://github.com/ThibaultMarechal/turborepo-remote-cache)），保留 `TURBO_TOKEN`/`TURBO_TEAM` 透传的策略依然正确 |
| 5 | pnpm `catalogMode: strict` | ✅ 仍可用，⚠️ 值得关注 | 已有项目主动移除该模式（[typescript-eslint#12305](https://github.com/typescript-eslint/typescript-eslint/pull/12305)）。对本仓库而言 strict 仍带来收益（248 依赖单一收敛点），但应记录这是一个**有争议的强约束** |
| 6 | Changesets + git-cliff 双轨 | ✅ 仍成立 | 无更主流替代；DSH 这类超大规模仓库才值得自研 release 编排 |
| 7 | Knip / syncpack / taze | ✅ 仍成立 | 三者仍在活跃维护 |
| 8 | 后端 class-validator，Zod 迁移暂缓（P3-12） | ❌ **前提已变，需重开评估** | **NestJS v12 已把 Standard Schema 验证纳入官方**（[v12 roadmap：Full ESM Migration, Standard Schema Validation](https://www.infoq.com/news/2026/04/nestjs-12-roadmap-esm/)），`@Body({ schema })` + `StandardSchemaValidationPipe` 原生可用，同一 schema 还能驱动 OpenAPI。`industry-research/07` 里"手写约 15 行 `ZodValidationPipe`"的示例**已被官方取代**。注意：class-validator 仍完全支持、无移除计划，所以这不是"必须迁移"，而是"迁移成本下降 + 收益上升，值得重算" |
| 9 | `@antfu/eslint-config` 作为预设基础 | ✅ 仍成立 | 仍是 Vue/TS 生态主流选择 |
| 10 | 版本基线 TS 6.0.3 / Node 24 / Vite 8 / Turbo 2.9 | ✅ 大体成立 | 唯一需要跟上的是 TS 主线已到 7.0 RC（见 #2） |

**另有 2 条没有出现在任何调研文档中、但这次 review 认为缺口最大的**（详见 §4.3、§4.5）：

- 没有任何文档讨论过**「在哪些边界做运行时校验」**——`07` 只讨论了"用哪个库做校验"。
- 没有任何文档讨论过**文档本身如何防止漂移**——调研覆盖了代码门禁（CI/lint/test），但文档治理是空白。

---

## 2. DSH 架构提炼

### 2.1 规模对照

| 维度 | Walnut Admin | DeepSeek Harness | 倍数 |
|------|--------------|------------------|------|
| workspace 包 | **12**（3 app + 9 包） | **272**（255 包 + 9 vendor + 2 app + 6 其他） | ~23× |
| 源码行数（排除测试） | ~86,000 | ~289,700 | ~3.4× |
| 源码文件 | ~1,285 | ~1,693 | ~1.3× |
| **测试文件** | **10** | **854** | **~85×** |
| 架构/决策文档 | 39 篇（research 8 + adr 19 + monorepo 12） | 241 篇 `docs/` + 873 篇决策记录 | — |
| 机械门禁（verify/gen 脚本） | **0** | **~70** | — |
| 包体量中位数 | — | **507 行/包**（255 包 / 287k 行） | — |
| 包 README 覆盖率 | 部分（server libs 有，packages 不全） | **255/255** | — |

> **读法一**：包数差 23 倍、代码量只差 3.4 倍 → DSH 的包平均比咱们小一个数量级。这是"运行期可重组"这个**产品需求**倒推出来的（每个能力都必须是能从 `cordis.yml` 挂载/卸载的插件，因此必须有独立 package 身份），**不是"包越小越好"的证据**。DSH 最小的包 `util/brand` 只有 34 行运行时代码，但配了 7 个文件（package.json + tsconfig + 三份 README + spec）——这份样板开销它认了，因为它买到了可重组性。咱们没有这个需求。
>
> **读法二**：测试文件差 85 倍、门禁差 0→70，才是真正值得注意的结构差异。
>
> **读法三**：DSH 自己的根 `AGENTS.md` 也有漂移——Repository layout 块仍写着 `support/` 与 `self-modification/`，而实际目录早已改名 `test-support/` 与 `extensions/`。**这说明漂移是结构问题，不是纪律问题**：一个拥有 70 道门禁、1742 篇决策记录的仓库照样漂移，因为它恰恰**没有**为"根文档里手写的目录清单"加门禁。这直接支持 §5-F2 的方向。

### 2.2 六套可迁移机制

以下六条是 DSH 的**机制**（而非选型），逐条给出可迁移性判断。

#### 机制 1：能力边界用「三角色 seam」定义，而不是 TS `interface`

DSH 的定义（`docs/glossary.md#capability-seam`、`docs/architecture.md`）：

> A **seam** is a swappable capability with three roles: a **Service Definition** declaring the interface, a **Service Provider** implementing it, and a **Consumer** using it. A package may combine roles, but one role alone is not a seam; **adding a capability means designing all three**.

关键细节（最容易被忽略、但恰恰是咱们提案里缺的）：

- Service Definition **"never a TypeScript `interface`"**——必须是**抽象类或具体 registry**，因为它要持有服务键（`ctx.<key>`）与词表类型。TS `interface` 在运行时不存在，无法作为注入令牌。
- 依赖规则（`packages/README.md#dependencies`）：**"Extension plugins depend on Service Definitions, never concrete providers."**
- 完整的 seam 是**能力**，不是某一个角色；**"roles normally occupy separate packages when they evolve independently"**——拆包的判据是"角色是否独立演化"，不是行数。
- 配套有一张 **17 词的 class 角色词表**（`docs/cookbook/adding-a-package.md`）：Controller / Store / Directory / Presenter / Registry / Runtime / Resolver / Binder / Engine / Policy / Executor / Gateway / Provider / Backend / Handle / Config / Service，每个词都写明"何时用 / 何时不用"。例如 `Provider` 的定义是"为某个 capability definition 提供**一个**实现；当可能存在多个实现时加机制或厂商限定词"，反向排除条件是"它就是 capability definition、provider registry 或 consumer runtime"。

**为什么这条对咱们重要**：`architecture-todo.md` 的 A8/A9 已经写好了 DI 提案，但用的是 `interface`：

```ts
// ADR 0017 原提案（A8）
interface LocaleFetcher { fetchMessages(lang: string): Promise<Record<string, any>> }
interface LocaleCache   { get(key): Nullable<...>; set(key, messages): void }
```

这在**运行时不成立**——没有注入令牌，也没有"谁是 definition、谁是 provider"的物理边界。按 DSH 的模型重写，`@walnut/i18n` 应该拆成：

| 角色 | 落到咱们这里的形态 |
|------|-------------------|
| Service Definition | `@walnut/i18n` 导出一个 `abstract class WalnutI18nLocaleSource`（或具体 registry），持有 `Symbol` 注入键 + 词表类型 |
| Service Provider | admin 侧实现 `BackendLocaleSource`（调 `getI18nMsgAPI`）、`LocalStorageLocaleCache` |
| Consumer | 组件/`useAppI18n`，只依赖 definition |

**但要注意克制**：DSH 的三角色拆包之所以成立，是因为 `shell` 真的有 bash/pwsh × local/sandbox 四个实现。咱们的 `@walnut/i18n` / `@walnut/security` **短期内只会有 admin 一个消费者、一个实现**——按 DSH 自己的判据（"roles occupy separate packages **when they evolve independently**"），**这两个包不该拆成多包**，而应该各自一个包、内部用抽象类 + 注入键把"definition 可替换"这件事表达出来即可。

**可迁移性：高（作为概念模型），中（作为拆包动作）**。前提是咱们要先有一个「组合根」——见 §4.4。

#### 机制 2：把「文档」当代码管——生成物 + 门禁

DSH 的文档不是"写得好"，而是**机械保证不漂移**：

| 手段 | 具体机制 |
|------|---------|
| 生成物 | `gen-module-graph` / `gen-config-catalog` / `gen-tool-catalog` / `gen-persistence-catalog` / `gen-doc-graphs` / `gen-tsconfig-paths` / `gen-third-party-notices` —— 文件头写明 `Generated by ... do not edit by hand`，**新鲜度进 CI 门禁** |
| 链接 | `verify-md-links` 拒绝失效目标与失效 `#fragment` 锚点 |
| 排版 | `verify-md-wrap`（一段一物理行） |
| 类型 | `doc-typecheck`（**fenced `ts` 块必须能编译**）+ `verify-type-equiv`（粘贴的类型声明与源码逐字一致） |
| 预算 | `verify-doc-budgets` + `doc-budgets.manifest.json`（根 `AGENTS.md` ≤1950 词等） |
| 引用 | `verify-doc-refs`、`verify-subsystem-pages`、`verify-translation-pairing`、`verify-mermaid` |

**"一个事实一个家"的层级表**（`docs/AGENTS.md`）明确规定了每类事实的唯一归属：根 `AGENTS.md`（常驻规则）/ `architecture.md`（有序地图）/ `subsystems/`（逐子系统参考）/ Agent Notes（决策）/ `postmortem/`（事故）/ `cookbook/`（步骤）/ package README（逐包契约）/ 生成参考（禁止手改）。

**可迁移性：高，且是本次 review 认为收益最大的方向**。不需要 70 道门禁，从 3-4 道开始即可（§5）。

#### 机制 3：决策记录（Agent Notes）替代"带状态的 TODO"

DSH 把"为什么这样做"和"现在做到哪了"**物理分离**：

- **决策** → `.agents/notes/{lifecycle}/{class}/yyyy-mm-dd-topic.md`。两轴路径编码：生命周期四态（`proposed/` 未实现、`implemented/` 已发布**且必须随实际发布现实同步改写**、`rejected/` 保留至其理由不再防错、`archived/` 永久冻结且被 `.rgignore` 排除以免被当作当前权威）× 类型六类（feature / bug-fix / simplification / architecture / process / testing，闭集由脚本强制）。
- **格式是门禁**：`verify-agent-note-format` 校验固定骨架 `## Problem` / `## Decision` / 技术节 / **`## Alternatives considered`** / `## Consequences`，并**拒绝提案式标题**（"should…"）。其中 `## Alternatives considered` 是硬性必填，理由写得很直白：*"A decision recorded without what it beat invites re-litigation."*
- **写入是强制的**：*"Non-trivial changes MUST include an Agent Note in the same PR; only mechanical/local edits are exempt."*
- **状态** → 不进文档。`docs/AGENTS.md` 的 slop checklist 明确把 *"Implementation-status annotations in prose or diagrams ('implemented!', 'future: …')"* 列为反模式，理由是**"Status rots; the repo layout and package manifests carry it."**
- **延后工作** → 各 package README 的 `## Known Limitations and Deferred Work`（由 `verify-package-readme-limitations` 门禁要求，无内容者需进豁免清单）。
- **代码内待办** → `FIXME`/`TODO`/`XXX` 按紧急度区分语义。

**对照咱们**：`architecture-todo.md` 同时承载了四类内容——P0-P3 待办、✅/❌ 完成状态、按日期的执行记录、ADR 0017 剩余清单。这正是 DSH 定义的"状态会腐烂"的结构。而咱们的 ADR 其实已经是正确的形态（有 Status、有 Context/Decision/Consequences），**只是缺两样**：`## Alternatives considered` 的强制，以及"提案 / 已决 / 已否决"的生命周期分离（目前 17 篇 ADR 全是 Accepted，看不出哪些被否决过、哪些还在讨论）。

**可迁移性：高**。ADR 保留（它就是决策记录，形态没问题），但**状态与执行记录应该移出文档**。最小落地：给 `adr/` 加 `## Alternatives considered` 必填 + 一个 `Status` 枚举，暂不必引入 873 篇的规模。

#### 机制 4：源码面与产物面不混用

DSH 的硬规则（`docs/development.md:80`、根 `AGENTS.md`）：

> **Source plane vs artifact plane, never mixed.** Static analysis and tests resolve workspace imports through the base `paths` map to `src` and must pass on a clean tree; **gates that consume built `lib/` output declare that dependency explicitly.**

**这条直接命中咱们 ADR 0002 的一个已知隐患。** 咱们的 `exports` 把两个面**编码进了同一个 map**：

```jsonc
// ADR 0002：同一个包，不同消费者解析到不同源码
"exports": { ".": {
  "source": "./src/index.ts",      // Vite dev/HMR 读源码
  "types":  "./src/index.ts",      // IDE 读源码
  "import": "./src/index.ts",      // 前端读源码
  "require":"./dist/index.cjs",    // 后端读构建产物
  "default":"./dist/index.cjs"
}}
```

后果是：**前端看新代码、后端看旧产物**，而没有任何一道门禁会发现 `dist/` 相对 `src/` 已过期。咱们此前遇到的 fresh clone 下 `dev:server` 报 `MODULE_NOT_FOUND`、以及为此给 turbo `dev`/`test` 加 `dependsOn: ["^build"]`，根因正是这个。

DSH 的解法不是"双模 exports"，而是**让每个消费者显式声明自己在哪个面上**：静态门禁走 `paths → src`（干净树即可通过），消费 `lib/` 的门禁必须显式声明依赖。

**可迁移性：中高**（属于需要决策项，见 §5 第二档）。

#### 机制 5：单一真源 + 符号链接

DSH：`CLAUDE.md` 是指向 `AGENTS.md` 的 **9 字节符号链接**（`packages/CLAUDE.md` 同理）。根 `AGENTS.md` 154 行，每条规则 1-3 行 + 指向其归属文档的链接。

**对照咱们**：`CLAUDE.md`（194 行）与 `AGENTS.md` 是**两份独立文件、内容重叠、且已经不同步**——`AGENTS.md` 的包路径是当前的（`utils-core`、`tooling/` 三包），而 `CLAUDE.md` 仍写 `platform-any/utils/`，并引用已删除的 `migration-guide/`。

**可迁移性：高、成本极低**。这一条能**整类消灭**一种漂移，而不是逐个修。

#### 机制 6：不变量写成可执行的门禁，且门禁图在代码里

DSH 的门禁不是散落在 CI YAML 里的 `run:` 步骤，而是 `scripts/run-gates.ts` 里的一张**带依赖图的图**（`needs` / `after` / `allowFailure` / 环境变量），一份定义同时服务本地、Linux、Windows、自托管 failover。CI YAML 只剩一个 `all-checks-passed` 必需检查。

值得注意的取舍：**DSH 没有 affected 检测**，每个 PR 跑完整矩阵——用资源换"不会有漏跑的假绿"。这与咱们 `turbo --affected` 的取舍正好相反，两者**都对**，取决于规模与 CI 预算。

**可迁移性：低**（不必照搬门禁图实现）。但**其中一条子机制强烈建议采纳**：把"每道门禁的存在理由与依赖关系"写进代码而非 YAML。

---

## 3. 融合对比矩阵

| 维度 | Walnut Admin 现状 | DSH 做法 | 融合建议 |
|------|------------------|---------|---------|
| **包分组轴** | 按**运行平台**（platform-any / platform-web / tooling） | 按**能力族**（core / llm / fs / client / host …），平台语义另用验证门禁承载 | **保持现状**。12 个包用平台轴更直观；DSH 的能力族轴是 255 包规模下的产物 |
| **包命名** | 目录 `platform-web/ui` + 扁平名 `@walnut/ui` | 目录 `client/ui-primitives` + 名 `@deepseek-ai/dsh-client-ui-primitives` | 保持现状，但**把命名规则文档化**（目前分散在 ADR 0001 + 各文档） |
| **包粒度判据** | 无明确判据，靠 ADR 0017 的清单驱动 | **"Require a current owner and need"**——每个抽象必须绑定当前契约或生产消费者 | **采纳这条判据**，用它约束 A7/A8/A9 的拆分冲动 |
| **契约层** | `@walnut/contract`（515 行，手写 + 12 组快照测试） | `typert`（类型图生成 + 运行时 registry）+ `sdk`（JSON-RPC 协议）+ `snapshots/` | 契约**形态保持手写**（规模合适）；补**生成式契约目录**与跨端等价校验 |
| **消费者依赖规则** | turbo boundaries 5 条 platform deny 规则 | 三角色 seam + "依赖 Definition 而非 Provider" + 生成式 `capability-seams.md` | **补语义边界**：现有 tag 规则表达不了"只能依赖 seam 的 definition" |
| **运行时校验** | HTTP 边界用 class-validator；Zod 迁移暂缓 | **"Trust TypeScript at typed same-process boundaries"**——只在 wire/durable/config/queue 等边界校验；且**两套校验器按边界分工**（Schemastery 管配置、Zod 管域 schema） | **重述问题**：不是"Zod vs class-validator"，而是"**边界清单 + 每类边界由谁负责**"（§4.3） |
| **契约层形态** | 单一 `@walnut/contract` 前门 | **按边界分散的多个 protocol 包**（typert-protocol / sdk-protocol / hook-protocol / client-modules），加上一个 `api/remotes` 做"单一 specifier 前门" | 咱们的单前门是对的（规模小）；可补 DSH 的 **declaration merging 分域扩展**手法，避免 contract 变成巨石 |
| **测试替身** | 无共享测试工具 | `packages/test-support/` 一等 group（6 包：mock LLM 服务器、回放器、jsdom 测试台…） | 值得考虑建 `packages/testing`，但**前提是先有测试基数**（现仅 10 个测试文件） |
| **源码面/产物面** | 两面混编进 `exports`（ADR 0002） | 硬规则分离 + 门禁显式声明 | **需要决策**（§5 第二档） |
| **文档真源** | 7+ 处重叠：根 `CONTEXT.md`/`CLAUDE.md`/`AGENTS.md`/`README.md` + apps 各自一套 + docs 站 + 死目录 | `docs/` 唯一真源 → `website/` 只是构建期投影（`.generated/` 可丢弃） | **需要决策**：建立层级表，明确"一个事实一个家" |
| **AI 指引** | `.claude/skills/` 11 个 skill；根 `AGENTS.md` + `CLAUDE.md` 双份 | 根 `AGENTS.md` 唯一真源 + `CLAUDE.md` symlink + 子树 `AGENTS.md` + `.agents/notes` + `.agents/skills` | **采纳 symlink + 子树 AGENTS.md** |
| **测试** | 10 个测试文件 | 854 个，per-file 100% coverage 门禁 | 不必追求比率，但 10 个测试文件对一个 8.6 万行仓库是**结构性缺口** |
| **门禁** | 7 道（boundaries/lint/types:check/test/syncpack/knip + pre-push） | ~70 道 + 门禁图 | 从 **3-4 道文档门禁**起步（§5 第一档） |

---

## 4. 咱们的架构级问题

### 4.1 文档层（最严重，且全部为实测证据）

**问题 A：文档引用了已不存在的路径**

| 漂移内容 | 实测数量 | 位置 |
|---------|---------|------|
| `@walnut/axios` / `packages/axios`（已改名 `@walnut/http`） | **34 处** | `industry-research/07`（7 处）、`adr/0001,0004,0005,0009,0010,0011,0013`、`adr/0017`（多处） |
| `packages/utils/`（现为 `packages/platform-any/utils-core/`） | **12 处** | `industry-research/04-testing-strategy`（4 处）、`adr/0015-testing-strategy`、`adr/0017`（多处） |
| `migration-guide/`（**目录已不存在**） | **4 处** | 根 `CLAUDE.md:84,130`、`README.md:34,68` |

> ADR 里的引用部分属于"改名决策的历史记录"，可以豁免；但 `07-fullstack-architecture.md` 是**描述当前架构的活文档**，它把 `@walnut/axios` 当作现状（§9 映射表、依赖方向图、代码示例），这就是纯漂移。

**问题 B：存在不被任何机制渲染的重复文档树**

| 目录 | md 数 | 状态 |
|------|-------|------|
| `apps/docs/src/zh-CN/` | 133 | ✅ 活的（`srcDir: 'src'`） |
| `apps/docs/src/en-US/` | 62 | ✅ 存在（locale 注册被注释掉：`config/index.ts:15`） |
| `apps/docs/zh-CN/` | 94 | ❌ **死的**，不在 `srcDir` 下 |
| `apps/docs/en-US/` | 62 | ❌ **死的** |

共 **156 个不被渲染的 md 文件**。它们与活文档同名同构，任何"我在改文档"的判断都可能改错一份。

**问题 C：架构/上下文文档散落且互相重叠**

根级就有 6 份：`AGENTS.md`、`CLAUDE.md`、`CONTEXT.md`、`README.md`、`TODO.md`、`changelog-latest.md`；`apps/server/` 又来一套（5 份）；另有 `apps/docs/CLAUDE.md`、`apps/admin/.../AI/docs/`（5 份）、根 `docs/superpowers/{specs,plans}/`（2 份）。

其中 **`CONTEXT.md` 已过期**：它把 `@walnut/axios` 当作现存包，且完全没有提 `@walnut/types` / `@walnut/ui` / `tooling/*` 三包，也没有反映 platform 分组。

**问题 D：存在与已接受 ADR 冲突、且全仓无人引用的报告**

`apps/server/docs/lib-extraction-recommendations.md`（339 行）给出 24 个抽取候选与推荐顺序，提议产出 `@walnut/als`、`@walnut/mask`、`@walnut/mailer`、`@walnut/cache`、`@walnut/crud` 等。实测：

- **全仓零引用**（grep `lib-extraction-recommendations` 无命中），不在文档站、不在任何索引里；
- 它用 **`@walnut/*` 命名 backend 内部 lib**——而 `@walnut/*` 是**前端包命名空间**。CLAUDE.md 明确记录过：两个 scope 的物理分离是为了"prevent silent misresolution"（commit `609722b` 修的就是这个碰撞）。若照此报告实施，等于把已修复的命名碰撞重新引入。
- 它与 **ADR 0007**（"backend libs 保持 NestJS CLI internal libraries，不提升为 workspace 包"）的关系没有任何说明。

**问题 E：状态与事实混在一起**

`architecture-todo.md` 的「执行记录」表按日期堆叠完成项（14 行），P0-P3 表格内嵌 ✅/❌ 状态，ADR 0017 段落又维护一份 A1-A11 状态。三处状态需要手工同步——**而它们已经不同步过**（文档自己的执行记录里就写着"A4 表格勾选（执行记录早已完成，表格漏更）"）。

### 4.2 边界层

现有 turbo boundaries 只有 **5 条 platform deny 规则**（`monorepo/turbo.md:104-109`）：

```
shared        → deny app
backend       → deny platform-web
platform-any  → deny platform-web, platform-node
platform-node → deny platform-web
```

这能挡住"后端 import 前端包"这类**平台级**违规（已实测有效）。但挡不住三类**语义级**违规：

1. **依赖了 Provider 而非 Definition**——一旦 `@walnut/i18n`/`@walnut/security` 按 seam 模型拆出 provider，tag 规则无法表达"admin 只能用 definition"。
2. **app 内部的分层**——`views → components → stores → api → http → contract` 这条 `monorepo/index.md` 里画的依赖方向，**没有任何机制强制**。admin 的 644 个文件里，API 层 import store、组件直连 API 都不会被拦下。
3. **server 内部的 lib→app 反向依赖**——`libs/exceptions/src/exception.filter.ts` 从 `apps/api/src/` import（ADR 0017 §10 已记录为"方向错误"），至今**无门禁**。

对照 DSH：它用 `verify-client-domain-graph`、`verify-package-dependencies`、`verify-runtime-closure` 等**从源码 import 事实反推**的验证器承担这类工作，而不是靠 tag 声明。

### 4.3 契约与验证层

`07-fullstack-architecture.md` 把问题定义为"**Zod vs class-validator**"，并推荐 Zod 统一。这个框架**问错了问题**——它在问"用哪个库"，而真正决定正确性的是"**在哪些边界做运行时校验**"。

DSH 给出了一条可直接借用的判据（根 `AGENTS.md`）：

> **Trust TypeScript at typed same-process boundaries.** Do not add runtime validation... **validate at parser/config, queued, model/tool JSON, durable/file, worker, process, and wire boundaries.**

映射到咱们（NestJS + Vue + MongoDB）：

| 边界 | 是否需运行时校验 | 现状 |
|------|----------------|------|
| HTTP wire（前端→后端） | ✅ 必须 | class-validator 已覆盖 |
| **持久化/反序列化（Mongo 文档读回、localStorage 迁移）** | ✅ 必须 | `utils/persistent/migrate.ts` 有版本迁移，但**读回数据没有 schema 校验** |
| **配置/env** | ✅ 必须 | ✅ 已有（dotenvx + validation class） |
| **队列消息（Bull）** | ✅ 必须 | ⚠️ 未见校验 |
| **SSE / Socket 线上格式** | ✅ 必须 | ⚠️ 未见校验 |
| 同进程已类型化的函数边界 | ❌ **不应加** | ✅ 现状正确 |

**结论**：Zod 迁移（P3-12）的收益被高估了——它解决的是"前后端共用一份 schema"，而咱们真正的校验缺口在**持久化读回 / 队列 / SSE** 这三处，那里用 Zod 还是 class-validator 甚至手写守卫都行。**建议把 P3-12 从"Zod 替换 class-validator"重述为"补齐边界校验清单"。**

**补充证据（DSH 的实际做法）**：DSH **同时使用两套校验器，且分工清晰**——

| 校验器 | 用在哪 | 特征 | 用量 |
|--------|--------|------|------|
| Schemastery（自研，vendored） | **插件 Config / 配置声明** | class-based、可 `new`、**可序列化到 JSON 再在另一环境 hydrate**、`simplify()` 写回时剔除默认值 | 122 个源文件 |
| Zod | **运行时域 schema + JSON Schema 投影** | function-based `.parse()`、生态与 JSON Schema 强 | 36 个源文件 |

两者通过 **Standard Schema** 标准接口桥接（`~standard` 属性），因此 Cordis 只认标准而不绑定实现。

**这条对咱们的直接启示**：DSH 并没有追求"统一成一个校验器"，而是**按边界种类分工**。咱们不必把 class-validator 换成 Zod，而应该回答"每类边界由谁负责校验"——class-validator 继续守 HTTP wire，Zod（或手写守卫）守持久化 / 队列 / SSE。这样 P3-12 的工程量从"100+ DTO 类迁移"降到"补 3 处边界校验"。

另：`@walnut/contract` 有 12 组快照测试（好实践），但没有 **"契约变更必须同步所有消费者"** 的机制。DSH 的对应规则是："Public APIs are pre-stable; **update every consumer**"。咱们 A5 的"server 侧 44 个 controller 待迁"正是缺这条机制的后果。

### 4.4 前端组合根缺失

这是 A8/A9 真正的**前置阻塞**，而 ADR 0017 没有把它识别出来。

后端有 NestJS 的 DI 容器作为组合根。**前端没有**——`@walnut/client`、`@walnut/http`、`@walnut/ui` 都是"被 import 的库"，而抽 `@walnut/i18n`（依赖后端 API + store）和 `@walnut/security`（依赖 store + 加密 key）时，**必须有人来回答"实现从哪里注入"**。

DSH 的答案是有 `ctx`（Cordis 的 context）作为显式组合根，插件在 `apply(ctx)` 里注册。咱们的等价物目前是**散落的隐式全局**：`main.ts` 里 `app.use(store)`、`setupI18n()`、以及 auto-import 提供的隐式全局。

**这不是"要不要引入 DI 容器"的问题**（前端引入容器通常得不偿失），而是**要显式定义一个组合根**。DSH 的配套原则正好适用（根 `AGENTS.md`）：

> **Explicit > implicit at package boundaries**: defaulting is an explicit `resolve(request): Spec` step in the owning implementation, never a hidden `?? default` inside `run()`.

值得区分的是 **DSH 的 `ctx` 是"声明式依赖 + 服务定位器"的混合，而非构造函数注入的 DI 容器**：`inject` 只决定"服务齐了才加载"（加载门控），取值仍走 `ctx.<key>` 按键查找。它换来的是 `isolate()` / `intercept()` 这种"上下文继承链"能力——这正是它能做到"每个会话一套能力"的原因。**咱们不需要这个能力层次**，需要的是它更朴素的那半句：**包边界上的默认值必须显式**。

可行的最小形态：一个 `createWalnutApp(options)` 工厂（或 bootstrap 时的一次性 `configureWalnut({ locale, crypto, http })` 调用），把 provider 显式传进去。**是否值得做，是 §5 第二档的决策项。**

### 4.5 门禁层

| | Walnut Admin | DSH |
|---|---|---|
| 代码门禁 | boundaries / lint / types:check / test / syncpack / knip | ~70 道（含 publint、jscpd 重复检测、runtime closure、install layout、optional dep imports…） |
| 文档门禁 | **0** | ~15 道（md-links / md-wrap / doc-budgets / doc-typecheck / type-equiv / doc-refs / translation-pairing / mermaid…） |
| 生成脚本 | **0**（`scripts/` 只有 `setup-env.ts`） | 30+ 组 gen/verify |
| 测试文件 | 10 | 854 |

**关键不是数量，是方向**：咱们的门禁**全部朝向代码**，文档侧完全是手工纪律。§4.1 的每一处漂移都是这个空白的直接后果。

### 4.6 ⚠️ 两个"文档化的机制"实测从未生效（本次 review 最有力的实证）

§4.5 说"我们缺门禁"还只是抽象论断。下面两条把它变成了**可复现的实例**：仓库把某项约束写进了架构文档、列为关键设计决策，**但它实际上从未生效，而且没有任何机制会发现这件事**。

#### 发现 1：`pnpm-workspace.yaml` 的 `hoisting: false` 是不合法的键，隔离从未生效

`pnpm-workspace.yaml:12` 写着 `hoisting: false`，`monorepo/index.md` 把它列为**关键设计决策 №4**：

> **hoisting: false**：严格依赖隔离——每个包只能 import 自己声明的依赖。

`monorepo/pnpm-workspace-config.md` 还用一整节论述它的语义与效果。

**核查 1（官方文档）**：pnpm 官方 settings 页的 *Dependency Hoisting Settings* 分组下，合法选项是
`hoist` / `hoistPattern` / `publicHoistPattern` / `hoistWorkspacePackages` / `shamefullyHoist` / `hoistingLimits`
——**没有 `hoisting`**。关闭提升的正确写法是 `hoist: false`（[pnpm Settings](https://pnpm.io/settings)）。

**核查 2（实测，决定性）**：`hoist: true`（pnpm 默认）的可见特征是依赖被提升到 `node_modules/.pnpm/node_modules/`。实测该目录：

```
node_modules/.pnpm/node_modules  条目数 = 1647
```

**1647 个条目**——这正是默认 `hoist: true` 的产物。**若 hoisting 真被关闭，该目录应为空或仅含 workspace 内部链接。**

**结论**：该配置项是无效键，被 pnpm 忽略，实际行为等于默认的 `hoist: true`。「严格依赖隔离」这条关键设计决策**目前不成立**，幻影依赖（phantom dependency，即包 import 了未在自己 `package.json` 声明的依赖）在物理上是可能的。这也意味着 `knip` 之类工具报出的"未声明依赖"问题可能一直被这个假象掩盖着。

#### 发现 2：`.npmrc` 的 5 条 `public-hoist-pattern[]` 同样未生效

根 `.npmrc` 有：

```ini
public-hoist-pattern[]=*turbo*
public-hoist-pattern[]=*eslint*
public-hoist-pattern[]=*simple-git-hooks*
public-hoist-pattern[]=*@swc*
public-hoist-pattern[]=*esbuild*
```

`pnpm-workspace-config.md` 把它们描述为"5 个工具链包需要在 `.npmrc` 中通过 `public-hoist-pattern` 提升到根 `node_modules`"的**例外机制**。

**核查**：pnpm 官方文档明确写着——

> Only auth and registry settings are read from `.npmrc` files. All other settings (like `hoistPattern`, `nodeLinker`, `shamefullyHoist`, etc.) **must be configured in `pnpm-workspace.yaml`**.

**实测对照**（根 `node_modules` 的非点目录共 18 个）：

| 包 | 在根 `node_modules`？ | 在 `.pnpm/node_modules`？ | 是根 package.json 直接依赖？ | 判定 |
|----|:---:|:---:|:---:|------|
| `turbo` | ✅ | ❌ | ✅ devDependencies | 来自直接依赖，**非** pattern 生效 |
| `eslint` | ✅ | ❌ | ✅ devDependencies | 同上 |
| `simple-git-hooks` | ✅ | ❌ | ✅ devDependencies | 同上 |
| `@swc` | ❌ | ✅ | ❌ | **pattern 未生效** |
| `esbuild` | ❌ | ✅ | ❌ | **pattern 未生效** |

**结论**：`@swc` 与 `esbuild` 未出现在根 `node_modules`，说明 `public-hoist-pattern` 未起作用；`turbo`/`eslint`/`simple-git-hooks` 的出现另有原因（它们是**根 package.json 的直接依赖**），与该机制无关。这 5 条规则很可能在 pnpm 10+ 把非 auth 设置迁出 `.npmrc` 之后就已成为死配置。

#### 这两条发现为什么重要

它们不是孤立的配置 bug，而是**本次 review 核心论点的实证**：

1. **"文档描述了一个约束" ≠ "约束存在"**。两条都被写进架构文档、被视为设计决策，却都没有任何验证手段。DSH 的 `verify-config-source-ownership`、`verify-package-dependencies`、`verify-runtime-closure` 这类门禁要解决的正是这件事。
2. **§4.1 的文档漂移只是症状，这是同一个病的另一个症状**。文档漂移是"文档说了假话"，配置失效是"配置没说上话"——根因都是**声明与现状之间缺少机械校验**。
3. **它顺手解释了一个此前的疑点**：`monorepo/index.md` 声称的"每个包只能 import 自己声明的依赖"，与 `architecture-todo.md` R2 里"knip 的 `ignoreDependencies` 已膨胀至 80+ 条集中豁免、掩盖真实死依赖"是互相矛盾的——如果隔离真的生效，这么多豁免本身就不该存在。

**修正建议**（属第一档，成本极低）：
- 把 `hoisting: false` 改为 `hoist: false`，然后**跑一次全量 `pnpm install` + `pnpm build` + `pnpm test` 验证是否暴露未声明依赖**——这一步可能牵出一批真实的幻影依赖，建议单独排期而不是顺手改。
- 把 `.npmrc` 的 5 条 `public-hoist-pattern[]` 迁到 `pnpm-workspace.yaml` 的 `publicHoistPattern`，或确认它们已无必要后删除。
- 无论结论如何，`monorepo/pnpm-workspace-config.md` 那一节必须按**实测结果**重写。

> **➡️ 已升级为正式迁移计划**：[pnpm 12 升级 + 依赖隔离修复迁移计划](2026-09-21-pnpm12-and-hoist-migration-plan.md)。
> 后续实测又发现一条**硬性顺序约束**：pnpm 12 在项目有版本 pin 的情况下，会把未识别的 `pnpm-workspace.yaml` 键从警告升级为**硬失败**（`ERR_PNPM_UNRECOGNIZED_WORKSPACE_SETTINGS`）。因此**修复 `hoisting` 是升级 pnpm 12 的前置条件，不是可选项**。

---

## 5. 优化建议

分三档。**本档位划分即建议的执行顺序**，第一档可独立于第二档先行。

### 第一档：机制补位（无需架构决策，纯增益）

| # | 建议 | 依据 | 直接解决 |
|---|------|------|---------|
| **F0** | **修正 `hoisting: false` 并实测其后果**（详见 §4.6）：改为合法的 `hoist: false`，然后全量 `pnpm install` + `build` + `test` 验证会暴露多少未声明依赖；同时把 `.npmrc` 的 5 条 `public-hoist-pattern[]` 迁到 `pnpm-workspace.yaml` 或确认可删。**建议单独排期，因为它可能牵出一批真实的幻影依赖需要逐个补声明** | §4.6 实测 | 一条被列为「关键设计决策」却从未生效的约束 || **F1** | **`CLAUDE.md` → `AGENTS.md` 的符号链接**（Windows 无 symlink 权限时退化为一行 include 说明） | DSH 机制 5 | 整类消灭双份漂移；当前两份已不同步（`platform-any/utils` vs `utils-core`、`migration-guide`） |
| **F2** | **补 4 道文档门禁**：① `verify-md-links`（失效链接/锚点）② `verify-doc-refs`（拒绝引用已不存在的路径，如 `migration-guide/`）③ `doc-typecheck`（fenced `ts` 块必须编译）④ 一个最小的 `gen-package-catalog`（从 `package.json` 生成包清单，替代 3+ 处手写） | DSH 机制 2 | §4.1 问题 A、C、E 的**根因**——它们不是"改一遍就好"，而是没有机制阻止复发 |
| **F3** | **删除 156 个不被渲染的重复文档**（`apps/docs/{zh-CN,en-US}/`），或明确其用途 | 实测 | §4.1 问题 B |
| **F4** | **裁决 `lib-extraction-recommendations.md`**：或废除，或把结论折进 ADR 0007（并把其中的 `@walnut/*` 命名改为 `@walnut-server/*`） | 实测 + ADR 0007 | §4.1 问题 D——一份会误导实施的孤儿报告 |
| **F5** | **状态移出文档**：`architecture-todo.md` 只保留"未完成项"，完成项移入 commit / 发版说明；ADR 0017 内的 A1-A11 状态表与 arch-todo 二者留一 | DSH 机制 3 | §4.1 问题 E |
| **F6** | **ADR 规范化**：`adr/` 补 `## Alternatives considered` 必填 + `Status` 枚举（Proposed / Accepted / Rejected / Superseded）。现有 17 篇全是 `Accepted`，看不出哪些被否决过 | DSH 机制 3 | 决策记录的可追溯性；是 F1-F5 之外成本最低的一条 |
| **F7** | **字数上限门禁**（`verify-doc-budgets` 最小版）：只给根 `AGENTS.md` / `CLAUDE.md` / `monorepo/index.md` 定上限，超限即失败 | DSH 机制 2 | 防止文档再次膨胀成多事实混居。**优先级最低**——DSH 的字数预算是"数百包 + 全天候 AI 协作"的产物，咱们先从根文档试一条即可 |

### 第二档：需要决策（架构级，建议先讨论再动）

| # | 议题 | 选项 | 倾向 |
|---|------|------|------|
| **D1** | **`@walnut/i18n` / `@walnut/security` 的 seam 形态** | (a) 按 ADR 0017 原方案，用 TS `interface`；(b) 按 DSH 三角色模型，Definition 用 abstract class + 独立 provider 包 | **(b)**。`interface` 无运行时令牌，且无法表达"依赖 definition 而非 provider" |
| **D2** | **前端组合根** | (a) 维持现状（隐式全局 + bootstrap 调用）；(b) 显式 `createWalnutApp(options)` 工厂；(c) 引入轻量 DI 容器 | **(b)**。(c) 对本案过重；(a) 会让 A8/A9 无法落地 |
| **D3** | **源码面 / 产物面分离** | (a) 维持 ADR 0002 双模 `exports`（+ 补一道"dist 过期"检测）；(b) 学 DSH，让消费者显式声明所在面 | **先 (a) + 检测**。全量改 (b) 的代价大，而加一道 fresh-check 就能消掉主要风险 |
| **D4** | **ADMIN 内部分层是否入门禁** | (a) 不加，靠 review；(b) 加语义边界检查（`views → components → stores → api → http → contract`） | **(b)**，但先只加一条最贵的：**API 层不得 import store** |
| **D5** | **`@walnut/ui` 的迁移范围** | (a) 按 ADR 0017 迁 22 个组件；(b) 只迁"零 app 依赖 + 已被 ≥2 处复用"的组件，其余留在 admin | **(b)**。用 DSH 的 "Require a current owner and need" 判据过滤，避免为迁而迁 |
| **D6** | **A5 剩余 server 侧 44 个 controller 的迁移方式** | (a) 手工逐个改；(b) 写 `gen-route-catalog`（扫 `@Controller` + `contract/routes`）+ `verify-route-parity`，一次性发现全部差异 | **(b)**。把 44 次手工劳作变成 1 个生成器 + 1 道门禁 |
| **D7** | **R7 TS 7 排期与阻塞面评估** | 原 P3「远期」 | **升级到 P2 并先做一次实测评估**。TS 7.0 已于 2026-07-08 [正式发布](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)；`apps/server/tsconfig.json` 未显式声明 `moduleResolution`（`module: commonjs` 使其落到默认 `node10`），且 `tsconfig.base.json` 的 `ignoreDeprecations: "6.0"` 在 7.0 下失效。**先跑一次 TS 7 全量 `types:check` 摸清阻塞面，再定排期** |
| **D8** | **后端验证策略是否改用 NestJS 12 的 Standard Schema** | (a) 维持 class-validator；(b) 新模块用 Standard Schema，存量不动；(c) 全量迁移 | **先 (b)**。NestJS v12 已官方支持 Standard Schema，且同一 schema 可驱动 OpenAPI——`industry-research/07` 里"手写 ZodValidationPipe"的示例已过时。但按 §4.3 的边界分析，**迁移的真正价值不在"统一校验器"，而在"能否顺便把持久化/队列/SSE 三处缺的边界校验补上"**——如果补不上，这次迁移就不值得做 |

### 第三档：明确不建议照搬

| DSH 做法 | 为什么不建议 |
|---------|-------------|
| **oxlint 全量替代 ESLint** | DSH 是 React（`apps/web` 依赖 `react`/`@vitejs/plugin-react`）。咱们是 Vue SFC，oxlint 的官方框架支持仍在 [RFC 阶段](https://github.com/oxc-project/oxc/discussions/21936)。R15 的"暂不引入"结论应保留，只修正措辞 |
| **移除 pnpm catalog，改自研依赖门禁** | DSH 需要管 peer/optional + host/client face 差异，且它能写 445 行脚本来做。咱们的 248 依赖用 catalog 是**更低成本的正确解** |
| **自研 release families 替代 changesets** | 需要 445 行脚本 + 自建 pack/verify-packed-install CI 通道。两组 fixed 的 changesets 对咱们足够 |
| **per-file 100% coverage 门禁** | DSH 为此在 `vitest.config.ts` 里积累了几十行带 TODO 的豁免路径——它自己把这个技术债写进了配置。**不建议在测试基数只有 10 个文件时引入** |
| **门禁图写在 TS（`run-gates.ts`）** | 272 个 workspace 项目、4 个平台矩阵才需要。咱们 12 个包用 turbo + GitHub Actions 更划算 |
| **无 affected 检测、每 PR 跑全量** | DSH 有 self-hosted failover 与付费池来承担成本。咱们应保留 `turbo --affected` |
| **255 个包的细粒度** | 那是"运行期可重组"这个产品需求倒推出来的形态，不是通用最佳实践。最小包 `util/brand` 只有 34 行运行时代码却要配 7 个文件 |
| **vendor 自维护框架层** | DSH 把 cordis/cosmokit/schemastery 等 9 个包复制进仓库自维护（`vendor/README.md`：*"so that the harness fully owns its framework layer (auditable, patchable, pinned)"*），并积累了 19 条本地改动——**因为它已经产生了上游没有的语义**。咱们没有任何一个依赖处于这个状态 |
| **每包 README 的 Model Experience / 字数预算 / `verify-type-equiv`** | 这些是 255 包 + AI 代理全天候协作的产物。咱们可迁移的 20% 是"每个 package 写明职责/配置/扩展点/已知限制"这一条规则，其余不必 |
| **1310 个文档 i18n 配对记录 + 自定义 merge driver** | 咱们的英文文档实际已被注释掉（`apps/docs/.vitepress/config/index.ts:15`）。**先决定"要不要英文站"，再决定要不要配对机制** |

---

## 6. 建议的文档架构（方案，待评审后实施）

融合 DSH 的层级表与咱们的实际结构，建议的「一个事实一个家」：

| 层 | 归属 | 承载什么 | 不承载什么 |
|----|------|---------|-----------|
| **常驻规则** | 根 `AGENTS.md`（唯一真源，`CLAUDE.md` symlink） | 每条 1-3 行的纪律 + 指向其归属的链接 | 教程、示例、状态、从属文档已述的内容 |
| **架构地图** | `apps/docs/.../monorepo/architecture.md`（新建，由 `monorepo/index.md` 升格） | 仓库形态、包分层、依赖方向、**"我要加 X 该去哪"决策表** | 逐包细节（→ 包 README）、决策理由（→ ADR）、状态标注 |
| **术语表** | `apps/docs/.../monorepo/glossary.md`（新建，吸收根 `CONTEXT.md`） | 每个概念一个规范术语 + 定义 | 实现细节 |
| **子系统参考** | `apps/docs/.../monorepo/subsystems/*.md` | 逐包/逐 app：契约、配置、扩展点、**已知限制** | 行为叙述（→ architecture.md） |
| **决策记录** | `apps/docs/.../adr/*`（**保留现有形态**） | 为什么、放弃了什么、验证要求 | 迁移计划、验收清单、"待办" |
| **延后工作** | 各包 `README.md` 的 `## Known Limitations and Deferred Work` + 根 `TODO.md` | 每个包自己的缺口 | 全局状态汇总 |
| **生成参考** | `gen-package-catalog` / `gen-route-catalog` / `gen-env-catalog` 的产物 | 包清单、路由对照、env 变量表 | 任何手改 |
| **行业调研** | `apps/docs/.../industry-research/*`（保留） | 业界共识 + 差距分析 | 本项目现状断言（→ architecture.md） |

配套三条纪律（直接来自 DSH，措辞已本地化）：

1. **文档描述当前状态，不描述变更历史。** 不写"曾用/现已/不再"、不写 commit/PR、不写 ✅ 状态——变更故事留在 commit、ADR 与发版说明里。
2. **一处事实一个家。** 同一个规则出现在两处即为缺陷；grep 一个特征短语即可发现。§4.1 的问题 A/C/E 都是违反这条的后果。
3. **可机械检查的引用用相对 Markdown 路径，不用裸文件名。** 由 F2 的门禁强制。

---

## 附录 A：本次 review 的证据来源

| 类型 | 来源 |
|------|------|
| 本仓实测 | `architecture-todo.md`、`monorepo/index.md`、`monorepo/turbo.md`、`monorepo/pnpm-workspace-config.md`、ADR 0002/0007/0017、`industry-research/07`、根 `CLAUDE.md`/`AGENTS.md`/`CONTEXT.md`、`pnpm-workspace.yaml`、`.npmrc`、`apps/server/tsconfig.json`、`apps/server/docs/lib-extraction-recommendations.md`、`apps/docs/.vitepress/config/*`、`node_modules/` 实际布局、grep/计数 |
| DSH 一手 | `AGENTS.md`、`packages/README.md`、`packages/AGENTS.md`、`docs/AGENTS.md`、`docs/architecture.md`、`docs/glossary.md`、`docs/development.md`、`docs/subsystems/README.md`、`docs/capability-seams.md`、`docs/module-graph.md`、`.oxlintrc.json`、`scripts/` 清单、`vendor/README.md`、`apps/*/package.json`、`packages/client/*` |
| 联网核实 | [pnpm Settings](https://pnpm.io/settings)（hoisting 合法键）、[TypeScript 7.0 发布公告](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)、[NestJS 12 Standard Schema roadmap](https://www.infoq.com/news/2026/04/nestjs-12-roadmap-esm/)、[oxlint 框架支持 RFC](https://github.com/oxc-project/oxc/discussions/21936)、[Vitest projects](https://vitest.dev/guide/projects)、tsdown、Turborepo remote cache |

## 附录 B：配套文件

| 文件 | 内容 |
|------|------|
| **本文** | 架构层面 review：机制提炼、边界与治理问题、优化建议（F0-F7 / D1-D8 / 不建议照搬）、文档架构方案 |
| [2026-09-21-industry-research-audit.md](2026-09-21-industry-research-audit.md) | 配套的**调研文档逐篇审计**：20 篇文档（industry-research 8 + monorepo 12）的逐篇摘要与差距项、29 条第三方链接清单、55 条决策清单（每条注明依据）、10 条时效性核实明细 |
| [2026-09-21-pnpm12-and-hoist-migration-plan.md](2026-09-21-pnpm12-and-hoist-migration-plan.md) | **F0 的落地计划**：pnpm 11 → 12.5.1 升级 + 依赖隔离修复的分阶段执行方案（含顺序约束、验证步骤、回滚方案、工作量估算） |

> 三份文件都是**review / 计划产物**。它们曾临时放在仓库根 `docs/reviews/`，2026-09-23 随文档整理统一迁入文档站 `content/archive/`（根 `docs/` 目录已移除）。

## 附录 C：与 `architecture-todo.md` 的关系

本文**不替换** `architecture-todo.md`，两者分工如下：

- **本文**：架构层面的 review 与优化方向（机制、边界、文档治理）。
- **`architecture-todo.md`**：既有的 P0-P3 / A1-A11 / R1-R11 待办清单，其中**大部分仍然有效**（A7/A8/A9/A10/A11 的剩余项、R2-R4/R6-R8/R10-R11）。

本文与它的**冲突与修正**共四处：

| # | 条目 | 处理 |
|---|------|------|
| 1 | R7（TS 7 准备） | 排期从 P3 上调至 P2，且**先做一次阻塞面实测**（§1.3 #2、D7） |
| 2 | P3-12（Zod 替换 class-validator） | 前提已变（NestJS 12 官方支持 Standard Schema），应重开评估；同时按 §4.3 重述为"补齐边界校验清单" |
| 3 | P3-15（oxlint/biome） | 结论保留，措辞从"都不支持 Vue SFC"改为"无官方支持，第三方插件可用但不成熟" |
| 4 | P3-14（Vitest 共享 preset） | 技术基线更新为 Vitest `projects` 配置 |

其余条目为**补充关系**——F0-F7 是新增的机制补位（其中 **F0 优先级最高**），D1-D8 是新增的决策项。

按 §5 第三档的"明确不建议照搬"清单，`architecture-todo.md` 中 P3-15（oxlint/biome）应保留但修正措辞，P3-14（Vitest preset）的基线应更新为 `projects`。
