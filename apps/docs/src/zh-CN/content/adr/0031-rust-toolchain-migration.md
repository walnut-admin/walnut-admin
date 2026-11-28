# ADR-0031: 前端工具链 Rust 化：oxfmt / oxlint / tsdown / tsrs / TNB

**Date:** 2026-11-28
**Status:** Accepted

> **与 ADR 0014 的关系**：本篇**取代** [ADR 0014](./0014-eslint-config-strategy.md)
> Decision 3 中「格式化由 ESLint 的 stylistic 规则承担、没有 `eslint-config-prettier`、没有
> `format` / `format:check` 脚本」的口径，以及 Decision 2 中「暂不引入 oxlint」的口径。
> ADR 0014 原文按 ADR 不回溯的惯例**不改**；它关于「共享配置包 + 三预设 + ESLint 负责非格式规则」
> 的结构决定继续有效。本篇只在本文件声明取代关系，不改 0014 的 `**Status:**`。

## Context

迁移前的四条事实决定了这次换代的形状：

1. **格式化没有独立工具**。`@stylistic` 规则 + antfu 的排版规则 + perfectionist 的 import / export
   排序共同承担「格式」职责，仓库里没有 Prettier，`lint-staged` 只跑 ESLint（ADR 0014 的原口径）。
   于是「格式对不对」与「规则过不过」共用一条退出码，也共用一份缓存。
2. **lint 只有 ESLint 一条轨**。ESLint 10 flat config + `@antfu/eslint-config` 8，三个预设
   （`base` / `vue` / `nest`），另有五条手写本地规则；`nest` 预设开类型感知 lint 与分层
   `no-restricted-imports`。Vue 模板、UnoCSS 与 `.yml` / `.toml` / `.json` 的覆盖面都在这条轨上。
3. **类型检查是三条 JS 路径**。admin 走 `vue-tsc --noEmit`，server 走独立 tsconfig 的
   `tsc --noEmit`（ADR 0012），其余包走共享预设的 `tsc --noEmit`；catalog 锁 `typescript` 6.0.3。
   任何一条都没有 TS7 路径：裸装 `typescript@7` 会同时打断 nest CLI（`assertProgrammaticApiIsSupported`
   守卫，`nest build` exit 1）与 vue-tsc（`@volar/typescript` 的 peer 是 `typescript < 7`）。
   此外 TS7 把 `baseUrl` 判成 TS5102 硬错误，而迁移前全仓多数 tsconfig 都写着它。
4. **共享包的构建管线是 Vite lib 模式**。`@walnut/contract` 与 `@walnut/utils` 产 CJS，
   `vite-plugin-dts` 产出的 `dist/*.d.ts` 是无人消费的占位，`types` 条件一直指源码；contract 的
   `dist/index.cjs` 由手写 barrel 覆盖，`exports` 是五个条件的手写契约，后端大量 `require` 依赖
   `dist/*.cjs`。

目标架构因此不是「把七个组件一起换」，而是按**职责边界**分四块换实现、按**引擎与外壳**分层升级：
格式交给 oxfmt；lint 由 oxlint 做 correctness 快速通道、ESLint 保留它独有的面；共享包 CJS 构建交给
tsdown；类型检查一侧用 tsrs 做诊断快查、另一侧用 TNB（classic API 外壳 + tsgo 引擎）把
`typescript` 包面整体升到 7.x 引擎。Node 24 原生类型剥离与 `erasableSyntaxOnly` 的边界不变。

## Decision 1: 格式化只有一个真源 —— oxfmt

**格式的唯一真源是 oxfmt**（catalog 精确锁 `0.80.0`），ESLint 退出格式职责：

- 根 `.oxfmtrc.json` 的取值：`semi: false` / `singleQuote: true` / `tabWidth: 2` /
  `printWidth: 100` / `trailingComma: all`。`printWidth` 取 oxfmt 默认值 100（Prettier 是 80），
  首轮全仓重排的一次性大 diff 已接受，且首轮格式化单独成提交、不含逻辑改动。
- `sortPackageJson` 首轮**关闭**（默认 true 会重排所有 `package.json`，与 catalog 的既有顺序规则
  打架）；`sortImports` **不写**（默认关，开启是后续独立一步、单独回滚 —— Sentry 有
  customGroups 排序回归的实录）。perfectionist 的 import / export 排序因此**暂留 ESLint**。
- 三个预设（`base` / `vue` / `nest`）的 `@antfu/eslint-config` 选项统一 `stylistic: false`，
  末尾接 `eslint-config-prettier/flat` 兜底，防止残留格式规则与 oxfmt 互相改回去。
