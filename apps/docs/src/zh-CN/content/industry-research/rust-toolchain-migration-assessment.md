# Rust 化工具链迁移：考量与风险评估

> **定位**：回答「把 lint / 格式 / 类型检查 / 构建 / 共享包打包一层层换成 Rust 工具（oxlint、oxfmt、tsdown、TypeScript 7、tsrs）在本仓有多可行、风险落在哪」。本篇只做**判定与风险**，不做排期。
> **读者**：要决定迁移节奏的仓库所有者；按计划执行各阶段的 agent。
> **权威边界**：本篇是 **2026-11-27 的 as-of 快照**。外部世界的版本与能力以当日查到的官方页面为准（链接见第 12 节），仓库侧事实以代码与当日实测为准 —— 两者冲突时以代码为准。阶段怎么走见[阶段性迁移计划（草案）](../plans/rust-toolchain-migration-plan.md)。

## 1. 元信息

| 项 | 值 |
|----|----|
| 调研日期 | 2026-11-27 |
| 分支 | `feat/rust-toolchain-migration` |
| 调研方法 | 四个来源并行：① 仓库盘点（读配置、门禁、脚本，不下迁移结论）② 外部查证（官方文档 / 博客 / issue / release，逐条标日期）③ **单点实测**（用真实 `apps/server` 代码跑 `typescript@7.0.2` 与 `tsrs`，见 5.4 / 5.5）④ **全仓实测**（16 份 tsconfig 逐份跑 tsrs，见 5.6）与 SFC 方案逐条核实（见 5.7）。此外逐仓抓了九个真实仓库的默认分支配置（见第 6 节），**没有**依赖任何「采用名单」 |
| 口径 | 版本号一律是**当日快照**，不是长期承诺；上游「没有明确支持」写成「未支持」而不是「不能」；仓库侧每条结论都能用文中的路径或命令复核；实测数字随代码增长会变，引用时看判据不看绝对值 |
| 一条教训 | 初版评估把 TS7 整体判为「本仓主路径不可用」。实测后收窄为：**检查侧可用、装配侧被守卫挡死**。这条自我更正保留在文中，作为「判定必须能被实测推翻」的例子 |

## 2. 结论速览

**总判定：迁移可行，但不是一次性切换，而是分轨道推进；四条轨道里，「引擎全面 TS7」是唯一需要先做 PoC 的一步。**

| 轨道 | 内容 | 一句话状态 |
|------|------|------------|
| A · 构建收尾 | Vite 8 + Rolldown | **已完成大半**：本仓已经在 Rolldown 上，剩版本升级与几处回归 |
| B · 工具链落地 | Oxfmt **正式接入**（lint-staged + CI 阻断）、Oxlint 双轨、tsdown 试点 | 组件可用；oxfmt 不再等 1.0，代价是首轮大 diff |
| C · 检查侧快查 | tsrs 影子 → 整批转正（server + packages 的 `types:check`） | server 实测 0 错误 / 4.28s；#1114 只跟踪不加双跑门禁 |
| D · 引擎全面 TS7 | TNB 作为 `typescript` 包面全局接入（classic API 外壳 + tsgo 7.0.2 引擎）+ tsrs 快查；**nest-on-TNB PoC 先行** | 已拍板；最大未知是 nest CLI 能否跑在 TNB 上 |

六条已拍板的决策（2026-11-27，详见第 10 节与 §11）：stylistic 彻底拆分给 oxfmt；oxfmt 直接进阻断门禁（锁 0.80.0）；TNB「量了就迁」；#1114 不加双跑门禁；`check-pre-hooks` 配置化；**引擎全面 TS7**（TNB 外壳 + tsrs 快查），双别名方案作废。

**最重要的三条风险**：

1. **「引擎全面 TS7」的成败押在 nest-on-TNB 上**。引擎侧已经实测可用（server `tsc --noEmit` 0 错误、零改动），裸装 `typescript@7` 的两个断点（nest CLI 守卫 exit 1、vue-tsc 的 peer `<7`）也由 TNB 的 classic API 外壳理论上覆盖；但 **TNB 的官方支持矩阵没有验证 `nest build` / `nest start --watch`**，这是整条轨道唯一的未知。所以 PoC 必须先行，且失败时只把 nest 侧单独回退到 stock TS6。同时 tsrs 有约 1% 的随机失败（#1114），团队已决定只跟踪、不加双跑门禁 —— 影子期的「时长 + 诊断 diff」就是它的兜底。
2. **共享包的 CJS 双模 exports 与 barrel 语义是语义雷区**。`@walnut/contract` 的 `exports` 条件、`dist/index.cjs` 被手写 barrel 覆盖、后端大量 `require` 消费面，这三件事任何一件在打包器迁移中走样，都不会在类型检查里报错，而是在运行时或某个冷门入口上静默坏掉。
3. **门禁三表与钉死测试的同步纪律比工具本身更容易出事**。`prepush.ts` / `local-ci.ts` / `release/steps.ts` 三张表按命令名互相引用，并由 `gate-wiring.test.ts`、`ci-workflow.test.ts` 钉死 —— 改一个命令名要同时改三处加测试。工具换代的成本里，这一块被严重低估。

## 3. 目标架构解读

### 3.1 愿景图上的组件 → 本仓现实映射

迁移愿景通常画成七块。逐块落到本仓的具体位置，结论差别很大：

| 图上的组件 | 本仓现实中的对应物 | 现状落点 | 判定 |
|------------|--------------------|----------|------|
| Vite（Rolldown 作为唯一打包器） | `apps/admin` 的 Vite 构建 | `apps/admin/vite.config.ts` 已用 `rolldownOptions` + `codeSplitting.groups` | 已在轨，只差版本收尾 |
| Oxc 编译器（transform / minify） | Vite 内置的 TS 变换与压缩 | admin 的 `build.minify` 仍写着 `'esbuild'`，`output.minify` 却已用 Oxc 对象形态 | 需要一次澄清 |
| Oxlint | ESLint 10 + `@antfu/eslint-config` 的规则面 | 三个预设 base / vue / nest，另有若干手写本地规则 | 可双轨增量，不能全量替代 |
| Oxfmt | 「stylistic 承担格式化、无 Prettier」 | `@stylistic` + antfu 排版规则 + perfectionist 排序 | 可试点，边界要先划 |
| TypeScript 7（引擎，经 TNB 外壳） | 类型引擎统一到 tsgo 7.0.2；API 面仍是 classic 6.0.3 外壳 | 全仓 `typescript` 解析到 TNB | **已拍板：引擎全面 7.x**；nest-on-TNB PoC 先行 |
| tsrs | 检查侧的快查 CLI（独立于外壳） | —— | 影子期后整批转正 |
| tsdown | 共享包的 Vite lib 构建 + dts 管线 | `@walnut/contract` / `@walnut/utils` 的 `vite build` + `vite-plugin-dts` | 可试点，先小后大 |

图的隐喻容易造成的误读是「七块会一起换」。实际不是：这七块在本仓的**耦合强度差了一个数量级** —— Vite 已经换完，Oxc 压缩只需一个配置值，而 TypeScript 7 在「emit 装配」与「只读诊断」两侧的命运完全不同（见 5.4）。

### 3.2 tsrs 辨析（这个名词是真的，但很容易认错）

调研中最初把 tsrs 当成「幻觉名词」，核实后确认它**真实存在**，但需要三条限定：

- **是什么**：`oxc-project/tsrs`，自述为「TypeScript 7 编译器 / LSP / JS API 的 Rust 移植」，npm 包名 `tsrs`，2026-11-23 的版本是 `7.1.0-beta.tsrs5`。它是 **prerelease**，且**不是微软官方项目**。
- **在 oxlint 里的位置**：oxlint 1.92+ 会自动识别 tsrs 作为类型感知 lint 的后端之一（另一个是 TS 7.0 基的 tsgolint），官方称其覆盖 61 条规则、比 tsgolint 快至多 5 倍。它同时也是**能独立当 tsc 用的 CLI**（`tsrs -p <tsconfig>` / `tsrs --build`），这一点比「当 lint 后端」更有价值。
- **别混淆的三个名字**：`ts-rs` crate 是 Rust → TS 的类型生成器，与编译器无关；`tsc-rs` 是社区实验项目，正在并入 tsrs；`tsgo` 是 TypeScript 官方 native 移植的代号。三者与 tsrs 的关系各不相同，写文档时混用会直接误导决策。

对 Windows 开发者有一条硬事实：tsrs 的 `--watch` 在 Windows 上**不可用**（报 NotImplemented，**退出码 5** —— 此前记录的 2 是错的，本轮订正），CI / Linux 正常。需要区分的是「named pipes 已实现（`docs/DEFAULTS.md` 对应行是过期文档），真正缺的是 fswatch 后端与 LSP watchdog，且无跟踪 issue、无 ETA」。本仓主力开发环境是 Windows，因此 tsrs 只能占据「CI 检查」这一格，本地的 `typecheck:watch` 必须留给 tsc。

## 4. 现状盘点摘要

### 4.1 Lint 与格式

- **一套 flat config，三个预设**：`@walnut/eslint-config` 导出 `base` / `vue` / `nest`（`tooling/eslint-config/base.ts`、`vue.ts`、`nest.ts`），由各包经 jiti 加载。ESLint 10.3.0，底座是 `@antfu/eslint-config` 8.2.0。
- **格式化没有独立工具**：`@stylistic` 规则 + antfu 的排版规则 + perfectionist 的 import / export 排序共同承担「格式」职责，仓库里没有 Prettier。
- **五条手写本地规则**，每条都有 RuleTester 测试：
  - `walnut-comment/no-emoji`（注释禁 emoji）
  - `walnut-script/script-header`（脚本入口必须有头部注释块）
  - `walnut-script/script-exit-code`（脚本退出码限定在仓库的四态约定内）
  - `local/sort-nestjs-decorators`（NestJS 装饰器与参数顺序，带 autofix）
  - `local/no-cross-lib-relative-import`（`libs/<name>/` 内禁止相对路径逃逸）
- **nest 预设开类型感知 lint**（`typescript.tsconfigPath`），并叠加 server 分层 `no-restricted-imports`：一批别名 + fail-closed 语义，靠 `FlatConfigComposer.append()` 追加。另有一条数据权限直连 Repository 的 selector 规则，selector 导出成常量是因为 flat config 同 key 后份整体覆盖前份。
- **插件面很宽**：pnpm（catalog 相关）、turbo（`no-undeclared-env-vars`）、unocss（顺序规则）、unicorn、import-lite、jsdoc、jsonc、yml、toml、vitest 等。其中 yml / toml / json 的覆盖是 oxlint 完全不做的。
- 根级 `lint:root` 只 lint 根目录的 `*.ts`、`*.json`、`*.yaml`。

### 4.2 类型检查

| 对象 | 命令 | 关键配置事实 |
|------|------|--------------|
| admin | `vue-tsc --noEmit`（3.2.8） | tsconfig 用 `baseUrl` + `paths`；dev 期由 `vite-plugin-checker` 内嵌 typescript + vueTsc + eslint |
| server | `tsc --noEmit --pretty` | **独立 tsconfig，不 extends 任何预设**（ADR 0012）；`module: commonjs`；开 `experimentalDecorators` + `emitDecoratorMetadata`；**未显式声明 `moduleResolution`**；paths 里没有 `baseUrl` |
| 其余包 | `tsc --noEmit` | 走 `@walnut/tsconfig` 的 base / ts / vue 预设；`ts.json` 开 `erasableSyntaxOnly`；base 带 `ignoreDeprecations`、`allowImportingTsExtensions`、`verbatimModuleSyntax` |