- 门禁：`pnpm walnut format:check`（`oxfmt --check .`）进**推送前门禁表**的 `format` 段、
  发版电池与 CI 的 `Format check (oxfmt)` 步骤；pre-commit 的 `lint-staged`
  顺序固定为 `oxfmt --write` → `oxlint --fix` → `eslint --fix`。
- ignore 面与「机器写的文件」同口径：构建产物、`env-local/`、lockfile、`openapi.json`、
  `packages/generated/**`、admin 的生成声明、`.changeset/ledger.yaml`、
  `.vscode/settings-dev.schema.json`、第三方 vendor 资产，以及**首轮不碰 `*.md`**
  （VitePress 的自定义块风险高，markdown 另开一轮单独验证）。
- 0.x 纪律：精确锁版本；出问题**回退版本号**，不是撤门禁；升级单独成批、逐 key 对照当版文档。

## Decision 2: lint 双轨 —— oxlint 做 correctness 兜底，ESLint 保留独有面

两轨的分工是**规则所有权**，不是「谁快谁上」：

- oxlint（catalog 精确锁 `1.95.0`，与 `eslint-plugin-oxlint` 锁步）用
  `.oxlintrc.json` 的 `categories: { correctness: 'error' }` 兜底，只加少量显式增量规则；
  不手抄几百条规则。每条被关掉的规则都在文件里写明理由（ESLint 侧未启用、选项口径不一致，
  或该规则已有 `eslint-disable` 豁免）。
- **留在 ESLint 的三类面**：Vue 模板（oxlint 官方兼容矩阵明示只 lint `.vue` 的 script 块）、
  五条本地规则（`walnut-comment/no-emoji`、`walnut-script/script-header`、
  `walnut-script/script-exit-code`、`local/sort-nestjs-decorators`、
  `local/no-cross-lib-relative-import`），以及 nest 的类型感知与分层禁令
  （`FlatConfigComposer.append()` 叠加的 fail-closed `no-restricted-imports` 没有对应物）。
- **去重是两段式**：三个预设经 `eslint-plugin-oxlint` 的 `buildFromOxlintConfigFile('.oxlintrc.json')`
  取同一份配置 —— ignores 段并进 flat config 最前的 `ignores`，rules 段放在各包配置之后、
  prettier 兜底**之前**的最后一层。**只关规则、不摘插件注册**（否则历史指令会报 unknown rule）。
- **`eslint-disable` 归属约定**：一条规则只有一个 owner，豁免注释必须写给 owner。
  oxlint 拥有的规则写 `oxlint-disable-next-line`；ESLint 拥有的规则（Vue 模板、本地规则、
  类型感知分层、`ts/*` 变体、`unused-imports/*`）仍写 `eslint-disable*`。反向写法会让
  owner 那侧看不到豁免、而非 owner 侧把指令判成 unused 并被 `--fix` 删掉。当前有三条规则
  （`no-control-regex` / `no-empty-pattern` / `no-misleading-character-class`）因此**刻意留在
  ESLint**：ESLint 侧已有带理由的 `eslint-disable-next-line`，把 owner 换到 oxlint 会让 ESLint
  先删指令、oxlint 随即报红 —— 这是双轨期唯一会「自动修复反而制造失败」的组合。
- 接线与缓存：`lint:oxlint` 在 CI（`--quiet --format=github`）、lint-staged 与 **prepush 门禁表的
  `lint:oxlint` 段**里跑（2026-11-28 批次 9B 进表）；门禁只认 `--quiet` 不带 fix 的形态
  （`--fix` 的退出码不可信，有「修完仍有错却退出 0」的实录）。`.oxlintrc.json` 登记进根
  `turbo.json` 的 `globalDependencies`（ESLint 侧会读它，不登记就会出现「改了配置、缓存回放旧结论」的假绿）。

## Decision 3: 共享包 CJS 构建交给 tsdown，对外契约手写不动

`@walnut/contract` 与 `@walnut/utils` 的构建从「Vite lib 模式 + `vite-plugin-dts` + 手写 barrel」
换成 tsdown（catalog 精确锁 `0.23.7`），两支 `tsdown.config.ts` 共享同一组决定：

- `format: ['cjs']`，`minify: false` —— CJS 产物**不开压缩**：压缩后的 re-export 对
  cjs-module-lexer 不可见，ESM 侧具名导入会静默丢失。
- `dts: false` —— `types` 条件指源码，`dist` 的 d.ts 没有消费者；顺带绕开 rolldown-plugin-dts
  的已知坑。
- `exports: false` —— 五条件 `exports`（`source` / `types` / `import` 指源码，`require` / `default`
  指 CJS）的形状生成器表达不了，**手写不动**，也不交给 tsdown 生成。
- **barrel 保留**：contract 的 `build` 是 `tsdown && node scripts/build-barrel.ts`，手写
  `dist/index.cjs` 的语义继续由该脚本承担；`entries.drift.test.ts` 改成解析 `tsdown.config.ts`
  的 entry 表，继续把「entry ⇄ `src` 文件 ⇄ barrel ⇄ `exports` 键」的缺口变成红测试。
- `outputOptions` 显式 `exports: 'named'` / `esModule: true` / `strict: true`
  （rolldown 默认的 `if-default-prop` 不会给纯具名导出入口带 `__esModule`）；
  `deps.neverBundle` 保持 `easy-fns-ts` external；`publint` / `attw` 关闭
  （`exports` 指 `.ts` 时两者必然假阳性）。
- 0.x 纪律：精确锁版本，升级单独成批并跑完全套验收（CJS 在 tsdown 里是维护模式，靠实测不靠承诺）。

## Decision 4: 类型检查拆成「诊断快查」与「引擎升级」两条，互不替代

### 4.1 诊断侧：tsrs 已整批转正（`7.1.0-beta.tsrs5`，精确锁）

tsrs 是 tsc 的 Rust 移植、也是独立的检查 CLI；它自带编译器，不读 `typescript` 包。

- **锁精确版本、禁用范围**：`tsrsN` 的版本文本排序最多到 tsrs9，registry 也没有 `next` tag，
  写范围会在跨 N 时排序错乱。`pnpm-workspace.yaml` 的 `trustPolicyExclude` 只豁免
  **要装的那一个精确版本**（`tsrs@7.1.0-beta.tsrs5`）：2026-10 起该包改用 GitHub Actions OIDC
  发布，pnpm 的 `no-downgrade` 把「发布者从个人账号换成 OIDC」判成 possible package takeover；
  策略本身不关，逐版本豁免都要写一行理由。同一张表里其余条目是 2019-2024 年发布、provenance
  机制尚未普及的历史版本，同样**逐条豁免而非整体关闭策略**。
- **已整批转正（2026-11-28，`6e0e68db`）**：12 个包的 `types:check` 主脚本就是
  `tsrs --noEmit --pretty` —— server、e2e、api-types、contract、utils-core、client、http、
  scripts、release、vite-config、vitest-config、eslint-config；`packages/platform-any/types` 与
  `@walnut/commitlint-config` 仍用 `tsc --noEmit`。影子期的 `types:check:tsrs` 脚本、turbo
  影子任务、CI 的 `continue-on-error` 步骤与命令表条目全部退役；**转正只换检查命令**，
  回滚是一行：把命令指回 tsc。
- **缓存分离**：server 的 `tsBuildInfoFile` 指向 `node_modules/.cache/tsrs/` —— tsrs 写 Go 格式
  的 buildinfo，不能与 TS6 的 buildinfo 共用路径；本地 `typecheck:watch` 仍由 tsc 承担。
- **随机失败按「记录、不加门禁」处理**：issue #1114 记录约 1% 的随机失败，影子期只跟踪、
  不加同 commit 双跑门禁；转正后若出现可复现的失败模式再复评。本地 `typecheck:watch`
  **永久留 tsc**（Windows 上 tsrs 的 watch 是 NotImplemented、退出码 5，且缺 fswatch 后端与
  LSP watchdog）。

### 4.2 引擎侧：`typescript` 包面换成 TNB，引擎全面 7.x

TNB（typescript-native-bridge）对外是 classic 6.0.3 API 外壳，对内是进程内 Go tsgo 7.0.2 引擎；
消费者继续 `require('typescript')`，拿到的却是 7.x 引擎。接入方式是 **catalog + overrides 双改**：
只改 catalog 时，未在 `package.json` 直接声明 `typescript` 的包仍会解析到 stock TS，而 nest CLI
从仓库根解析，必须拿到同一包面。版本 `6.0.3-bridge.19.tsgo.7.0.2` 精确锁（桥接串自带 tsgo 版本，
写范围会在跨 N 时误升到另一版 tsgo）。

- **nest-on-TNB PoC 五项全绿**（2026-11-28 实测）：`nest build` 通过（SWC 编译产物与
  `verify-build-assets` 均正常）、`nest start --watch` 成功启动、`createProgram` 路径可用、
  tsc 产物 `design:paramtypes` 与 SWC 逐文件比对无缺失 / 无多余条目（SWC 对 interface 与
  type 别名发出求值为 `Object` 的受保护引用，是既有形态，不是元数据丢失）、
  `openapi:check:export` 导出零 diff（schema 数量随代码变化，判据是 diff 不是常数）。
  HTTP 冒烟无 500、日志无 undefined 错误。