admin 另有 `tsconfig.dts.json`（`skipLibCheck: false`）专门查手写 d.ts。docs 的 `types:check` 是显式的 echo skipped。

> **2026-11-28 勘误（后于此评估，勿按本文旧结论执行）**：docs 的 `types:check` 已从 `echo skipped` 改为
> `vue-tsc --noEmit`，首跑 **0 诊断**。§5.6 那条「docs（TS6 与 tsrs 同样因 `.vue` 报 3 条 TS2307，
> `echo skipped` 维持正确）」只证明 **非 `vue-tsc` 的检查器认不了 `.vue` 导入**，不是「类型面无法收敛」——
> 换成 `vue-tsc` 后那 3 条立刻消失。详见 [TypeScript 配置](/content/monorepo/typescript)。

这三条路径对 TS7 的敏感度不同：`apps/admin`、`packages/platform-any/*` 与各 tooling 包都写了 `baseUrl: "."`，而 TS7 把 `baseUrl` 判成 **TS5102 硬错误**；server 恰好没有 `baseUrl`，且未显式声明的 `moduleResolution` 在 TS7 下隐式落到 bundler 解析 —— 这正是 server 能零改动通过 TS7 实测的原因（见 5.4）。

### 4.3 构建

- **admin**：Vite 8.0.11，依赖即 Rolldown（不含 Rollup），配置已用 `rolldownOptions` 与 `codeSplitting.groups`；`cssCodeSplit: false`、`target: 'esnext'`、sourcemap 跟随 Sentry 开关、plugin-legacy 目标非 ES5；**`build.minify: 'esbuild'`，而仓内并未声明 esbuild**（`allowBuilds` 里 esbuild 是 `false`，node_modules 里也没有），同时 `output.minify` 又用了 Oxc 的对象形态（`compress.dropConsole` / `dropDebugger`）—— 两处取值不一致，列为待澄清项而不是缺陷。
- **插件面很宽**：plugin-vue、vue-jsx、unocss、unplugin-vue-components / info / turbo-console、checker、legacy、cdn2、compression2、obfuscator、sentry、analyzer、image-optimizer、csp、mkcert 等，集中在 `tooling/vite-config/src/plugins/`。
- **server**：`nest build` + **SWC builder**（`apps/server/infra/nest/` 的 dev / prod / stage 三份配置，lib project 清单以那三份为准；`apps/server/infra/swc/*.swcrc` 与 tsconfig 的 paths 是双份镜像）。产物路径固定为 `dist/apps/api/src/main.js`，Dockerfile 的 CMD 依赖它。三份配置里**没有** `plugins`、也**没有** `typeCheck` —— 这两项是 nest CLI 的 TS7 兼容方案里已知的两个破坏点（见 5.4），本仓恰好都没有。
- **共享包**：`@walnut/contract` 与 `@walnut/utils` 都用 Vite lib 模式产 **CJS**。contract 另有 `scripts/build-barrel.ts`，在 vite 构建之后**覆盖 `dist/index.cjs`** 为手写 barrel。

### 4.4 共享包的 CJS 双模

这是整份评估里最容易被低估的一节。现状由四个事实拼成：

1. **`exports` 是四条件制**：`source` → `src/*.ts`、`types` → `src/*.ts`、`import` → `src/*.ts`、`require` / `default` → `dist/*.cjs`。前端（Vite）走源码，后端（CJS）走产物。
2. **`types` 指源码，`dist` 里的 d.ts 是假管线**：实测 `packages/platform-any/contract/dist/*.d.ts` 是 10 字节占位，没有任何消费者读它。也就是说目前「类型」这条线完全由源码承担，打包器迁移**不改善也不破坏**它 —— 但一旦有人把 `types` 改成指 dist，就会立刻踩到空占位。
3. **后端大批 import 依赖 CJS dist**（消费面可用 grep `require('@walnut/` 在 `apps/server` 复核）。入口拆得越细，`require` 的路径越多。
4. **有一道一致性测试**：`packages/platform-any/contract/__tests__/entries.drift.test.ts` 用正则解析 `vite.config.ts` 的文本，断言四个来源（entries 表、src 文件、exports 键、dist 产物）一致。

结论：共享包不是「随便换个打包器」的对象，而是一份**带四条件契约与手写 barrel 的对外接口**。任何迁移都必须把这四条不变量当成验收标准，而不是当成实现细节。

### 4.5 测试

- Vitest 4.1.2，共享预设 `@walnut/vitest-config`；server 侧用 unplugin-swc + tsconfigPaths 才能跑装饰器代码；e2e 是 playwright 1.59，`apps/e2e` 有自己的编排（锁 → preflight → 重建库 → playwright）。
- 值得记下的一条：**vitest 4.1.2 的 peer 已包含 vite ^8**。因此「Vite 8 必须升 Vitest 5」是伪命题，不需要为 Vite 升级而升测试框架。

### 4.6 门禁联动

- **三张表按命令名互相引用**：`tooling/scripts/src/ci/prepush.ts`（推送前门禁表）、`tooling/scripts/src/ci/local-ci.ts`、`tooling/release/src/release/steps.ts`。三者的对齐由 `gate-wiring.test.ts` 与 `ci-workflow.test.ts` 机械钉死 —— 改一个命令名，三处加测试都要一起改，漏一处就是「表还在、命令没人跑」。
- **`check-turbo-cache`** 从 `apps/server/infra/nest/*.json` 推导 server 的 outDir，再断言 turbo 的 `outputs`；根 `turbo.json` 的 `globalDependencies` 目前只登记了少量配置文件（`tooling/tsconfig/*.json`、`tooling/vitest-config/*.ts` 等），**新增的配置文件必须手工登记**，否则改它不会让缓存失效。
- **`check-pre-hooks` 硬编码 `CONSUMERS = {vite, vue-tsc}`**：它靠这个集合判断「哪些命令必须先跑生成物」。换成别的消费者（例如只用 `tsc` 或只用打包器）时，这份名单不会自己更新。
- **catalog 纪律**：`catalogMode: strict`、`minimumReleaseAge: 1440`（新版本要发布满一天才允许解析）、`allowBuilds` 逐包 false。`typescript` 在 catalog 里锁 6.0.3 —— 任何版本切换（包括 TNB 全局接入时的 overrides + catalog 双改）都必须改 `pnpm-workspace.yaml` 的 catalog 条目，且**全仓生效**。

## 5. 目标栈逐项成熟度判定

每项按「判定 / 关键事实 / 对本仓影响」写。所有版本都是 2026-11-27 查到的口径，标注「实测」的是当日在本机用真实仓库代码跑出来的。

### 5.1 Oxlint 1.95.0 —— 可用于双轨，不能全量替代