- **TNB project-mode 缺陷（已知，等上游）**：在设置 `configFilePath` 的 project mode 下，
  `program.getSourceFiles()` 返回的 SourceFile 是空壳（`.d.ts` 的 statements 为空），
  `program.emit()` 静默写 0 个文件；`program.getSourceFile(name)` 物化后的文件正常，不带
  `configFilePath` 的 classic 路径也正常。受影响的消费者是 admin 生成链的
  `ts-json-schema-generator`（admin 的 `predev` / `prebuild` / `pretypes:check` 会一起断）。
- **绕行方式**：admin 的 `.vscode/settings-dev.schema.json` 生成器改为 `tsrs/sync` 的 checker
  直接读类型图（TS 7.1 形状的 JS API），产物与迁移前基线**逐字节一致**（同一 hash，换生成器
  不允许出现任何 schema 变化）。这是 admin 的**第二条 typescript 链**：vue-tsc / ESLint 走 TNB
  的 classic 外壳，生成器走 tsrs 的 7.1 API。
- **admin 的 vue-tsc 已升到 3.3.14**（2026-11-28，`25cd245c`）：升之前先修掉 3.3.14 在
  **stock TS6 下也会**多出的 1 条真实诊断（`JSONEditor/index.vue` 的 TS2322，与 TNB 无关）；
  同一基线仍是 0 诊断。迁移期 3.2.8 的对照读数是换 TNB 后暖跑 1.7x、冷跑 2.2x。
- **裸装 `typescript@7` 仍是红线**：nest CLI 守卫 exit 1、vue-tsc 的 peer `<7` 两个断点都还没解；
  TNB 外壳是当前唯一合法形态。tsrs 也不能当 vue-tsc / Nest 的后端（它的 API 是 7.1 形状、
  没有 `createProgram`）。

## Decision 5: Node 24 原生剥离与 `erasableSyntaxOnly` 的边界不变

本轮换的是工具实现，不改运行形态：仓库里仍无 `.mjs` / `.cjs`，所有 `.ts` 入口由 Node 24 原生
类型剥离执行，`@walnut/tsconfig` 的 `ts.json` 继续用 `erasableSyntaxOnly` 在编译期守住
「只剥离 erasable 语法」这条边界（装饰器 / enum / 参数属性 / `.tsx` 不支持，server 仍走 SWC）。
tsrs 与 TNB 都只替换检查引擎，不改变「哪些代码能直接被 Node 执行」的判据；新增依赖也不改变
`pnpm install` 的 native 构建策略（`allowBuilds` 仍逐包显式声明）。

## Alternatives considered

- **继续让 ESLint 的 stylistic 规则承担格式化（ADR 0014 Decision 3 的原口径）** —— 否决：
  格式与规则共用一条退出码与一份缓存，且「格式只有一个真源」无法机械核对；等 oxfmt 1.0 的代价
  也没有依据（0.x 的配置 key 会跨版本改名，锁精确版本 + 升级逐 key 对照即可控）。
- **继续纯 ESLint、不引入 oxlint（ADR 0014 Decision 2 的原口径）** —— 否决：oxlint 可以做
  correctness 的**前置快速通道**，而 Vue 模板 / 本地规则 / 类型感知分层留在 ESLint 意味着双轨是
  终点而不是过渡态；不引入等于放弃这一层。
- **用 oxlint / biome 全量替换 ESLint** —— 否决：Vue 模板、五条本地规则、nest 的类型感知分层
  三项里至少有一项接不住；biome 同样没有 Vue SFC 与自定义规则支持。
- **catalog 双别名方案（TS6 与 TS7 并存两套包名）** —— 作废：TNB 把 `typescript` 包面整体换成
  classic 外壳 + tsgo 引擎后，双别名失去意义，只剩「裸装 `typescript@7`」一条等上游。
- **裸装 `typescript@7`** —— 禁止：nest CLI 守卫 exit 1、vue-tsc peer `<7`，会同时打断后端
  构建与 admin 检查；这与「tsc 能诊断」无关。
- **让 tsrs 当 vue-tsc / Nest 的后端** —— 不可行：tsrs 的 API 是 7.1 形状、没有 `createProgram`，
  Vue 侧要等官方 content-mapper v4（取消独立 vue-tsc 二进制），Nest 侧需要 nest-cli 自己支持。