- **判定**：**有条件可用**（1.x 稳定线，Sentry / Electron / Preact 等生产在用）。
- **关键事实**：约 873 条规则、其中 111 条默认开启、337 条可修复；内置 typescript / import / unicorn / vue / jsdoc / node / promise / vitest 插件；**Vue 模板不 lint（只 lint script 块，官方兼容矩阵明示）**；jsPlugins 仍是 alpha；配置语义尽量兼容 ESLint v8（extends / plugins / rules / overrides），官方提供 `@oxlint/migrate` 从 flat config 生成初版，并提供 `eslint-plugin-oxlint` 用于双轨时关掉重复规则；类型感知有双后端（tsgolint 基于 TS 7.0，tsrs 基于 TS 7.1 beta，oxlint 1.92+ 自动识别），且 **monorepo 下必须先构建依赖的 d.ts**；TS7 已移除的选项（如 `baseUrl`）不支持，**`baseUrl` 是 type-aware 的硬阻塞**；Windows 原生二进制可用。
- **对本仓影响**：能接住的是一大批通用规则（import 排序之外的通用正确性、unicorn 系、vitest 系）。接不住的三类是硬缺口：**Vue 模板**、**五条本地规则**（除非移植成 jsPlugin，而 jsPlugins 还是 alpha）、**nest 的类型感知 + 分层禁令**（`.append()` 叠加的 fail-closed 语义没有对应物）。**已拍板的配置形态**：`categories: { correctness: 'error' }` 兜底 + 少量显式增量规则（Cloudflare / ComfyUI 的当前形态），不手抄几百条规则。
- 来源：[oxc.rs/docs/guide/usage/linter](https://oxc.rs/docs/guide/usage/linter)、[oxc.rs/compatibility.html](https://oxc.rs/compatibility.html)、[migrate-from-eslint](https://oxc.rs/docs/guide/usage/linter/migrate-from-eslint)（访问日期 2026-11-27）。

### 5.2 Oxfmt 0.80.0 —— 正式采用，不等 1.0

- **判定**：**正式启用**（0.80.0 尚无 1.0，但团队口径是「没有 1.0 就没有 1.0」—— 不因 0.x 等待）。锁**精确版本 0.80.0**；出问题回退版本号，而不是撤门禁。
- **关键事实**：通过 100% 的 Prettier JS/TS 一致性测试；**`printWidth` 默认 100**（Prettier 是 80）；选项面很小（semi / singleQuote / trailingComma / tabWidth / useTabs，加 `sortImports` 与**默认开启的 `sortPackageJson`**）；**没有 Prettier 的插件机制**；支持 Vue SFC / JSON / YAML / TOML / HTML / CSS / Markdown（Vue 支持已在官方语言列表，Pinia 全仓 `oxfmt --check` 含 `.vue` 是实证）；`--check` 可做门禁、`--migrate prettier` 可迁移配置；官方口径是「Oxfmt 管格式、Oxlint 管正确性」；约比 Prettier 快 30 倍。
- **对本仓影响**：**格式的唯一真源是 oxfmt**。已拍板的两条边界：
  - **stylistic 彻底拆分** —— antfu 预设开 `stylistic: false`，再用 `eslint-config-prettier` 兜底（ComfyUI 接法）；ESLint 此后只留非格式规则。
  - **perfectionist 的 import / export 排序暂留 ESLint**，等 oxfmt 的 `sortImports` 启用时一并迁走（Sentry 的 customGroups 排序翻车先例是这条暂缓的理由）。
  - 门禁口径：lint-staged `--write` + CI `oxfmt --check` **阻断**，不做「先观察一段」的两段式。
- **其它已定参数**：`printWidth = 100`（即默认值，接受首轮全仓格式化的一次性大 diff）；`sortPackageJson` 首轮关闭（它会重排所有 `package.json`，与 catalog 顺序规则可能打架）；`sortImports` 不随首轮开。
- 来源：[oxc.rs/blog/2026-02-24-oxfmt-beta.html](https://oxc.rs/blog/2026-02-24-oxfmt-beta.html)、[oxc.rs/docs/guide/usage/formatter](https://oxc.rs/docs/guide/usage/formatter)（访问日期 2026-11-27）。

### 5.3 Vite 8（GA 2026-03-12；最新 8.4.0 / rolldown 1.3.4）—— 已在轨

- **判定**：**已可采用**，本仓已在使用。
- **关键事实**：**Rolldown 是默认且唯一的打包器**，`rolldown-vite` 别名包已于 2026-03-19 归档；`manualChunks` 的对象形式移除（Vite 8 下是 TS2769 硬错），改用 `codeSplitting.groups`；**CSS 默认用 Lightning CSS 压缩**，压缩器更换会带来顺序 / 去重差异；`build.rollupOptions` 成为 `build.rolldownOptions` 的**弃用别名**（仍可用，未来移除）；`build.minify` 默认 `'oxc'`，显式写 `'esbuild'` 需要自行安装 esbuild 且该值已被标记弃用；plugin-legacy 不再支持降到 ES5；默认 target 提到 Chrome 111+ / Safari 16.4+；sourcemap 有 chunk 边角案例，Sentry 上传前值得回归；`rolldownOptions.checks.pluginTimings: false` 可关掉插件耗时告警；大部分插件已适配。
- **对本仓影响**：admin 的 `cssCodeSplit: false` 与 Lightning CSS 的组合是**最需要回归的一处**（CSS 顺序与去重语义变化在关闭代码分割时表现不同）；`minify: 'esbuild'` 需要改成 `'oxc'` 或显式装 esbuild（本仓没有 esbuild，改 `'oxc'` 是更自然的方向，且 `output.minify` 已经是 Oxc 形态）；plugin-legacy 非 ES5，暂不阻塞。真实 Vite 8 应用的实践是**只动 minify 与文件名，很少动分包** —— 见 6.3。
- 来源：[vite.dev/blog/announcing-vite8](https://vite.dev/blog/announcing-vite8)、[vite.dev/guide/migration](https://vite.dev/guide/migration)、[vite.dev/config/build-options](https://vite.dev/config/build-options)（访问日期 2026-11-27）。

### 5.4 TypeScript 7.0（GA 2026-07-08，npm `typescript@7.0.2`）—— 引擎与 API 外壳要分开看

- **判定**：**已拍板「引擎全面 TS7」**。技术现实是：**类型引擎**（诊断与 emit）已经可用；**裸装 `typescript@7`** 会让依赖 classic API 的装配层断。因此工程路径是「**TNB 作为 `typescript` 包面全局接入**（classic 6.0.3 API 外壳 + 进程内 Go tsgo 7.0.2 引擎）+ **tsrs CLI 做快查**」，与 create-vue v3.24 的官方 `tsgo` 选项同构。TS 6.0.3 是当前 stable major（7.0.2 于 2026-07 GA），这里升级的是**类型引擎**，API 外壳按消费者分层保留。
- **实测（2026-11-27，本机，真实 `apps/server` 代码）**：
  - `tsc -p apps/server/tsconfig.json --noEmit` → **0 错误 / 1127 文件 / 12.9s**（增量 4.35s）。这是**引擎侧**证据，不等于装配层可用；文件数随代码增长，看判据不看这个数。
  - `tsrs@7.1.0-beta.tsrs5` 跑同一检查 → **0 错误 / 4.28s**。
  - 装饰器探针在 TS6 / TS7 / tsrs 三者的诊断**逐字节一致**；`emitDecoratorMetadata` 只参与 emit，`--noEmit` 下开关与否诊断完全相同。
  - server tsconfig **零改动兼容**：`module: commonjs` 在 TS7 仍支持；未显式声明 `moduleResolution` 时隐式落到 bundler 解析，paths 无 `baseUrl` 原样可用；`target: es2022` 保留。`baseUrl` 是 TS5102 硬错误，server 恰好没用它。
  - TS7 的 `--watch` 在 Windows 可用（Go 版 Parcel watcher）。
- **裸装 `typescript@7` 的两个断点（本机已实测）**：
  - **nest CLI**：`@nestjs/cli` 12.0.15（2026-11-20）带一个故意的守卫 `TypeScriptBinaryLoader.assertProgrammaticApiIsSupported`，SWC builder 也走这条路径 —— TS7 下 `nest build` exit 1。issue [#3479](https://github.com/nestjs/nest-cli/issues/3479) 仍 open（维护者 2026-09-14 称等 7.1 API 稳定，两次 ping 无应答）；PR #3554 未批，即便合入也只解决 build（无 watch，paths 会报错）。这是**上游能力缺口**，不是靠检索 issue 就能绕过的。
  - **vue-tsc**：`@volar/typescript` 的 peer 是 `typescript < 7`，TS7 下无法运行。
- **工程路径：TNB 全局外壳**。TNB（typescript-native-bridge）是一个「冒充 `typescript` 包」的实现：**对外是 classic 6.0.3 API**（所以 nest CLI、vue-tsc、typescript-eslint 都能照常调用 `createProgram` 等），**对内是进程内 Go tsgo 7.0.2 引擎**（版本 `6.0.3-bridge.19.tsgo.7.0.2`，2026-10-23）。已核实的支撑：language-tools CI 三 OS 全绿（PR #6129，vue-tsc 12.8s → 4.7s）、create-vue v3.24 已带 `tsgo` 选项（同构路线）、维护者称「TNB 是 tsgo 支持的已验证方向」；收益 2–3x（SFC 解析 / 虚拟代码 / sourcemap 仍在 JS）、RSS ≈ 1.9x；Windows win32 x64 / arm64 可用，Alpine / musl 不可用。接入方式是 **pnpm overrides + catalog 双改**（把 `typescript` 解析到 TNB 的发布包），不是官方发行版。
- **nest-on-TNB 是最大未知**。TNB 的官方支持矩阵只验证了 tsc / vue-tsc / tsserver / ESLint，**没有验证 `nest build` 与 `nest start --watch`**。因此 P5c 的第一个动作是 PoC：`nest build` 跑通、`nest start --watch` 跑通、`createProgram` 路径验证，以及 ADR 0007 的装饰器元数据冒烟（断言 tsc 产 dist 的 `design:paramtypes` 与 SWC 等价）—— **PoC 失败只把 nest 侧单独回退到 stock TS6（恢复一条 catalog 条目），其余部分仍是 TS7 引擎**。
- **其它事实**：#3479 里 cr4ftx（2026-07-24）报告的 2726 文件 507ms 是 TNB 类方案的实战先例，其两个破坏点是 Swagger / GraphQL 的 plugin metadata 与 `nest-cli.json` 的 `typeCheck` —— **本仓 `apps/server/infra/nest/*.json` 里两者都没有**（已核实无 `plugins`、无 `typeCheck`）。周下载：`@typescript/typescript6` 15.3M、`tsrs` 10.3M（2026-11 末），说明「stock TS6 兜底」与「tsrs 快查」两条边都有现成供给。破坏性变更（升级时必须先改）：strict 默认开、module 默认 esnext、target 默认 es2025、types 默认 `[]`、**移除 `baseUrl`**、**移除 `moduleResolution: node/node10/classic`**。`experimentalDecorators` + `emitDecoratorMetadata` 的 **emit 已被 7 支持**（PR #2343，产出与旧 tsc 相同的 helpers）。
- **对本仓影响**：最终格局是**引擎全面 7.x**（tsgo 7.0.2 经 TNB + tsrs 7.1-beta 做快查），API 外壳按消费者分层：`tsc` / `vue-tsc` / ESLint 走 TNB 壳，Nest 在 PoC 通过后也走 TNB 壳；tsrs 是独立 CLI，不进任何外壳。admin 的检查链在 TNB 转正后一并升级（5.7）。装饰器元数据验证按 ADR 0007 在 nest-on-TNB PoC 里做，错的症状是接口 200 但字段消失的静默错。**原「catalog 双别名」备选方案作废**：TNB 全局接入后它失去意义，唯一还需要等上游的是「裸 `typescript@7` 直装」。
- **终局状态（2026-11-28，迁移收尾时补记）**：
  - **已转正**：`typescript` 在 catalog 与 `overrides` 双处解析到
    `typescript-native-bridge@6.0.3-bridge.19.tsgo.7.0.2`（只改 catalog 时，从仓库根解析的
    nest CLI 仍会拿到 stock TS，所以 `overrides` 是必需的一半）。
  - **nest-on-TNB PoC 五项全绿**：`nest build`、`nest start --watch`、`createProgram` 路径、
    tsc 产物的 `design:paramtypes` 与 SWC 逐文件比对、`openapi:check:export` 导出零 diff；
    HTTP 冒烟无 500。ADR 0007 的装饰器元数据冒烟因此不再是未知项。
  - **TNB 的 project-mode 缺陷已知**：设置 `configFilePath` 时 `program.getSourceFiles()` 返回
    空壳 SourceFile、`program.emit()` 静默写 0 个文件（classic 路径正常）。admin 生成链的
    `ts-json-schema-generator` 因此改走 `tsrs/sync` 的 checker，产物与迁移前基线**逐字节一致**；
    缺陷本身留给上游桥接层修。
    > **2026-11-28 勘误（后于此评估，勿按上面「缺陷」「留给上游修」的口径执行）**：当日 17 格
    > 调用形态矩阵把上面的现象定性为 **project-mode 使用形态约束**，而非引擎缺陷 —— classic
    > 调用（无 `configFileName`），或 project 语义 + 显式 `ts.createCompilerHost` + 逐文件物化，
    > 两条绕法都实测可用；用户同日决定**不提**上游 issue。约束条款见
    > [ADR 0031](../adr/0031-rust-toolchain-migration.md)，完整矩阵与处置见
    > [执行计划 Ledger](../plans/rust-toolchain-migration-execution.md)。
  - **admin / vue-tsc 保留 3.2.8**：3.3.14 会引入 **1 条真实诊断**
    （`JSONEditor/index.vue` 的 TS2322，stock TS6 + vue-tsc 3.3.14 下同样复现，与 TNB 无关），
    单独修掉源码后可升；不要在迁移收尾里顺手带上。
- 来源：[announcing-typescript-7-0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0)、[announcing-typescript-7-1-beta](https://devblogs.microsoft.com/typescript/announcing-typescript-7-1-beta)、[nestjs/nest-cli#3479](https://github.com/nestjs/nest-cli/issues/3479)、[nestjs/nest-cli#3554](https://github.com/nestjs/nest-cli/pull/3554)、[johnsoncodehk/typescript-native-bridge](https://github.com/johnsoncodehk/typescript-native-bridge)、[language-tools PR #6129](https://github.com/vuejs/language-tools/pull/6129)（访问日期 2026-11-27）。

### 5.5 tsrs（`tsrs@7.1.0-beta.tsrs5`，2026-11-23）—— 优先路线，但必须先影子期

- **判定**：**检查侧优先方案、可进 CI；不能立刻当唯一阻断门禁**（prerelease、非微软官方、packaged validation pending；issue #1114 有约 1% 随机失败）。
- **关键事实（2026-11-27 查证）**：
  - **生态位**：`oxc-project/tsrs`，TS 7 编译器 / LSP / JS API 的 Rust 移植；oxlint 1.92+ 的类型感知后端之一；同时是能独立当 `tsc` 用的 CLI（`tsrs -p` / `tsrs --build`），这一点比「当 lint 后端」更有价值。
  - **新硬风险 #1114（2026-11-26 open）**：同一项目 1,240 次运行里 12 次失败（约 1%）—— 随机段错误或假类型错误（假 TS2307），在 tsrs5 的复现范围内，maintainer 未回复。结论：**tsrs 不能立即当唯一阻断门禁，必须先影子期**。**团队决策（2026-11-27）：不为此加「同 commit 双跑」门禁**（判断为报告者环境问题）；影子期保留「时长 + 诊断 diff」两条判据；若影子期或转正后出现可复现的随机失败模式，再复评此决策。
  - **版本节奏**：tsrs2 → 5 的间隔是 2 / 2 / 3 天，无 RC；TS 7.1 的 RC 按官方 iteration plan 排在 2026-12-01、stable 待定；tsrs 的 stable 只会在其后且无日期；packaged-release validation 仍 pending；`tsrsN` 的版本文本排序最多到 tsrs9 → **锁精确版本、禁用范围**；registry 没有 `next` tag。
  - **退出码与 Windows**：诊断失败 = **2**（tsc 是 1，tsrs 不同 —— 此前写的 1 是笔误，2026-11-28 实测订正）；Windows 下 watch 报 NotImplemented = **5**（此前记录的 2 是错的，本轮订正）。Windows 的 named pipes 已实现（`docs/DEFAULTS.md` 对应行是过期文档），真正缺的是 fswatch 后端与 LSP watchdog，**无跟踪 issue、无 ETA**。
  - **真实采用**：Sentry（`typecheck = tsrs --build ... --builders 2`，CI 唯一检查器，TS6 别名留给其它工具）；Cloudflare agents（逐 tsconfig `tsrs -p`，失败重试 3 次）；**Zerion 就是我们要的模式**（`typecheck: tsrs -p . --noEmit` + `typecheck:watch: tsc --noEmit --pretty --watch`）；sxzz/rolldown-plugin-dts（`tsrs --fast`）；rnw-community（tsrs 优先 + `@typescript/native` 兜底）；Vite+ 的 PR #3352 已把 type-aware 后端从 oxlint-tsgolint 换成 tsrs；Effect-TS/tsgo 提供 tsrs 的 LSP 封装；**公开的 NestJS 仓库零采用** —— 我们是早期采用者，唯一证据就是本仓实测（5.6）。
  - **JS API**：tsrs 暴露 TS7.1 形态的 `tsrs/sync|async|fs|ast`（SDK suite 968/968、170/177 方法），**不兼容 classic `createProgram`** → vue-tsc（`@volar/typescript` 的 peer 是 `typescript < 7`）、TNB（搜 tsrs 命中 0）、Nest CLI 都不能跑在它上面；admin 脱离 TS6 的现实路径是 **TNB 外壳（短期）与 content-mapper（中期）**，而不是换 vue-tsc 的后端。
  - **治理**：2026-10-01 建仓，3 个活跃维护者（Max Schwenk / Boshen / Cameron），外部 PR 一律关闭（48 个 open PR），文档落后 2 个 release；Cloudflare + VoidZero + Owner.com 赞助，Apache-2.0。
  - **门禁纪律**：不用 `--fast`（可能改变诊断与退出码）；`--pretty` 在 Windows 输出 CRLF（tsrs 是 LF）且多文件末尾多一个空行 —— 字节级差异，脚本解析要注意；诊断漂移的对齐目标是 pinned TS7.1，不是 TS6。
  - **编辑器**：LSP preview 可用（VS Code 的 TS7 扩展 + `@tsrs/win32-x64` tsdk，0 failures / 4,562 组，413 skipped）；默认 IDE 仍是 TS6 → 「IDE 不报、CI 报」的双轨风险，以 CI 为准。
- **对本仓影响**：作为检查侧主方案推进，但路径是「P5-pre 清 `baseUrl` → 影子期 → 整批转正」（见 5.6 与计划 P5）；本地 `typecheck:watch` 永久留 tsc。与 `typescript` 锁 6.0.3 无关 —— tsrs 自带编译器，不读 `typescript` 包。与 `ts-rs` crate、`tsc-rs` 均不是同一物（见 3.2 节）。
- 来源：[github.com/oxc-project/tsrs](https://github.com/oxc-project/tsrs)（README / COMPATIBILITY / DEFAULTS / LSP / NODE_API）、[issue #1114](https://github.com/oxc-project/tsrs/issues/1114)、[faster-type-aware-linting-with-tsrs](https://oxc.rs/blog/2026-11-17-faster-type-aware-linting-with-tsrs.html)（访问日期 2026-11-27）。

### 5.6 全仓 tsrs 实测（2026-11-27，本机，原始输出在 `D:\tmp\tsrs-probe\run1\`）

- **硬阻断：`baseUrl`**。全仓 16 份 tsconfig 里 15 份写了 `baseUrl: "."`（`apps/server` 是唯一没有的）→ tsrs / TS7.1 对 `baseUrl` 硬报 **TS5102**，**`ignoreDeprecations` 完全无效**，全部在配置加载阶段失败。删除是机械操作（这 15 份里除 `apps/admin` 外都没有 `paths`，语义零变化）；**`apps/admin` 是唯一的语义变化** —— 它的 paths 是 `@/*: ["src/*"]`，必须改成 `./src/*`，否则报 TS5090。
- **去 `baseUrl` 后的等价性**（仓库外 overlay 等价复现，已验证诊断与文件覆盖同真实配置一致）：**14 / 15 与 TS6 诊断完全等价**；`--listFiles` 的项目文件集 15 / 15 一致。
- **唯一真实差异 = 捞到一个真 bug**：`packages/platform-web/client/src/browser/file/base64.ts:45` 的 `img.crossOrigin = 'Anonymous'` —— TS7.1 的 lib.dom 把类型收紧为 `"anonymous" | "use-credentials" | null`，报 TS2820。已用「TS6 checker + TS7 lib」交叉实验证死是 lib 升级而非 tsrs 误报；且按 WHATWG，大写 `Anonymous` 本就退化为 no-cors，**跨域图转 base64 会静默失败** → 无论迁不迁 tsrs 都该修（改 `'anonymous'`）。
- **不可替换 / 无收益**：admin（vue-tsc 领域）、docs（TS6 与 tsrs 同样因 `.vue` 报 3 条 TS2307，`echo skipped` 维持正确）；`@walnut/types`（文件很少）、`@walnut/commitlint-config`（被约 1s 的 Windows 启动地板拖平）无收益。
- **速度真相**：收益集中在冷跑与全量重查（scripts 8.5s → 1.5s、vite-config 8.6s → 1.4s、eslint-config 8.5s → 2.0s、e2e 14.3s → 1.9s、server 14–68s → 4.28s，约 3–12x）；但本仓的 `types:check` 已被 turbo 缓存兜住重复检查 → **收益主要在 CI 冷跑与改配置后的全量场景**。
- **工程代价清单**：tsrs 须进 catalog 并加到 14 个包的 devDeps（`hoist: false` 下幻影依赖会立刻暴露）；server 的 `tsBuildInfoFile` 必须分文件（tsrs 写 Go 格式 `version: "7.1.0-beta"`，与 TS6 共路径会乒乓失效 —— 实测互相覆盖不毒化，但反复全量）；脚本迁移 `tsc --noEmit` → `tsrs --noEmit`（`--pretty` 兼容）；`check-handwritten-dts.ts` 不受影响（走 TS6 JS API 且属 admin 领域）。
- **混用分裂风险**：若只给部分包换 tsrs，CI 会出现「同一代码 TS6 绿、tsrs 红」（`@walnut/client` 即实例）→ 要换就整批换（或影子期明确双轨口径），不要渐进混搭。

### 5.7 SFC 类型检查版图（admin 的现实选项）

本轮额外拿到一份 SFC 方案材料，逐条核实并**修正了归属与成熟度**（2026-11-27 抓取）。修正后的版图：

| 方案 | 真实状态（核实后） | 成熟度 | 对本仓的判定 |
|------|--------------------|--------|--------------|
| vue-tsc + TS6 | 官方基准，属实（vue-tsc 最新 3.3.14，peer 是 `typescript >= 5`） | 稳定 | **现在就用**（顺手升 3.3.14） |
| vue-tsc + TNB | **真实且获 Vue 官方背书，但有条件**。TNB = 「冒充 `typescript` 包的经典 TS 6.0.3 API 外壳 + 进程内 Go tsgo 7.0.2 引擎」（版本 `6.0.3-bridge.19.tsgo.7.0.2`，2026-10-23）。Vue 官方验证：language-tools CI 三 OS 全绿（PR #6129，vue-tsc 12.8s → 4.7s ≈ 2.7x；README 当前口径 elk.zone 9.7s → 3.2s ≈ 3x）、create-vue v3.24.0 已带 tsgo 选项、维护者原话「TNB 是 tsgo 支持的已验证方向，等 TS7.1 官方插件接口后就不需要了」 | **已决策实施**（量基线→迁移） | **做**：P0 量 admin `vue-tsc --noEmit` 基线（耗时 + 诊断数）→ 换 TNB 跑同一基线 → 对比无问题即迁移转正。硬门槛=全量 SFC 诊断逐条 diff **只接受可归因差异**。收益 2–3x 非 10x（SFC 解析 / 虚拟代码 / sourcemap 仍在 JS），RSS ≈ 1.9x；Windows win32 x64 / arm64 可用，Alpine / musl 不可用；接入方式是 pnpm overrides + catalog 双改，不是官方发行版 |
| Vize | **真实存在**（ubugeeei，951★，周下载 6.8 万，npm 0.805.0）但是**独立项目、pre-v1 alpha**；TS 7.1 官方公告全文零次提及；官方 Vue mapper 是 `@vue/content-mapper@4.0.0-alpha.3`；Vize 自测 tsrs + mapper 500 SFC 217ms | 实验室 | **只观察**，不作生产默认 |
| Golar | auvred（tsgolint 作者）活跃 0.1.x（周下载 3.2 万），Go checker + JS 版 `@vue/language-core` 的混合路线 | 实验 | 观察 |
| vue-tsgo | KazariEX 的项目，**已归档**（2026-07-09） | 已停 | **不可推荐**（注意它与 Golar 是两个项目） |
| tsrs + 原生 SFC | 确无内置 `.vue` 解析，但 **tsrs 官方支持 content mappers**（COMPATIBILITY.md：`.vue` / `.svelte` / `.astro` = yes，58 组 fourslash 通过）；Vue 侧基准（MatesEngineer/vue-typecheck-benchmark）里 tsrs 0.25 + `@vue/content-mapper` 12 个故意错误的诊断全对齐，5.9s vs vue-tsc 23.9s | 有基准、无产品 | 中期观察（等 mapper 稳定） |
| Vue 官方中期路线 | language-tools v4（PR #6170，open）= TS 7.1 自带 `tsc` + `@vue/content-mapper` 直接查 `.vue`，**不再有独立的 vue-tsc 二进制**；v4 只支持 TS7.1；alpha.3 无 stable 日期 | 规划中 | **等它**；这是 admin 脱离 TS6 的唯一官方路径 |

admin 的修正路线分三层：

1. **现在**：vue-tsc + TS6（顺手升到 3.3.14），同时量出基线（P0）。
2. **做**：TNB —— 「量了就迁」而不是可选试点。硬门槛是**全量 SFC 诊断逐条 diff 只接受可归因差异**（2026-11-27 为 323 条，随代码变化）+ 同一基线的耗时 / 诊断数对比；回落方式就是删掉那条 override。
3. **中期**：等官方 `@vue/content-mapper` v4 stable（或其 tsrs 后端）。Vize / Golar 只观察。

一个判断上的提醒：TNB 的 2–3x 是**真实但有限**的收益，因为 SFC 解析、虚拟代码生成与 sourcemap 仍留在 JS 侧；把它当成「用 2–3x 的收益换一个第三方 fork 的维护风险」来评估，而不是「白捡 10x」。

- 来源：[johnsoncodehk/typescript-native-bridge](https://github.com/johnsoncodehk/typescript-native-bridge)、[vuejs/language-tools PR #6129](https://github.com/vuejs/language-tools/pull/6129)、[PR #6170](https://github.com/vuejs/language-tools/pull/6170)、[vizejs.dev](https://vizejs.dev)、[golar.dev](https://golar.dev)、[KazariEX/vue-tsgo（archived）](https://github.com/KazariEX/vue-tsgo)、[MatesEngineer/vue-typecheck-benchmark](https://github.com/MatesEngineer/vue-typecheck-benchmark)（访问日期 2026-11-27）。

### 5.8 tsdown 0.23.7 —— 可试点，0.x 必须锁版本

- **判定**：**可用但需锁版本**（0.x，未到 1.0；0.23.0 是 breaking 版本）。
- **关键事实**：Rolldown / Oxc 基的 lib bundler，tsup 的精神续作；dts 由 rolldown-plugin-dts 提供，但 **0.23.7 的 dts 选项里已没有 `isolatedDeclarations` 字段**（现写法是 `dts: { oxc: true }` 或在 tsconfig 里开 `isolatedDeclarations`）；**CJS 官方标为维护模式**（新库建议 ESM-only），但本仓后端 `require` 需要 CJS，属合理例外；纯类型包可用 dtsOnly 模式；tsgo 支持是实验性的、不受 semver 保证；有 workspace 模式。已知坑：CJS 下 `platform` 会被忽略并告警（tsdown#1111）；CJS 里 `export { default as foo }` 不 unwrap，消费者拿到的是 `{ default: foo }`（tsdown#914）；dts 相关有 #451 / #1106。
- **对本仓影响**：**已拍板顺序：`packages/platform-any/utils-core` 先行、`packages/platform-any/contract` 随后** —— utils 的 `entries` 表很短、消费面小，先把管线与验收流程跑通；contract 的 `entries` 表更长，另加手写 barrel 与一致性测试（配置见 `packages/platform-any/contract/vite.config.ts`）。关键决策是 **`dts: false`**（types 指源码、dist 的 d.ts 无人消费）与 **`exports: false`**（现在的四条件 exports 形状 tsdown 的生成器表达不了）。CJS 维护模式这一点对我们是**刚好够用**，不是阻断。
- 来源：[tsdown.dev](https://tsdown.dev)、[rolldown/tsdown releases](https://github.com/rolldown/tsdown/releases)（访问日期 2026-11-27）。

### 5.9 Vitest 5.1.2 —— 不需要升

- **判定**：**本计划不需要动**。
- **关键事实**：5.1.2 是最新；本仓 4.1.2 的 peer 已含 vite ^8；5.x 的 breaking 是 `clearMocks` 默认 true、`test.projects` 取代 workspace 文件、`vi.mock` 必须顶层。
- **对本仓影响**：Vite 8 与 Vitest 4 的组合成立，升 5 是可选优化而不是迁移前置条件。
- 来源：[vitest.dev/blog](https://vitest.dev/blog)、[vitest.dev/guide/migration](https://vitest.dev/guide/migration)（访问日期 2026-11-27）。

### 5.10 NestJS 12 与 SWC —— 保持不动

- **判定**：**保持现状**。
- **关键事实**：NestJS 12 GA 2026-08-27；SWC 仍是官方支持的快速 builder（约 20 倍，非默认；monorepo 默认转 Rspack）；SWC **不做类型检查**，`--type-check` 是并行跑 `tsc --noEmit`（依赖 TS API ⇒ TS7 下断）。
- **对本仓影响**：SWC 的稳定性正是本仓后端能无视 TS7 emit 的原因之一，没有迁移动机；反过来说，一旦想用 `--type-check`，它就会把 Nest CLI 的 TS API 依赖再放大一遍。
- 来源：[docs.nestjs.com/recipes/swc](https://docs.nestjs.com/recipes/swc)（访问日期 2026-11-27）。

### 5.11 Node 24 类型剥离 —— 已是事实，但边界要记住

- **判定**：**已在用**（v24.12+ stable）。
- **关键事实**：只剥离 erasable 语法；装饰器、enum、参数属性、`.tsx` 不支持；node_modules 内的 TS 不剥离。
- **对本仓影响**：`@walnut/tsconfig` 的 `ts.json` 用 `erasableSyntaxOnly` 在编译期守住这条边界；它是「不许新建 `.mjs` / `.cjs`」纪律的技术底座，也解释了为什么 server（要用装饰器）必须走 SWC 而不是原生剥离。
- 来源：[nodejs.org/api/typescript.html](https://nodejs.org/api/typescript.html)（访问日期 2026-11-27）。

## 6. 业界实践参考（2026-11-27 逐仓核实）

方法注记：本机没有 `gh`，做法是用 `git clone --filter=blob:none` 加 raw 读取各仓**默认分支的真实配置**，不看 README 的宣称。一条方法论警告先写在前面：**官方的「Projects Using Oxc」名单把 Vue.js (Both) 列为用户，但 `vuejs/core` 的 HEAD 实测仍是 `eslint --cache .` + prettier、仓库里零 oxlint 痕迹** —— 官方名单只能当线索，判断必须逐仓看配置。

### 6.1 九个仓库的做法（按对本仓的相关度排序）

- **Comfy-Org/ComfyUI_frontend**（Vue3 + pnpm monorepo，与本仓形态最像）：三层分工 —— oxfmt 管格式，oxlint 管 TS/JS 正确性与 `.vue` 的 script 块，ESLint 管 vue 模板、unocss、i18n 长尾。接法是 `eslint-plugin-oxlint` 的 `buildFromOxlintConfigFile('.oxlintrc.json')` **拆成两段**：ignores 段放 flat config 最前、rules 段放最后，两个 linter 共享同一份 ignore 真源；末尾加 `eslint-config-prettier` 防格式化打架；type-aware 用 CLI flag `--type-aware` + oxlint-tsgolint；lint-staged 顺序是 `oxfmt → stylelint → oxlint --fix → eslint --fix`。留在 ESLint 的实证清单很有参考价值：`unused-imports/no-unused-imports`（oxlint 看不见 `.vue` 模板里的用法）、`import-x/no-unresolved` 等三条、`no-named-as-default-member`（同一规则 oxlint 报 45 条 vs ESLint 23 条，启发式不一致）。
- **vuejs/pinia**：「只上 oxfmt」的最小路线。`lint: oxfmt --check` 全仓跑（含 `.vue`，证明 Vue SFC 可以整个交给 oxfmt），不做语义 lint；`printWidth: 80`、`semi: false`、`trailingComma: es5`。
- **getsentry/sentry**：TS 配置分层（`oxlint.config.ts` + base 显式展开，注释明言 `extends` 会丢字段）；`options.typeAware: true` 且 **tsrs 当 type-aware 后端、同时直接 `tsrs --build` 当 tsc 用**；用 `oxlint-suppressions.json` 自建预算基线（CLI 没有 bulk suppression 旗标，工具自维护）；oxfmt 的 `sortImports` 配过 customGroups 但**曾因 index-signature 排序错 39 个失败而回滚**；CI job 从 4m55s 降到 1m13s。
- **electron/electron**：13 个嵌套 eslintrc 合并成单个 `.oxlintrc.json`，**彻底去 ESLint**；`categories.correctness: 'off'` + 全显式规则；**显式 `typeAware: false` 并注释原因**（specs 用 Node 类型剥离直跑，`import type` 会让运行期炸）；oxfmt `printWidth: 120` + `sortImports` customGroups；`--format=github` 输出 PR 注解；迁移 PR 移除约 160 个传递依赖。
- **elastic/kibana**：双轨期的「规则所有权铁律」，原文值得直接引用：**「each rule runs in exactly one linter」**。不用 `eslint-plugin-oxlint` 自动关，人工维护互斥集合；**ESLint 插件即使零规则也要保持注册**（否则历史 `eslint-disable` 指令会报 unknown rule）；import 插件与 JS 插件拆两趟 pass 省内存。
- **PostHog**：极简派 —— `categories` 不关 + 少量规则 + `overrides`；`--quiet` 只报 error；个别例外目录分给 Biome。
- **cloudflare/agents**：最现代的极简配置 —— `categories: { correctness: 'error' }` 兜底 + 少量差异规则 + 生成物 ignore；`tsrs -p` 按核并发跑多个 tsconfig 当 typecheck。
- **twentyhq/twenty**：54 条显式规则 + 本地 jsPlugins；迁移 TODO 里记录了一条对本仓最致命的坑 —— `typescript/consistent-type-imports` 的 autofix **会删掉 NestJS DI 需要的 import**（3,814 处违规后该规则被禁用）。
- **vuejs/core（反例）**：官方名单说在用 Oxc，实测仍是 ESLint + Prettier、零 oxlint 痕迹。它的价值不在配置，而在提醒：**名单不是证据**。

### 6.2 可直接借用的两个片段

三层分工的接线（ComfyUI 模式，flat config 只写骨架）：

```ts
// flat config 的顺序就是所有权：ignores 最前、rules 最后
export default [
  { ignores: buildFromOxlintConfigFile('.oxlintrc.json').ignores },
  // ...各包自己的配置
  buildFromOxlintConfigFile('.oxlintrc.json').rules,
  eslintConfigPrettier,
]
```

极简兜底（Cloudflare 模式，差异规则按需加）：

```jsonc
{
  "categories": { "correctness": "error" },
  "ignorePatterns": ["**/dist/**", "**/generated/**", "**/*.d.ts"]
}
```

格式选项的四派分歧（同一批仓库，2026-11-27 抓取）：Pinia / ComfyUI 用 `printWidth: 80`，Sentry 用 90，Electron 用 120，oxfmt 默认 100。**没有共识，只有选择** —— 本仓已拍板取默认值 100（见 5.2）。

### 6.3 对本仓的三条推论

1. **双轨是常态而不是过渡态**：ComfyUI、Kibana 都是长期 oxlint + ESLint 并存，区别只在所有权表由工具生成还是人工维护。本仓有 Vue 模板与五条本地规则，双轨是终点而不是中间站。
2. **极简兜底 + 显式差异**比「手抄几百条规则」可持续：Cloudflare 的 `categories.correctness` 兜底 + 少数差异规则是当前最省维护的形态；Electron 的「categories 全关 + 全显式」适合规则面已经完全稳定的仓库，不适合本仓。
3. **成熟 Vite 8 应用普遍只动 minify 与输出文件名**，很少重做分包。本仓已用 `codeSplitting.groups` 等价迁移了 `manualChunks`，收尾时确认无残留即可，不必趁机重划分包（见计划文档 P1 的验收标准）。

## 7. 差距分析

### 7.1 Oxlint 接不住什么

| 缺口 | 为什么接不住 | 本仓的具体暴露面 |
|------|--------------|------------------|
| Vue 模板 | 官方兼容矩阵明示只 lint script 块 | admin 的模板量远大于脚本量，模板侧的规则一旦没人跑就是纯损失 |
| 五条本地规则 | 需要 ESLint 的 AST 遍历与 autofix 语义；jsPlugins 仍是 alpha | emoji / 脚本头部 / 退出码 / 装饰器排序 / 跨 lib 相对导入 —— 后两条直接关系后端分层纪律 |
| nest 的类型感知 + 分层禁令 | 来自 antfu 预设 + `FlatConfigComposer.append()` 的叠加，是「同 key 后份覆盖前份」的精细控制 | 全套 `@/*` 与 `@walnut-server/*` 别名 + fail-closed 的 `no-restricted-imports`，以及数据权限直连 Repository 的 selector；换成 oxlint 的配置模型要重新表达一遍 |
| yml / toml / json 覆盖 | oxlint 的插件面不含这些语言 | `lint:root` 覆盖面与 workflow / pnpm-workspace 的规则依赖 ESLint |
| 双轨去重成本 | `eslint-plugin-oxlint` 只能关「同名同义」的规则 | 本地规则与 antfu 的组合规则没有对应物，双轨不是「开个开关」 |

**判据**：只要「Vue 模板 + 本地规则 + 类型感知分层」三项里有一项留在 ESLint，Oxlint 就只能做**前置快速通道**（先跑 oxlint 抓通用问题，再跑 eslint 抓专属面），而不是替代品。

### 7.2 TS7 / tsrs 接不住什么

tsrs 是 TS 7.1 的移植，所以下面大部分缺口与「原生 TS7」同源；差别在它**没有** `createProgram` 那套 classic API（5.5），以及它对 content mappers 是原生支持。

| 缺口 | 表现 | 影响 |
|------|------|------|
| Nest CLI 的装配层 | `@nestjs/cli` 的 `assertProgrammaticApiIsSupported` 守卫，SWC builder 也走它 | `nest build` / `nest start` 在 TS7 下直接失败；**与 tsc 能否诊断无关** |
| nest 的 watch | 7.1 API 没有 watch API，文件监听要自己喂 `fileNotifications` | `nest start --watch` 不是一行移植；PR #3554 即便合入也不含 watch |
| vue-tsc 的裸 TS7 | vue-tsc 依赖 classic API（`@volar/typescript` 的 peer 是 `typescript < 7`） | 必须经 TNB 外壳；tsrs 不能当 vue-tsc 后端（它的 API 是 7.1 形态、没有 `createProgram`） |
| nest-on-TNB | TNB 的官方支持矩阵只验证 tsc / vue-tsc / tsserver / ESLint，**未验证 `nest build` / `nest start --watch`**；nest CLI 还依赖 SWC builder 与 `createProgram` 装配 | **最大未知**：PoC 先行（build + watch + 装饰器元数据冒烟）；失败只回退 nest 侧 |
| typescript-eslint 类型感知 | 依赖 API | 裸装 TS7 会断；TNB 外壳下继续可用（classic 面） |
| `typescript` npm 包的 JS API 消费面 | doc-ts / handwritten-dts / turbo-cache 三支检查 + 架构 drift spec 及其测试 | 裸装 TS7 会断；TNB 外壳下继续可用 |
| `ts-json-schema-generator` / `vite-plugin-dts` | JS API 消费者 | admin predev 链与共享包 dts 管线断 |
| `baseUrl` 使用者 | TS7 / tsrs 判为 **TS5102 硬错误**，**`ignoreDeprecations` 完全无效**；oxlint type-aware 也不支持 legacy 选项 | 全仓 15 / 16 份 tsconfig 在配置加载阶段就失败；必须先做 P5-pre 清理（`apps/admin` 还要改 paths 前缀） |
| lib.dom 随版本收紧 | TS7.1 的 `crossOrigin` 只接受 `"anonymous" \| "use-credentials" \| null` | 本仓实测抓到一个真 bug（`base64.ts` 的 `'Anonymous'`，5.6）；这类差异是真问题不是误报 |
| 混用检查器 | 部分包 tsrs、部分包 tsc 时，同一段代码可能出现「TS6 绿、tsrs 红」 | CI 结论取决于哪个包跑哪个检查器；要换就整批换（5.6 末条） |
| 装饰器元数据 emit | TS7 已支持 emit，且实测诊断与 TS6 一致 | 只在换 emit 实现时才需要重跑 ADR 0007 的第一道验证 |

### 7.3 tsdown 要守什么不变量

迁移共享包时，下面五条是**验收标准**，不是实现细节：

1. **exports 四条件不变**：`source` / `types` / `import` 指源码，`require` / `default` 指 CJS 产物。任何一条改成指 dist，前端或后端就有一端换了消费面。**不要用 tsdown 的 `exports` 生成器** —— 这个形状它表达不了，手写不动。
2. **`types` 仍指源码**：dist 的 d.ts 目前是占位、无人消费；因此 `dts: false`，不要顺手把它变成真管线（那是另一件事，且 rolldown-plugin-dts 有自己的坑）。
3. **`dist/index.cjs` 的 barrel 语义保留**：contract 的包入口是手写 barrel 覆盖出来的，不是打包器自然产物。推荐继续用 `packages/platform-any/contract/scripts/build-barrel.ts`（tsdown 的产物名同样是 `dist/*.cjs`，零风险），并在迁移后加一条 **default 导出断言**（CJS 里 `export { default as foo }` 不会 unwrap，消费者拿到的是 `{ default: foo }`）。
4. **entry 集合与 `entries.drift.test.ts` 同步**：那道测试解析的是配置文件文本，配置换了形态（vite.config.ts → tsdown.config.ts）测试也要跟着改，否则它会红或者更糟 —— 静默变成空断言。
5. **CJS 产物可被后端 `require` 消费**：后端全部 `require` 的子路径形态（`@walnut/contract/response` 这类）必须逐个可解析；CJS 在 tsdown 里是维护模式，这条要靠实测而不是文档承诺。CJS 产物**不要开 minify**：压缩后的 re-export 对 cjs-module-lexer 不可见，ESM 侧具名导入会静默丢失。

### 7.4 来自真实迁移的踩坑（带来源）

这张表是第 8 节风险清单的证据层：风险清单只写「判什么」，这里写「谁踩过、怎么踩的」。

| # | 坑 | 现象与来源 | 对本仓的动作 |
|---|----|------------|--------------|
| 1 | `typescript/consistent-type-imports` 的 autofix 删 DI import | Twenty 的迁移 TODO 记录：3,814 处违规后该规则被禁用；NestJS 的构造函数注入依赖运行时 import | server 包内该规则**关 fix 或直接 off**；与 ADR 0007 的装饰器元数据纪律同源 |
| 2 | `oxlint --fix` 修完仍有错却退出 0 | foomakers/pair PR #751 记录了 7 条阻断发现；fix 模式的退出码不能当门禁判据 | CI 用 `--check` 或补 `git diff --exit-code`，不要只看 fix 的退出码 |
| 3 | `extends` 会丢 rule options | oxc#22230；Sentry 与 Kibana 的配置注释互相印证「多配置一律显式展开」 | 本仓若拆多份 oxlint 配置，用对象展开而不是 extends |
| 4 | `baseUrl` 是 type-aware 硬阻塞 | oxlint 官方文档明言不支持 legacy 选项 | admin 的 tsconfig 先迁 paths 相对写法，再谈 type-aware（与 7.2 的 `baseUrl` 行同一件事） |
| 5 | `printWidth` 与 `sortPackageJson` 的默认值 | 四派并存（80 / 90 / 100 / 120）；`sortPackageJson` 默认 true 会重排全仓 `package.json`，Cloudflare / Preact 都显式关；`sortImports` 默认关且应最后开 | 显式写 `printWidth`；首轮 `sortPackageJson: false`；`sortImports` 不随首轮开 |
| 6 | 双轨期 ESLint 侧插件不能删注册 | Kibana：即使某插件零规则也要保持注册，否则历史 `eslint-disable` 指令报 unknown rule | 双轨期只关规则、不摘插件 |
| 7 | 生成物必须进 ignore | ComfyUI / PostHog / Cloudflare 共识：`components.d.ts`、`schema.d.ts`、env 产物这类东西被 lint / format 扫到就是噪音与假红 | oxlint 与 oxfmt 的 ignore 都要列：构建产物、`packages/generated` 的 schema、admin 的组件声明、`env-local/`、lockfile |
| 8 | 配置 key 会跨版本改名 | oxfmt 旧的 `experimentalSortPackageJson` 已改名 `sortPackageJson`，跨版本抄配置会**静默失效**；ComfyUI 把 oxlint 锁在 1.77.0 且不带 `^` | catalog 精确锁版本（本仓本来就是 strict），升级时逐 key 对照当前版本文档 |

## 8. 风险清单

### 8.1 P0（阻断性：不解决就不能推进对应轨道）

| 风险 | 现象 | 影响面 | 触发条件 | 缓解措施 |
|------|------|--------|----------|----------|
| nest CLI 在裸 TS7 下断裂 | 裸装 `typescript@7` 时 `nest build` / `nest start` 直接 exit 1（守卫 `assertProgrammaticApiIsSupported`） | 后端全部构建与运行；Docker 镜像 | 把 `typescript` 直接解析到 TS7（不经 TNB 外壳） | 走 TNB 外壳（classic API 面）；#3479 跟踪「裸装解禁」；**不要用「tsc 能过」推断「nest 能构建」** |
| nest-on-TNB 未验证 | TNB 官方支持矩阵只验证 tsc / vue-tsc / tsserver / ESLint，没有 `nest build` / `nest start --watch` | 引擎全面 TS7 的整条轨道 | TNB 切到全局但不做 PoC | **PoC 先行**：build + `start --watch` + `createProgram` 路径 + ADR 0007 装饰器元数据冒烟；失败只回退 nest 侧（恢复一条 catalog 条目） |
| vue-tsc 无裸 TS7 路径 | 裸装 TS7 时 `vue-tsc --noEmit` 无法运行（peer `typescript < 7`） | admin 类型门禁与 dev 期 checker | admin 把 typescript 直接换成 TS7 | 走 TNB 外壳；P0 量基线 → 换 TNB 跑同一基线 → 对比后迁移（5.7）；中期等 content-mapper v4 |
| CJS 双模 exports / barrel 破坏 | 类型检查全绿，但后端启动时 `MODULE_NOT_FOUND` 或某子路径行为变了 | 后端全部 `require` 消费面；共享包对外契约 | 共享包换打包器或改 exports | 7.3 的五条不变量进验收；逐子路径 `require` 冒烟；`node --check` + default 导出断言 |
| 门禁三表失同步 | 表里还有那条命令，但命令已改名 / 删除，CI 静默跳过 | 全部推送前与发版门禁 | 改任何门禁命令名 | 纪律 + `gate-wiring.test.ts` / `ci-workflow.test.ts`；改命令必须一次改三处加测试 |

### 8.2 P1（会造成返工或范围外破坏）

| 风险 | 现象 | 影响面 | 触发条件 | 缓解措施 |
|------|------|--------|----------|----------|
| tsrs 随机失败（#1114） | 约 1% 的运行随机段错误或假 TS2307（1,240 次里 12 次） | 检查侧门禁的可信度 | 立刻把 tsrs 当唯一阻断检查 | 影子期 1–2 周（report-only，只看时长 + 诊断 diff）；锁精确版本；**团队决策：不加双跑门禁**；出现可复现随机失败则复评此决策；转正后保留 tsc 一键回退 |
| `baseUrl` 清理的回归面 | 15 份 tsconfig 机械删除 + `apps/admin` 的 paths 语义改动 | 全仓 `types:check`、vue-tsc、dev 链 | P5-pre 落地 | 独立 PR；全量 `types:check` + vue-tsc 兜；admin 的 paths 前缀单独验证 |
| 混用检查器导致 CI 分裂 | 同一段代码 TS6 绿色、tsrs 红色（`@walnut/client` 是实例） | CI 结论一致性 | 只给部分包换 tsrs | 要换就整批换；影子期也要明确「以哪个为准」 |
| tsrs beta 供应链 | 单一 npm 维护者、8 个平台二进制、2–3 天一个预发布且无 RC、文档落后 | 构建链稳定性 | 自动升版本 / 放开范围 | catalog 锁精确版本、禁用范围；`minimumReleaseAge` 的 1 天窗口正好用来观察；不用 `--fast` |
| 检查器诊断漂移 | tsrs 对齐的是 pinned TS7.1 而非 TS6，lib 收紧会带来新诊断（5.6 的真 bug 即例） | 存量代码的「新红」 | 升级 tsrs 或对齐版本变化 | 每次升级先跑全量 diff；真诊断当 bug 修，不豁免 |
| oxlint `--fix` 退出码不可信 | fix 后仍有错却退出 0 | CI 门禁的可靠性 | 只以 fix 的退出码判红 | 补 `--check` 或 `git diff --exit-code`（7.4 第 2 条） |
| `consistent-type-imports` 删 DI import | 后端构造函数注入在运行时缺 import | server 运行时 | 在 server 包开该规则的 autofix | 关 fix 或直接 off（7.4 第 1 条） |
| `extends` 丢 rule options | 规则看着在、选项没生效 | oxlint 配置正确性 | 多配置用 extends | 对象展开（7.4 第 3 条） |
| ESLint 本地规则与插件面丢失 | 装饰器顺序、跨 lib 相对导入、emoji、退出码规则不再生效 | 后端分层纪律与仓库约定 | 全量切 oxlint | 双轨；本地规则保留在 ESLint；双轨期不摘插件注册（7.4 第 6 条） |
| oxfmt 首轮全仓重排 | `printWidth = 100` 下首轮格式化产生覆盖全仓的 diff | 所有源码与配置 | 直接跑首轮 | 首轮单独成提交且不含逻辑改动；`sortPackageJson` 首轮关；评审按「只动空白」验 |
| oxfmt 0.x 的格式回归 | Sentry 曾因 `sortImports` 的 customGroups 排序翻车（index-signature 错 39 个失败）；0.x 不保证 semver | 格式稳定性 | 自动升版本 / 无条件信任新参数 | **锁精确 0.80.0**；出问题回退版本号而不是撤门禁；`sortImports` 单独一步 |
| turbo `globalDependencies` 遗漏 | 改新配置文件后缓存不失效，产物是旧的但门禁全绿 | 构建与 lint 缓存正确性 | 新增 `.oxlintrc.json` / oxfmt / tsdown 配置未登记 | 每次新增配置同步登记；`lint:turbo-cache` 复核；turbo 缓存 key 要含 lint 配置 hash |
| tsdown 0.x breaking | 升级小版本后产物形状或 dts 行为变化 | 共享包构建 | 不锁版本 / 自动升小版本 | 锁 0.23.x；升级单独成提交并跑全量验收 |
| `check-pre-hooks` 的 `CONSUMERS` 过期 | 新增消费者不跑生成物，旧消费者仍在白跑 | 生成物一致性 | 命令或消费者变化 | **P0 配置化**：名单搬进数据（commands 表或独立配置），门禁逻辑只读数据；P1–P5 只改数据 |
| catalog `minimumReleaseAge` 挡新版本 | 想立刻采用刚发布的 oxlint / oxfmt / tsrs 版本却被解析拒绝 | 迁移节奏 | 上游发布当天就想升级 | 接受一天延迟；它同时也是 beta 供应链的观察窗，不要为赶版本改全局设置 |
| tsrs 只在 CI 可用 | 本地 `typecheck:watch` 在 Windows 上不可用（退出码 5；缺 fswatch 后端与 LSP watchdog，无 ETA） | 开发体验 | 把 tsrs 当日常检查器 | 只用于 CI；本地 watch 永久保留 tsc（Zerion 模式） |
| TS6 与 tsrs 共用 `tsBuildInfo` | 两种格式（tsrs 写 Go 格式 `version: "7.1.0-beta"`）共路径会反复全量 | 类型检查缓存 | 不区分缓存文件 | 分文件（按检查器版本命名），实测互相覆盖不毒化但会乒乓 |
| #3479 / #3554 停滞 | 「裸装 `typescript@7`」长期无法解禁 | 轨道 D 的「去掉外壳」一步 | 指望上游在近期解决 | 用 TNB 外壳绕过；每季度复核一次 issue |

### 8.3 P2（观测或体验层面）

| 风险 | 现象 | 影响面 | 触发条件 | 缓解措施 |
|------|------|--------|----------|----------|
| turbo 缓存掩盖 tsrs 收益 | 日常 `types:check` 已被缓存命中，感受不到 3–12x | 预期管理 | 用本地体感评价迁移收益 | 以 CI 冷跑与改配置后的全量为准；汇报时写清口径 |
| Oxfmt 无插件机制 | Prettier 生态里的自定义格式化（如 Markdown 特殊块）无处挂 | 文档站格式 | 有定制格式需求 | 已正式启用，遇到需求只能回 ESLint 侧处理或接受默认；不为此回退门禁 |
| `sortImports` 的排序语义回归 | Sentry 用 customGroups 时曾因 index-signature 排序错 39 个失败而回滚 | import 排序稳定性 | 首轮就开 sortImports | 首轮不开；单独一步、单独回滚 |
| 上游 prerelease 的能力漂移 | tsrs / 7.1 Beta 的 API 形状变化 | 轨道 C 的检查侧 | 跟踪上游 | 精确锁版本；影子期后再进阻断门禁 |
| CSS 压缩器更换的视觉差异 | 关键页样式顺序 / 去重变化 | admin 视觉回归 | 升级 Vite 或调 cssMinify | 关键页截图基线；`cssCodeSplit: false` 组合单独回归 |
| 生成物被 lint / format 扫到 | 生成声明文件、env 产物进报告，假红 | 门禁噪音 | ignore 漏配 | 按 7.4 第 7 条列全 ignore |
| 配置 key 跨版本改名 | 抄来的 key 静默失效 | 工具实际行为与预期不符 | 跨版本复用配置 | 精确锁版本 + 升级时对照当版文档（7.4 第 8 条） |

## 9. 兼容矩阵

| 组件 | 当前版本 | 目标版本 | 判定 | 备注 |
|------|----------|----------|------|------|
| TypeScript 引擎（经 TNB 外壳） | 6.0.3（stock） | tsgo 7.0.2 | **已决策：引擎全面 TS7** | TNB `6.0.3-bridge.19.tsgo.7.0.2`；API 面 classic、引擎 7.0.2 |
| 裸 `typescript@7` 直装 | 6.0.3 | **不装** | **禁止（等上游）** | nest CLI 守卫 exit 1（#3479/#3554）；vue-tsc peer `<7` |
| TNB（admin SFC） | 未接入 | 6.0.3-bridge.19.tsgo.7.0.2 | **已决策实施（量基线→迁移）** | 官方验证方向；2–3x、第三方 fork、tsgo 引擎；门槛见 5.7 |
| nest-on-TNB（build / start --watch） | 未验证 | 待 PoC | **PoC 先行** | TNB 支持矩阵未覆盖；失败只回退 nest 侧（恢复一条 catalog 条目） |
| tsrs（server 检查） | —— | 7.1.0-beta.tsrs5 | **主方案**（影子后转正） | 实测 0 错误 / 4.28s；#1114 随机失败约 1%；Windows 无 watch |
| tsrs（packages 全量检查） | —— | 同上 | **主方案** | 清 `baseUrl` 后 14 / 15 诊断与 TS6 等价；admin / docs 除外 |
| baseUrl（16 份 tsconfig） | 15 份在用（`ignoreDeprecations` 压制） | tsrs / TS7 硬移除 | **必须先清** | TS5102；P5-pre 机械删除 + admin 的 paths 前缀 |
| `crossOrigin: 'Anonymous'`（client base64.ts） | TS6 不报 | tsrs 报 TS2820 | **无论迁移与否都修** | 实测为真 bug（跨域图转 base64 静默退化为 no-cors）；改 `'anonymous'` |
| @vue/content-mapper v4 | alpha.3 | 等 stable | 中期观察 | v4 只支持 TS7.1、取消 vue-tsc 二进制；无 stable 日期 |
| vue-tsc | 3.2.8 | 3.3.14 | 允许 | 经 TNB 外壳时跑在 tsgo 引擎上 |
| Vite | 8.0.11 | 8.4.0 | 允许 | 已无 Rollup；核对 `rollupOptions` 弃用键与 `minify` 取值 |
| Rolldown | 1.0.0-rc.18（随 Vite） | 1.3.4（随 Vite 8.4） | 允许 | 随 Vite 升级 |
| Vitest | 4.1.2 | 4.1.2（保持） | 不需要动 | peer 已含 vite ^8；5.x 非本计划目标 |
| ESLint | 10.3.0 | 10.x（保持） | 保持 | 双轨中的第二轨，长期共存；`stylistic: false` |
| @antfu/eslint-config | 8.2.0 | 8.x（保持） | 保持 | 本地规则与 append 叠加都基于它 |
| Oxlint | 未接入 | 1.95.0 | 试点 | 双轨；`categories: { correctness: 'error' }` 兜底 + 显式增量（已拍板）；Vue 模板与本地规则留 ESLint |
| Oxfmt | 未接入 | 0.80.0 | **正式启用（阻断）** | 锁精确 0.80.0；`printWidth = 100`；`sortPackageJson` 首轮关闭 |
| tsdown（CJS 产物） | 未接入 | 0.23.7 | 可行 | `exports: false` 手写、`esModule: true`、不 minify；先 utils-core 后 contract（已拍板） |
| rolldown-plugin-dts | 未接入 | **不启用** | 不启用 | `dts: false` 绕开 #451 / #1106；dist d.ts 无消费者 |
| tsrs（总） | 未接入 | 7.1.0-beta.tsrs5 | **优先路线（快查）** | 锁精确版本；影子期后整批转正；Windows 无 watch（退出码 5） |
| NestJS | 12.3.2 | 12.x（保持） | 保持 | SWC builder 不动 |
| SWC | 1.15.21 | 1.x（保持） | 保持 | 装饰器元数据与 tsc 等价的验证要保留 |
| Node | >= 24.15 | >= 24.15（保持） | 保持 | 类型剥离 stable 已是底座 |

## 10. 可行性结论与轨道划分

**结论：可行，分轨道推进；类型检查拆成「检查侧快查（tsrs）」与「引擎全面 TS7（TNB + nest PoC）」两条，整条路线唯一的未知是 nest-on-TNB。**

已拍板的六条（2026-11-27）：

| # | 决策 | 落点 |
|---|------|------|
| 1 | **stylistic 彻底拆分**：antfu 预设 `stylistic: false` + `eslint-config-prettier` 兜底；格式唯一真源 = oxfmt；perfectionist 排序暂留 ESLint | 计划 P2 |
| 2 | **oxfmt 正式启用，不等 1.0**：lint-staged `--write` + CI `oxfmt --check` 阻断，锁 0.80.0 | 计划 P2 |
| 3 | Oxlint 用 `categories: { correctness: 'error' }` 兜底 + 显式增量 | 计划 P3 |
| 4 | tsdown 试点 `utils-core` 先行、`contract` 随后 | 计划 P4 |
| 5 | **TNB「量了就迁」**；#1114 不加双跑门禁；`check-pre-hooks` P0 配置化 | 计划 P0 / P5c |
| 6 | **引擎全面 TS7**：TNB 作为 `typescript` 包面全局接入 + tsrs 快查；catalog 双别名方案作废 | 计划 P5 |

- **轨道 A（已完成，收尾）**：Vite 8 + Rolldown。本仓已在 Rolldown 上，剩 8.0.11 → 8.4.0 升级、`minify` 取值澄清、CSS / sourcemap / legacy 回归。风险集中在视觉回归，不在机制。
- **轨道 B（工具链落地）**：Oxfmt 正式接入（决策 1/2：stylistic 拆除、lint-staged + CI 阻断、锁 0.80.0）；Oxlint 双轨增量（决策 3；Vue 模板、本地规则、类型感知 nest 留在 ESLint）；tsdown 试点共享包（决策 4；守 exports 四不变量与 barrel 语义）。三条子轨道互不依赖，可并行，但都要过门禁三表同步这一关。
- **轨道 C（检查侧快查，tsrs）**：
  - **P5-pre（前置，独立 PR）**：清 `baseUrl`（15 份机械删除 + `apps/admin` 的 paths 前缀）并修 `base64.ts` 的真 bug。红利是同时解除 oxlint type-aware 的 `baseUrl` 硬阻塞（P3 受益）。
  - **P5a 影子 → P5b 转正**：tsrs 影子 1–2 周（只看时长 + 诊断 diff）→ server + packages 整批转正（不混搭）；本地 `typecheck:watch` 永久留 tsc。
- **轨道 D（引擎全面 TS7）**：P5c 四步 ——
  - **P0 基线**：量 admin `vue-tsc --noEmit` 的耗时与诊断数（也是 TNB 的对照组）。
  - **TNB 接 admin**：pnpm overrides + catalog 双改，让 `typescript` 解析到 TNB（classic 6.0.3 API 外壳 + tsgo 7.0.2 引擎），跑同一基线对比；全量 SFC 诊断逐条 diff 只接受**可归因差异**。
  - **nest-on-TNB PoC**：`nest build` + `nest start --watch` 跑通、`createProgram` 路径验证、ADR 0007 装饰器元数据冒烟（tsc 产 dist 的 `design:paramtypes` 与 SWC 等价断言）。
  - **转正或回退**：PoC 通过则 TNB 全局转正（server 的 `tsc --noEmit` 此时也跑 tsgo 引擎，与 tsrs 并存的诊断源差异由影子期口径覆盖）；失败则 nest 侧单独回退到 stock TS6（恢复一条 catalog 条目），其余仍是 TS7 引擎。**唯一还等上游的是「裸 `typescript@7` 直装」**。

判断轨道归属的口径是「**引擎还是外壳**」：只消费诊断的路径可以直接换引擎（tsrs）；必须调 classic API 的消费者需要外壳（TNB）；裸装 `typescript@7` 则必须等 nest-cli 支持 —— 那是轨道 D 唯一剩下的阻塞项。

## 11. 决策记录（原开放问题）

六项原开放问题已于 2026-11-27 全部拍板；这里只留决策与一行理由，实施细节在计划文档。

| # | 原问题 | 决策 | 一行理由 |
|---|--------|------|----------|
| 1 | oxfmt 与 stylistic 的边界 | 彻底拆分：`stylistic: false` + `eslint-config-prettier`；perfectionist 排序暂留 ESLint | 格式只能有一个真源；排序迁移等 oxfmt `sortImports` 稳定 |
| 2 | oxfmt 0.x 是否进阻断门禁 | 直接启用（锁 0.80.0），不因 0.x 等待 | 「没有 1.0 就没有 1.0」；出问题回退的是版本号，不是门禁 |
| 3 | `check-pre-hooks` 是否配置化 | P0 配置化（数据驱动） | 名单过期是长期噪音源；P1–P5 只改数据，不动门禁逻辑 |
| 4 | TNB 是否试点 | 做，且「量了就迁」 | 官方已验证；用基线对比代替分支观察 |
| 5 | tsrs 影子期判据 | 时长 + 诊断 diff；**不加双跑门禁** | 团队判断 #1114 是报告者环境问题；出现可复现随机失败再复评 |
| 6 | catalog 双别名 | **作废**（TNB 全局接入使其失去意义） | 只剩「裸装 `typescript@7`」这一条等上游 |

仍真正未决的只有一条：**TNB 诊断 diff 的「可归因」标准** —— 哪些差异算版本收紧（接受并修）、哪些算外壳 / 引擎缺陷（阻塞迁移）。建议用「TS6 checker + TS7 lib」交叉实验作为归因工具（5.6 的真 bug 就是这么证实的），但阈值需要在 P5c 里定下来。

> **剩余项的真源不在这里**：本篇是 2026-11-27 的 as-of 快照，只保留当日判定；迁移全生命周期的
> ✅ / 🔧 / 📋 / 🚫 四类遗留账、证据提交号与解除条件，统一维护在
> [执行计划的「遗留账与跟进（Ledger）」](../plans/rust-toolchain-migration-execution.md)。
> 上面的「唯一未决项」已由该 Ledger 的 A15（归因标准已落地）与 C03（TNB project-mode 的处置）接管。
>
> **2026-11-28 勘误**：C03 一条原写作「TNB project-mode 上游 issue」，现已作废 —— 复现矩阵把它
> 定性为**使用形态约束**（classic 调用，或 project 语义 + 显式 host + 物化，可绕），用户在当日
> 决定**不提**上游 issue；详见执行计划 Ledger。

## 12. 参考资料

访问日期均为 2026-11-27。

| 主题 | 链接 |
|------|------|
| Oxlint 使用指南 | [oxc.rs/docs/guide/usage/linter](https://oxc.rs/docs/guide/usage/linter) |
| Oxlint 兼容矩阵（含 Vue 模板限制） | [oxc.rs 兼容矩阵](https://oxc.rs/compatibility.html) |
| 从 ESLint 迁移到 Oxlint | [migrate-from-eslint](https://oxc.rs/docs/guide/usage/linter/migrate-from-eslint) |
| Oxfmt beta 公告 | [Oxfmt beta](https://oxc.rs/blog/2026-02-24-oxfmt-beta.html) |
| Oxfmt 文档 | [oxc.rs/docs/guide/usage/formatter](https://oxc.rs/docs/guide/usage/formatter) |
| Vite 8 公告 | [announcing-vite8](https://vite.dev/blog/announcing-vite8) |
| Vite 8 迁移指南 | [vite.dev/guide/migration](https://vite.dev/guide/migration) |
| Vite 构建选项（minify 取值） | [vite.dev/config/build-options](https://vite.dev/config/build-options) |
| TypeScript 7.0 公告（引擎能力与包共存布局） | [announcing-typescript-7-0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0) |
| TypeScript 7.1 Beta 公告（API 与 content mappers） | [announcing-typescript-7-1-beta](https://devblogs.microsoft.com/typescript/announcing-typescript-7-1-beta) |
| tsrs 仓库（README / COMPATIBILITY / DEFAULTS / LSP / NODE_API） | [oxc-project/tsrs](https://github.com/oxc-project/tsrs) |
| tsrs 随机失败（约 1%） | [oxc-project/tsrs#1114](https://github.com/oxc-project/tsrs/issues/1114) |
| tsrs 与类型感知 lint 博客 | [faster-type-aware-linting-with-tsrs](https://oxc.rs/blog/2026-11-17-faster-type-aware-linting-with-tsrs.html) |
| vue-tsc 与 TS7 的路线讨论 | [vuejs/language-tools#5381](https://github.com/vuejs/language-tools/issues/5381) |
| tsdown 文档 | [tsdown.dev](https://tsdown.dev) |
| tsdown releases | [rolldown/tsdown releases](https://github.com/rolldown/tsdown/releases) |
| tsdown CJS `platform` 告警 | [rolldown/tsdown#1111](https://github.com/rolldown/tsdown/issues/1111) |
| tsdown CJS default 导出不 unwrap | [rolldown/tsdown#914](https://github.com/rolldown/tsdown/issues/914) |
| Vitest 博客 | [vitest.dev/blog](https://vitest.dev/blog) |
| Vitest 迁移指南 | [vitest.dev/guide/migration](https://vitest.dev/guide/migration) |
| NestJS SWC 配方 | [docs.nestjs.com/recipes/swc](https://docs.nestjs.com/recipes/swc) |
| Nest CLI 的 TS7 缺口 | [nestjs/nest-cli#3479](https://github.com/nestjs/nest-cli/issues/3479) |
| Nest CLI 的 TS7 支持 PR（未批） | [nestjs/nest-cli#3554](https://github.com/nestjs/nest-cli/pull/3554) |
| Node 类型剥离文档 | [nodejs.org/api/typescript.html](https://nodejs.org/api/typescript.html) |
| oxlint `extends` 丢 options | [oxc-project/oxc#22230](https://github.com/oxc-project/oxc/issues/22230) |
| oxlint `--fix` 退出码（Pair 的阻断发现） | [foomakers/pair#751](https://github.com/foomakers/pair/pull/751) |
| Vite 8 `manualChunks` 硬错的迁移实录 | [zenn.dev/rimo 的文章](https://zenn.dev/rimo/articles/12d6a7b1c58fcd) |
| WebChat 的 tsdown 基础配置（CJS 不压缩的注释） | [microsoft/BotFramework-WebChat](https://github.com/microsoft/BotFramework-WebChat) |
| 三层分工实证（Vue3 + pnpm monorepo） | [Comfy-Org/ComfyUI_frontend](https://github.com/Comfy-Org/ComfyUI_frontend)、[PR #18511](https://github.com/Comfy-Org/ComfyUI_frontend/pull/18511) |
| 只上 oxfmt 的最小路线 | [vuejs/pinia](https://github.com/vuejs/pinia) |
| type-aware + tsrs 当 tsc（生产） | [getsentry/sentry](https://github.com/getsentry/sentry) |
| 去 ESLint 的完整迁移 | [electron/electron](https://github.com/electron/electron) |
| 规则所有权铁律 | [elastic/kibana](https://github.com/elastic/kibana) |
| 极简 `categories` 兜底 | [cloudflare/agents](https://github.com/cloudflare/agents)、[PostHog/posthog](https://github.com/PostHog/posthog) |
| `consistent-type-imports` 删 DI import 的记录 | [twentyhq/twenty](https://github.com/twentyhq/twenty) |
| 官方名单的反例（名单不是证据） | [vuejs/core](https://github.com/vuejs/core) |
| Vite 8 只动 minify 的实践参考 | [vbenjs/vue-vben-admin](https://github.com/vbenjs/vue-vben-admin)、[buqiyuan/vue3-antdv-admin](https://github.com/buqiyuan/vue3-antdv-admin)、[pure-admin/vue-pure-admin](https://github.com/pure-admin/vue-pure-admin) |
| TNB（tsgo 桥）与官方验证 | [johnsoncodehk/typescript-native-bridge](https://github.com/johnsoncodehk/typescript-native-bridge)、[language-tools PR #6129](https://github.com/vuejs/language-tools/pull/6129) |
| Vue 官方 v4（content-mapper，取消 vue-tsc 二进制） | [language-tools PR #6170](https://github.com/vuejs/language-tools/pull/6170) |
| SFC 方案实测（Vize / Golar / vue-tsgo） | [vizejs.dev](https://vizejs.dev)、[golar.dev](https://golar.dev)、[KazariEX/vue-tsgo（archived）](https://github.com/KazariEX/vue-tsgo) |
| tsrs + content-mapper 的 Vue 基准 | [MatesEngineer/vue-typecheck-benchmark](https://github.com/MatesEngineer/vue-typecheck-benchmark) |
| TS 7.1 iteration plan（RC / stable 排期） | [microsoft/TypeScript#63703](https://github.com/microsoft/TypeScript/issues/63703) |
| tsrs 的 Zerion 式接法（typecheck + watch 分离） | [zeriontech/zerion-wallet-extension](https://github.com/zeriontech/zerion-wallet-extension) |
| tsrs 优先 + 官方 native 兜底 | [rnw-community/rnw-community](https://github.com/rnw-community/rnw-community) |