- **共享包继续用 Vite lib + `vite-plugin-dts`** —— 否决：`dist` 的 d.ts 是无人消费的占位，
  `types` 一直指源码；tsdown 的产物名同为 `dist/*.cjs`，迁移不改变后端 `require` 消费面，
  却去掉一条只为占位产物存在的管线。

## Consequences

**收益（迁移批次回报的实测读数，2026-11-27 至 11-28，本机 Windows；绝对耗时随机器与代码增长
会变，引用时看倍数与判据）**：

- **全量构建 -49%**（`pnpm build`，Sentry 开启口径 2m44s → 1m24s；批次 2 的 P1 收尾读数）。
- **server `tsc --noEmit` 4.3–4.8x**（冷 23.6s → 5.5s、暖 14.1s → 2.9s，TNB 引擎）。
- **admin `vue-tsc --noEmit` 1.7x**（暖跑 9.9s → 5.8s；冷跑 2.2x），诊断数不变（0）。
- **tsrs 包级 2.3–5.7x**（批次 7 影子期读数；全仓冷跑 60.3s → 3.2s 不可直接对比 —— 影子只跑
  声明了 `types:check:tsrs` 的包，admin / docs 不在其中；2026-11-28 已整批转正为 12 包的
  `types:check` 主脚本）。
- **产物不变**：nest 构建产物与 `verify-build-assets` 通过，`openapi.json` 导出零 diff，
  admin 的 schema 生成物与 HEAD 基线逐字节一致（hash 同值）；批次 8 回归时全仓测试绿，
  syncpack / lockfile / `install --frozen-lockfile` 等门禁绿。收尾提交把生成链换成 tsrs checker 后，
  admin 的 `predev` / `prebuild` / `pretypes:check` 不再被 TNB 的 project-mode 缺陷挡住。
- **格式与 lint 各有一个可机械核对的真源**：`oxfmt --check` 判格式，oxlint 的 correctness 兜底
  在 CI 与 pre-commit 先跑；两份配置（`.oxfmtrc.json` / `.oxlintrc.json`）与各自的 ignore 面
  是唯一需要维护的清单。

**已知代价**：

- **admin 有两条 typescript 链**（TNB 的 classic 外壳 + tsrs 的 7.1 API）。两条链的版本语义不同，
  生成器的产物必须与基线逐字节对齐；TNB 修好 project-mode 之前，新生成器不要建立在
  project-mode 的 `getSourceFiles()` / `emit()` 上。
- **TNB 的 project-mode 缺陷待上游**：`emit` 在 project mode 下静默写 0 个文件是最危险的形态
  （没有报错），排查时先确认「有没有产物」，不要只看 `emitSkipped`。TNB 是第三方桥接包、不是
  官方发行版；Alpine / musl 不可用，Node RSS 约 1.4x。
- **oxlint 已进 prepush（2026-11-28 批次 9B）**：双轨期仍要观察误报；`--fix` 的退出码不能当判据；
  规则所有权表（`.oxlintrc.json` 的逐条关闭理由 + ESLint 侧的 `oxlintRules` 段）需要人维护。
- **tsrs 是 prerelease**：锁精确版本；已整批转正为 12 包的 `types:check` 主脚本；Windows 无 watch，
  本地 `typecheck:watch` 永久留 tsc；`--pretty` 的输出字节与 tsc 不同（CRLF / 末尾空行），
  脚本解析要注意。
- **vue-tsc 已到 3.3.14**：3.3.14 多出的 1 条诊断是真问题，已先修源码（`JSONEditor` 的 TS2322）
  再升级。
- **oxfmt / tsdown 都是 0.x**：精确锁版本、升级单独成批；CJS 在 tsdown 里是维护模式；
  markdown 首轮不格式化，格式面还留着一个后续步骤。
- **裸装 `typescript@7` 仍未解禁**：等 nest-cli 与 vue-tsc 的上游支持；在此之前 TNB 外壳是
  唯一合法形态，每季度复核一次上游 issue。

## Related

- [ADR 0014](./0014-eslint-config-strategy.md)：ESLint 配置策略（本篇取代其 Decision 2 / 3 的
  部分口径，原文不改）
- [ADR 0012](./0012-toolchain-divergence.md)：前后端工具链分歧（server 自有 tsconfig / SWC）
- [ADR 0019](./0019-tsconfig-presets-and-no-mjs.md)：共享 tsconfig 预设与「无 `.mjs`」约束
- [迁移考量与风险评估](../industry-research/rust-toolchain-migration-assessment.md)：逐项判定、
  实测与风险清单（冻结快照）
- [阶段性迁移计划](../plans/rust-toolchain-migration-plan.md) 与
  [执行计划](../plans/rust-toolchain-migration-execution.md)：阶段划分、批次作业单与执行结果
