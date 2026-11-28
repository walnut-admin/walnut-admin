# Rust 化工具链迁移：执行计划

> 状态：【已执行】2026-11-27 立项，2026-11-28 收尾：批次 1–8 全部落地；批次 7 的 P5a 影子已期满、P5b 已整批转正（`6e0e68db`），批次 8 的 P5c 已转正（`fc786d47`）。分支 `feat/rust-toolchain-migration`。
> **定位**：把[阶段性迁移计划（草案）](./rust-toolchain-migration-plan.md)（下称「阶段计划」）的每个阶段翻译成**一个 agent 领一个批次、照做、回报**的作业单：精确到文件、命令、验收与回退。**为什么做、风险多大**在[迁移考量与风险评估](../industry-research/rust-toolchain-migration-assessment.md)（下称「评估」），本篇不重复判定。
> **读者**：执行单个批次的实施 agent；复核各批产出并在最后统一提交的主对话。
> **权威边界**：仓库事实以代码为准。写这份文档时实测到五处「文档与代码不一致」，已单列在 §1.3 —— 执行时按代码，并在回报里写明。
> **本篇不写 git 操作**：所有批次**都不许** `git add` / `git commit` / `git push` / `git stash` / `git tag` / 切分支（§1.2 第 1 条）。
>
> **执行结果（2026-11-28 收尾补记，正文作业单不改）**：8 个批次全部落地 ——
> 批次 1 P0 `dc93c473`；批次 2 P1 `736c5f90`；批次 3 P5-pre `671ccd91` + `82c39f21`
> （base64 真 bug 与 `baseUrl` 清理分开提交）；批次 4 P2 `396320b4` + `5f761523`（首轮格式化）
> + 收尾 `5b5b595f` / `1cc5c72f` / `edf5acf7`；批次 5 P3 `6ee45d62` + `04ca519d`；
> 批次 6 P4 `55258b80`；批次 7 P5a（影子）`60860886`、P5b（tsrs 转正）`6e0e68db`；批次 8 P5c `fc786d47`。
> **两处计划外大发现**：① 批次 4 的 lint-staged 回滚试验留下两处未被格式化器看过的文件
> （`deploy/docker-compose.yml`、`.github/workflows/deploy.yml`），首轮「全仓通过」并不完整，
> 由两个补充提交收尾 —— 教训是「全仓格式化过一次」不等于「每个文件都过了一遍」；
> ② TNB 的 project-mode 缺陷（`getSourceFiles()` 返回空壳、`emit()` 静默写 0 个文件）让 admin
> 生成链原本的 `ts-json-schema-generator` 直接断掉，改用 `tsrs/sync` 的 checker 重写生成器后
> 产物逐字节不变（归因与终局状态见评估 §5.4 与 [ADR 0031](../adr/0031-rust-toolchain-migration.md)）。

## 遗留账与跟进（Ledger，2026-11-28）

> **定位**：本小节是「Rust 化工具链迁移」全生命周期的**唯一总账**。把评估、阶段计划、本篇作业单与
> 8 批执行结果里出现过的「剩余项 / 开放问题 / 非目标」逐条归集，按四类处置；评估与阶段计划不再
> 各自维护副本（评估 §11 末尾只有一行指针）。
>
> **四类**：✅ 已清零（有提交或文档证据）｜🔧 进行中（明确哪一路在清）｜📋 决策点（需要人拍板，
> 含选项与建议）｜🚫 做不到 / 刻意保留（写清为什么、什么条件下重开）。
>
> **统计（2026-11-28，对 HEAD `de27bfb5` 清点）**：✅ 18 条 / 🔧 4 条 / 📋 8 条 / 🚫 17 条，共 47 条。
> 条数是清点口径而不是承诺；新增遗留只往本表追加，不另立第二本账。
>
> **证据口径**：提交号优先；只有文档结论的写文件与章节。探针类数字都带测量方法，引用时看判据不看绝对值。

### 1. ✅ 已清零（18 条）

| 条目 | 类别 | 证据或提交号 | 跟进方式 | 解除条件 |
|------|------|--------------|----------|----------|
| `check-pre-hooks` 的 `CONSUMERS` 硬编码 | ✅ | `dc93c473`（批次 1 P0）；`tooling/scripts/src/ci/pre-hook-consumers.ts`；规则 id 已改名 `consumer-script-needs-pre-generate` | 完成；新增消费者只改数据，不动门禁逻辑 | 已解除；若名单再被硬编码则重开 |
| Vite 8.0.11 → 8.4.0；`build.minify: 'esbuild'` 的矛盾 | ✅ | `736c5f90`（批次 2）；`apps/admin/vite.config.ts` 已无 `build.minify`，细节只在 `rolldownOptions.output.minify` | 完成；CSS / sourcemap / legacy 回归记录在批次 2 回报 | 已解除；升 Vite 主版本时按 §4.4 重跑回归 |
| 16 份 tsconfig 的 `baseUrl` + admin 的 paths 前缀 | ✅ | `82c39f21`（批次 3）；`grep '"baseUrl"'` 为空；admin paths 为 `./src/*` / `./types/*` | 完成；`--listFiles` 覆盖与清理前一致 | 已解除 |
| `crossOrigin: 'Anonymous'` 真 bug | ✅ | `671ccd91`；`packages/platform-web/client/src/browser/file/base64.ts` 与同目录 `base64.test.ts` | 完成；测试只认小写 `anonymous` | 已解除 |
| oxfmt 正式接入、stylistic 拆除、`format` 门禁三表、首轮全仓格式化 | ✅ | `396320b4` + `5f761523`；残留两文件由 `5b5b595f` / `edf5acf7` 收尾；`1cc5c72f` 同步文档 | 完成；首轮大 diff 单独成提交，`format:check` 阻断 | 已解除；升级 oxfmt 走独立批次（D14） |
| oxlint 双轨、去重两段式、CI、turbo `globalDependencies` 登记 | ✅ | `6ee45d62` + `04ca519d`（批次 5）；`.oxlintrc.json`；`buildFromOxlintConfigFile` 两段式 | 完成；规则所有权写在配置注释里 | 已解除；首轮关闭的 correctness 规则见 C05 |
| oxlint 进 prepush（8 批之外的批次 9B） | ✅ | `25cd245c`；`tooling/scripts/src/ci/prepush.ts` 的 `lint:oxlint` 段；`gate-wiring.test.ts` 同步 | 完成；每 push 约 0.3 秒 | 已解除 |
| server 的 `ts/consistent-type-imports` 关闭 | ✅ | `6ee45d62`；`tooling/eslint-config/nest.ts:110`；理由：autofix 会删 DI 需要的 import（Twenty 记录 3,814 例） | 完成；若 ADR 0007 的元数据边界与 lint 边界合并后再评估 | 已解除；重开必须同时满足「不破坏 emitDecoratorMetadata」与 lint-staged 安全 |
| tsdown 接管共享包（utils-core / contract）、barrel 与 drift/default 断言 | ✅ | `55258b80`（批次 6）；两支 `tsdown.config.ts`；`entries.drift.test.ts` + `dist-exports.test.ts`；有意省略 `platform` 以避开 tsdown#1111 告警 | 完成；后端逐子路径 require 冒烟 | 已解除；升级 0.x 走独立批次（D14） |
| tsrs 影子 → 整批转正；本地 watch 留 tsc | ✅ | `60860886`（P5a）+ `6e0e68db`（P5b）；12 个包的 `types:check` 主脚本；server 的 `tsBuildInfoFile` 分离 | 完成；回滚一行改回 tsc | 已解除；#1114 与 Windows watch 见 D02 / D03 |
| TNB 作为 `typescript` 包面；nest-on-TNB PoC 五项 | ✅ | `fc786d47`（批次 8）；ADR 0031；`nest build` / `nest start --watch` / `createProgram` / `design:paramtypes` / `openapi:check:export` 全绿 | 完成；回滚分「全局」与「仅 nest」两档 | 已解除；project-mode 缺陷另记 C03 |
| vue-tsc 3.3.14 + `JSONEditor` 的 TS2322 | ✅ | `25cd245c`；先修源码再升级，升级后基线仍 0 诊断 | 完成；升级前后都有读数 | 已解除 |
| tsrs 退出码笔误（诊断失败 / Windows watch） | ✅ | 评估 §5.5 已订正为「诊断失败 = 2、Windows watch = 5」；执行计划 §9.1 / §9.4 同口径 | 文档完成；脚本解析按新口径 | 已解除 |
| `eslint-disable` 归属约定 | ✅ | `apps/docs/src/zh-CN/content/monorepo/eslint.md` 的「eslint-disable 归属约定」；ADR 0031 Decision 2 | 文档完成；新规则按 owner 写注释 | 已解除 |
| TNB 诊断归因标准（评估 §11 的唯一未决项） | ✅ | 执行计划 §10.3 的三段判据（可归因 / 真问题 / 外壳缺陷）；批次 8 按此执行 | 完成；后续诊断漂移复用交叉实验 | 已解除 |
| ADR 0031 记录迁移决策、三份文档收口 | ✅ | `039fd6d4`；ADR 0031 Accepted；评估 / 阶段计划 / 执行计划互相引用 | 完成 | 已解除 |
| 旧页 `apps/docs/src/zh-CN/guide/lint.md` 的过时事实 | ✅ | 本次 Ledger 随附（保留「旧文档保留作对照」横幅） | 已更新四组事实：格式化真源、lint-staged 顺序、stylelint / prettier 段、手动命令 | 已解除；该页仍是历史对照，不追新功能 |
| P0 基线（admin `vue-tsc`、dist 清单、截图） | ✅ | `dc93c473`；基线落在 gitignored 的 `.zcode/`；批次 8 用同温度对比 | 完成；P5c 的四项读数在 ADR 0031 | 已解除；数据不随仓库保存（D12） |

### 2. 🔧 进行中（4 条）

| 条目 | 类别 | 证据或提交号 | 跟进方式 | 解除条件 |
|------|------|--------------|----------|----------|
| e2e 全 profile 基线重封与全量回归 | 🔧 | 本次清点：`.e2e/{smoke,risk,network,pages,journey}/baseline.manifest.json` 已在 2026-11-28 重封，dataKey 同为 `dfc6560a…`；`.e2e/baseline.manifest.json`（default）仍是 2026-11-27、dataKey 为 `85ee618c…` | 另一路 agent 在跑 `e2e:default`（smoke / risk / network / mobile 四 project）与命名 profile；完成后回填读数 | 所有 profile 清单的 dataKey 与当前数据路径一致；`e2e:default` 与命名 profile 全绿；CI nightly 首跑有记录 |
| Windows `0xC0000005`（admin 的 eslint / vite 偶发原生崩溃） | 🔧 | `plans/tooling-restructure-plan.md` §14 的排查记录；`plans/e2e-sandbox-plan.md` §7 已知问题；prepush 的 `nativeCrashNote` 只加提示、不改判决 | 另一路 agent 治理；下一步用 WER LocalDumps 抓 node 崩溃转储（需改注册表，留给所有者） | 拿到转储定位到模块，或连续负载复现 0 次并形成可执行的重跑口径；否则保持「重跑」处置 |
| `pnpm knip` 红 + 依赖卫生 | ✅ | `knip.config.ts` 顶部判据；`apps/docs/src/zh-CN/content/monorepo/knip.md` 的分类口径 | 已收口（2026-11-28）：`pnpm knip` exit 0；删无用依赖 / 导出与 catalog 条目、补 `entry`/`project`（admin `build/**`、server CLI/worker/migrations/barrel、`.tsx`）；`maxWorkers` 漂移改在 turbo.json 注释对齐事实 | `pnpm knip` exit 0；`ignoreIssues` 仅剩 server 冻结兼容层与 docs 英文站脚手架（逐条理由在配置文件） |
| docs 的 `types:check` 曾是 `echo skipped` | 🔧 | 工作区已由并行 agent 改为 `vue-tsc --noEmit`（`apps/docs/package.json`），并把 `eslint.config.ts` 纳入 `apps/docs/tsconfig.json`；首跑 0 诊断；评估 §4.2 已加 2026-11-28 勘误 | 等该路 agent 提交并跑全仓门禁；不要用裸 `tsc` 硬开 | docs 的 `types:check` 进门禁且 0 诊断、`build:docs` 绿；否则保留 skipped 并写理由 |

### 3. 📋 决策点（8 条）

| 条目 | 类别 | 证据或提交号 | 跟进方式 | 解除条件 |
|------|------|--------------|----------|----------|
| oxfmt `sortImports` 是否开 | 📋 | 决策点 ①：0.80.0 的 schema 能力 + 本仓 2378 文件探针 | 建议**不开**；理由与数据见 ① | oxfmt 支持 `newlinesBetween: ignore` 且覆盖 named import / export，或团队决定放弃 perfectionist；届时单独批次 + 全量 diff |
| oxfmt `sortPackageJson` 是否开 | 📋 | 决策点 ①：17 个 package.json / 127 行键位移；与 ESLint `jsonc/sort-keys` 直接冲突 | 建议**不开**；理由见 ① | oxfmt 支持自定义键序并与 antfu 顺序对齐，或明确删掉 ESLint 根键序规则；单独批次 |
| TNB project-mode 缺陷是否给上游提 issue | 📋 | 决策点 ②：最小复现与英文全文草稿已备好，未提交 | 建议**提**；等用户批准后由人发到 `typescript-native-bridge` | issue 已发并收到上游回应，或上游新版本修复并回归通过 |
| tsdown `sourcemap` 评估 | 📋 | 两支 `tsdown.config.ts` 的 `sourcemap: true`；dist 有 19 个 `.map`；contract 的 `dist/index.cjs` 被 barrel 覆盖后没有 `sourceMappingURL`；server 启动脚本不传 `--enable-source-maps` | 建议**关**（低优先）；若调试 CJS 需要则保留，并在 README 写清 | 拍板开 / 关并改一处配置；改后跑构建与 require 冒烟 |
| oxlint 首轮关闭的 correctness 规则复议 | 📋 | `.oxlintrc.json` 关掉 `no-unsafe-optional-chaining` / `no-useless-escape` / `unicorn/no-useless-spread` / `unicorn/no-useless-fallback-in-spread` / `unicorn/prefer-string-starts-ends-with`；另有三条因 `eslint-disable` owner 留 ESLint | 建议保持关闭；每次只开一条，先观测零误报再进配置 | 单条规则在双轨对照中零误报，且 owner 与豁免注释同步迁移 |
| markdown 是否进 oxfmt | 📋 | `.oxfmtrc.json` 的 `**/*.md` ignore；ADR 0031 记录「markdown 另开一轮」 | 建议后续独立批次：先 `--check` docs，验证 VitePress tabs / mermaid / 容器，再移除 ignore | docs 全量 `oxfmt --check` 绿且 `build:docs` 死链绿 |
| `reference-repo-comparison.md` 的时效性 | 📋 | 该页是 2026-09-23 的一次性对比；正文里「格式化由 ESLint stylistic 承担 / 无 oxlint」等口径已被 ADR 0031 取代；页头只有权威边界，没有 as-of 日期 | 建议下次触碰时加一行 as-of + 指向 ADR 0031 / 本 Ledger；纯历史 plan 不追改 | 页头有日期与「工具链结论以 ADR 0031 为准」的声明 |
| `@vue/content-mapper` v4 / Vue 官方路线 | 📋 | 评估 §5.7：v4 alpha.3、只支持 TS7.1、取消独立 vue-tsc 二进制、无 stable 日期；Vize / Golar 只观察 | 等上游；不主动接 | v4 stable 后用同一 SFC 基线与 TNB 对比，再决定是否去掉 TNB 的 vue-tsc 依赖 |

### 4. 🚫 做不到 / 刻意保留（17 条）

| 条目 | 类别 | 证据或提交号 | 跟进方式 | 解除条件 |
|------|------|--------------|----------|----------|
| 裸装 `typescript@7` | 🚫 | 评估 §5.4 / §8.1；nest-cli #3479 open、PR #3554 未批；vue-tsc 的 peer `<7` | 不装；TNB 外壳是当前唯一合法形态；每季度复核上游 | nest-cli 支持 7.1 API（含 watch / paths）且 vue-tsc peer 放宽 |
| tsrs 在 Windows 的 `--watch` | 🚫 | 评估 §5.5：NotImplemented，退出码 5；缺 fswatch 后端与 LSP watchdog，无跟踪 issue、无 ETA | 本地 `typecheck:watch` 永久用 tsc（Zerion 模式） | 上游补齐 fswatch / LSP watchdog |
| tsrs #1114 约 1% 随机失败 | 🚫 | 评估 §5.5：1,240 次里 12 次；团队决策只跟踪、不加双跑门禁 | 转正后保留「一行改回 tsc」的回滚；出现可复现模式再复评 | issue 关闭，或锁定触发条件并给出可靠绕法 |
| tsrs prerelease 的版本纪律 | 🚫 | `7.1.0-beta.tsrs5` 精确锁；无 `next` tag、`tsrsN` 排序只到 9、packaged validation 仍 pending | catalog 禁范围；升级单独批次并跑全量诊断 diff | 发布 stable 且 packaged validation 转正 |
| oxlint 不 lint Vue 模板 | 🚫 | 官方兼容矩阵只 lint `.vue` 的 script 块；评估 §7.1 | 模板规则留 ESLint；配置里写明所有权 | 官方宣布模板 lint 且本仓实测误报可接受 |
| 五条本地规则留在 ESLint | 🚫 | `walnut-comment/no-emoji`、`walnut-script/script-header`、`walnut-script/script-exit-code`、`local/sort-nestjs-decorators`、`local/no-cross-lib-relative-import`；jsPlugins 仍是 alpha | 保留；不移植 | jsPlugins 稳定且能用 RuleTester 平移 |
| oxlint type-aware 不进门禁 | 🚫 | `pnpm exec oxlint --type-aware` 仅是观测；monorepo 需先构建依赖 d.ts，而共享包 `types` 指源码、dist d.ts 已无 | 只观测；不接门禁 | 有真实 d.ts 管线，或 oxlint 支持源码类型；先观测零误报 |
| 不全量替换 ESLint | 🚫 | 评估 §7.1 / §10；Vue 模板、本地规则、类型感知分层至少一项留 ESLint | 双轨是终点，不是过渡态 | 不重开；三项都被替代后才复议 |
| admin 的两条 typescript 链 | 🚫 | `fc786d47`；vue-tsc / ESLint 走 TNB classic，`apps/admin/build/generate/genJSONSchemas.ts` 走 `tsrs/sync` | 保持；生成器产物与基线逐字节对齐 | TNB project-mode 修复并通过同一基线；届时评估合并，但不强制 |
| `dts: false` / `dist/*.d.ts` 消失 | 🚫 | 评估 §4.4 / §7.3；`types` 条件指源码，dist d.ts 无消费者 | 不偷偷开 dts；这是预期变化 | 出现真实 dist d.ts 消费者，另立项目并处理 rolldown-plugin-dts |
| `publint` / `attw` 不作门禁 | 🚫 | 两者在 `exports` 指 `.ts` 时必然假阳性；执行计划 §8.3 | 关闭；临时跑过只记假阳性类型 | `exports` 改成指 dist |
| P0 基线数据不随仓库保存 | 🚫 | `dc93c473`；基线落在 gitignored 的 `.zcode/`，含机器耗时与截图 | 保留判据与提交号在文档；绝对值只在本机 | 需要跨机对比时改存归一化诊断清单，不存耗时 |
| 旧 `guide/` 文档树 / 纯历史 plan 冻结 | 🚫 | `plans/tooling-restructure-plan.md` 明确保留旧文档树为后续事项；本次只更正 `guide/lint.md` 的事实 | 不追改历史 plan；旧页保留横幅作对照 | 单独立项迁移整棵 guide 树 |
| oxfmt / oxlint / tsdown / tsrs 的 0.x 精确锁 | 🚫 | catalog：`oxfmt 0.80.0`、`oxlint 1.95.0`、`tsdown 0.23.7`、`tsrs 7.1.0-beta.tsrs5` | 精确锁；升级单独批次，逐 key 对照当版文档 | 各自 1.0 / stable 后再评估范围 |
| 不用 `tsrs --fast` | 🚫 | 官方定位「可能改变诊断与退出码」；评估 §5.5 | 门禁只用不带 `--fast` 的形态 | 不重开；除非门禁不再以退出码为判据 |
| 不升 Vitest 5 | 🚫 | Vitest 4.1.2 的 peer 已含 vite ^8；评估 §5.9 | 单独立项 | 有明确收益且能独立验收 |
| 不重划 Vite 分包 / 共享包不改 ESM-only | 🚫 | 成熟 Vite 8 应用只动 minify 与文件名；后端 `require` 是既成事实；评估 §6.3 / §7.3 | 保持 `codeSplitting.groups` 现状；CJS 维护模式够用 | 单独立项，带运行期证据 |

### 5. 决策点 ①：oxfmt 的 `sortImports` / `sortPackageJson` 要不要现在开

**建议：两个都先不开。** 现在开 `sortImports` 的代价不是「一次性重排」，而是**排序所有权分裂**；
现在开 `sortPackageJson` 会与 ESLint 的 `jsonc/sort-keys` **互相改回去**（实测见下）。

**测量方法**：把 HEAD 的 tracked tree 导出到仓库外的临时目录（不碰工作区），用本仓安装的
oxfmt 0.80.0 跑 `--check` / `--write`；探针配置与真实 `.oxfmtrc.json` 的 `semi` / `singleQuote` /
`tabWidth` / `printWidth` / `trailingComma` / `ignorePatterns` 同步，只改被评估的开关。
文件面是 2378 个（不含 `node_modules` / dist，与 `format:check` 同口径）。

| 场景 | 改动文件数 | 行数 | 说明 |
|------|------------|------|------|
| 现状（两开关均关） | 0 | 0 | 基线，`format:check` 全绿 |
| `sortImports: true`（默认 groups） | 1452 | +179,547 / −37,404 | 类型 / 值的分组顺序、`newlinesBetween` 与 perfectionist 不同 |
| 复刻 perfectionist groups + `newlinesBetween: false` | 398 | +3 / −518 | 仍会删掉组间空行；perfectionist 是 `newlinesBetween: "ignore"` |
| 再开 `partitionByNewline: true` | 2 | +3 / −3 | 接近 no-op，但语义变成「空行即分区」，不再跨空行排序 |

**为什么不能「开 oxfmt + 留 perfectionist」**：当前 ESLint 侧有四条排序规则在跑
（`perfectionist/sort-imports`、`sort-exports`、`sort-named-imports`、`sort-named-exports`，
`--print-config` 实测）。oxfmt 的 `sortImports` **只排序 import 语句**，不排序具名 specifier，
也完全不管 export 语句。所以即使开，也只能迁走「语句级 import」这一半；`sort-exports` 与两条
named 规则必须留在 ESLint。而两套排序在边角上会不一致（例如 `@walnut-server` 算 internal 还是
external；`ts-equals-import` 在 oxfmt 的 selector 里没有对应项，只能落 `unknown`），
一致的地方又需要人肉维持——这正是 Sentry 因 customGroups 排序回归而回滚的同类风险。

**`sortPackageJson` 的具体冲突（实测不是推测）**：oxfmt 的键序是固定的（schema 里只有
`sortScripts` 一个子选项，**没有自定义键序**），它把 `license` 放到 `author` 前、`type` 放到
`repository` 后、`engines` / `packageManager` 放到末尾。把 oxfmt 排完的根 `package.json` 通过
`eslint --stdin --stdin-filename package.json` 喂给现有配置，直接报 4 条
`jsonc/sort-keys`（`author` 应在 `license` 前、`type` 应在 `version` 前、`engines` 应在 `scripts` 前、
`packageManager` 应在 `description` 前），而 `eslint --fix` 会把键序改回去 ⇒
`oxfmt --write` 与 `eslint --fix` 在 lint-staged 里互相打架，`format:check` 也会红。
全仓探针的代价是 **17 / 18 个 workspace `package.json`、127 行键位移**；收益只是「键序统一」，
没有功能收益。

**如果将来要开，按这个顺序做**（否则不要动）：

1. `sortImports`：单独批次。用「复刻 perfectionist groups + `newlinesBetween: false` +
   `partitionByNewline: true`」的配置，只关 ESLint 的 `perfectionist/sort-imports`，保留
   `sort-exports` / `sort-named-imports` / `sort-named-exports`；接受「空行即分区」的语义，
   并在配置注释里写清「语句级 import 归 oxfmt，其余归 ESLint」。先跑 2 个边角文件的归因，
   再决定是否值得为这点收益引入两套所有权。
2. `sortPackageJson`：单独批次。要么等 oxfmt 提供可配置键序，要么把 ESLint
   `jsonc/sort-keys` 的**根键序那一条**删掉（保留 `dependencies` / `overrides` / `exports`
   的 asc 子规则），接受一次 17 文件的键位移；不要只开 oxfmt 而留着根键序规则。
3. 两个开关的回滚都是改一行配置，但**首轮 diff 要单独成提交**，否则无法判断回归来自排序还是逻辑。

### 6. 决策点 ②：TNB 的 project-mode 缺陷要不要给上游提 issue

**建议：提。** 理由三条：

1. 这是**桥接层的确定性缺陷**，不是本仓用法问题：标准 `getParsedCommandLineOfConfigFile` 路径
   就会设置 `options.configFilePath`，任何 project-mode 的 codegen / emit 消费者都会踩到。
2. 本仓已经用 `tsrs/sync` 绕开（`genJSONSchemas.ts`），但绕行让 admin 多了一条 typescript 链
   （D09）；上游修好之前，每个新消费者都要重新发现一次「`emitSkipped: false` 但 0 个文件」。
3. 缺陷的危险形态是**静默**：`emit()` 不抛错、`emitSkipped` 为 false，只有产物清单能发现。

**最小复现（本机 2026-11-28 实测，TNB `6.0.3-bridge.19.tsgo.7.0.2` / Node 24.21.0 / Windows x64）**：
用 `parseJsonConfigFileContent(config, sys, dir, {}, configPath)` 得到带 `configFilePath` 的 options，
再 `createProgram(fileNames, options)`；同一组 options 删掉 `configFilePath` 作为 classic 对照。

````text
project-mode: getSourceFiles() returns stub SourceFiles and emit() silently writes 0 files

## Summary

When a program is created from a parsed project config (the standard
`getParsedCommandLineOfConfigFile` / `parseJsonConfigFileContent(..., configFileName)` path, so
`options.configFilePath` is set), `program.getSourceFiles()` returns `SourceFile` objects whose
`statements` array is empty, and `program.emit()` reports `emitSkipped: false` but writes zero
files. The same `fileNames` and compiler options without `configFilePath` work (classic path).
`program.getSourceFile(name)` can still materialize one file, but that does not fix `emit()`.

With TNB this breaks any codegen consumer that walks `program.getSourceFiles()` (for example
`ts-json-schema-generator`).

## Environment

- typescript-native-bridge: 6.0.3-bridge.19.tsgo.7.0.2
- Node.js: 24.21.0
- OS: Windows 11 x64 (reported by a downstream consumer; no custom host or module resolvers)
- Usage: plain `require('typescript')` plus `ts.createProgram(fileNames, options)`

## Minimal reproduction

Files:

    tsconfig.json
    input.ts
    probe.cjs

`tsconfig.json`:

    {
      "compilerOptions": {
        "target": "ES2022",
        "module": "CommonJS",
        "moduleResolution": "Node",
        "declaration": true,
        "outDir": "out-project",
        "strict": true
      },
      "include": ["input.ts"]
    }

`input.ts`:

    export interface Iface {
      b: string
    }

    export const answer: number = 42

`probe.cjs`:

    const fs = require('node:fs')
    const path = require('node:path')
    const ts = require('typescript')

    const configPath = path.join(__dirname, 'tsconfig.json')
    const config = ts.readConfigFile(configPath, ts.sys.readFile)
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, __dirname, {}, configPath)

    console.log('ts.version =', ts.version)
    console.log('options.configFilePath =', parsed.options.configFilePath)

    function report(label, program, outDir) {
      const own = program.getSourceFiles().filter(f => !f.fileName.includes('node_modules') && !f.isDeclarationFile)
      console.log(`[${label}] sourceFiles=${program.getSourceFiles().length} own=${own.length}`)
      for (const sf of own) {
        console.log(`  ${sf.fileName} statements=${sf.statements ? sf.statements.length : 'undefined'} textLen=${sf.text.length}`)
      }
      program.emit()
      const files = fs.existsSync(outDir) ? fs.readdirSync(outDir) : []
      console.log(`  emit -> ${outDir}: ${files.length} files [${files.join(', ')}]`)
    }

    report('project-mode', ts.createProgram(parsed.fileNames, parsed.options), path.join(__dirname, 'out-project'))

    const classicOptions = { ...parsed.options }
    delete classicOptions.configFilePath
    classicOptions.outDir = path.join(__dirname, 'out-classic')
    report('classic', ts.createProgram(parsed.fileNames, classicOptions), path.join(__dirname, 'out-classic'))

## Actual output

    ts.version = 6.0.3
    options.configFilePath = D:/tmp/tnb-repro/tsconfig.json
    [project-mode] sourceFiles=1 own=1
      D:/tmp/tnb-repro/input.ts statements=0 textLen=73
      emit -> out-project: 0 files []
    [classic] sourceFiles=64 own=1
      D:/tmp/tnb-repro/input.ts statements=2 textLen=73
      emit -> out-classic: 2 files [input.d.ts, input.js]

Note the source-file count itself differs (1 vs 64) before any filtering.

## Expected output

Project mode should behave like the classic path: `input.ts` has 2 statements and `emit()` writes
`input.js` plus `input.d.ts`.

## Impact

- `ts-json-schema-generator` iterates `program.getSourceFiles()` and reads `node.symbol` /
  `node.localSymbol`; with stub SourceFiles it fails with `RootlessError: No root type "<name>"
  found`. In the affected repository this broke the admin `predev` / `prebuild` /
  `pretypes:check` chain.
- Any other project-mode consumer that emits or walks the AST is affected. `vue-tsc`, `tsc
  --noEmit`, and `nest build` are not affected because they use different paths.
- The silent `emit()` no-op is the dangerous part: there is no diagnostic and `emitSkipped` is
  false, so a caller only notices by checking the output directory.

## Additional observations

- In a larger project the project-mode program reported 4336 source files vs 1311 on the classic
  path; `.d.ts` files in `getSourceFiles()` had empty `statements` while their `text` was present.
- `program.getSourceFile(fileName)` returns a materialized SourceFile (statements present), so the
  stub seems specific to the project-mode array. Re-materializing files does not fix `emit()`.
- No custom `resolveModuleNames` / `resolveModuleNameLiterals` are involved.

## Questions

1. Is project mode a supported surface for the bridge? If not, please document it in the support
   matrix / README so consumers can avoid it.
2. If it is supported, can this be fixed (materialize SourceFiles and emit in project mode) with a
   regression test that sets `configFilePath`?
3. Is there a recommended workaround besides dropping `configFilePath` (which changes path
   resolution semantics)?
````

**发之前**：目标仓库是 `johnsoncodehk/typescript-native-bridge`（发之前按当时的 issue 列表核对过，
未见同题）；标题用上面第一行；正文就是上面整段（已按最小复现整理，不含本仓内部路径与业务代码）。
按用户要求**未发布**，等批准。

### 7. 其他决策点（③–⑥）的一句话结论

- **③ tsdown `sourcemap`**：当前 `sourcemap: true` 产出 19 个 `.map`；但 contract 的
  `dist/index.cjs` 被 barrel 覆盖后没有 `sourceMappingURL`，server 的启动脚本也不带
  `--enable-source-maps` ⇒ 这些 map 目前没有消费者。建议**关闭**（低优先），需要 CJS 堆栈调试时
  再按包打开；两种选择的成本都只是一行配置。
- **④ oxlint 首轮关闭的 correctness 规则**：保持关闭。它们不是「ESLint 没启用」就是「选项口径
  不同」，双轨期开一条就会制造假红；每次只开一条、先观测零误报，再按 owner 约定迁移豁免注释。
- **⑤ markdown 进 oxfmt**：留到独立批次。VitePress 的 tabs / mermaid / 容器块在格式化面前风险高，
  先 `--check` docs 并验证 `build:docs`，再移除 `**/*.md` ignore。
- **⑥ `reference-repo-comparison.md`**：它是 2026-09-23 的一次性快照，不是现行工具链说明；下次触碰
  时加 as-of 日期与「工具链结论以 ADR 0031 为准」的指针即可，不要为它重跑一轮对比。

### 8. 维护规则

1. **单一真源**：新增遗留只追加到本节；评估的 §11 末尾只留指针，阶段计划不再维护「剩余项」副本。
2. **证据优先**：✅ 必须给提交号或文件章节；📋 必须写选项、建议与解除条件；🚫 必须写「为什么」与
   「什么条件下重开」，否则不算清零。
3. **状态变更留痕**：📋 拍板后在该行写「决策 + 日期 + 落点提交」，不要删行；🚫 解除时先把对应
   提交补进证据列，再改类别。
4. **不写会腐烂的计数**：本节的 47 条是 2026-11-28 对 HEAD `de27bfb5` 的清点口径；新增条目时只改
   统计行，不要改历史证据里的版本号与提交号。

## 1. 执行口径

### 1.1 一次只领一个批次

一个批次 = 一个可独立验收、可独立回退的工作单元。**不要顺手开下一个批次**，也不要在批次内顺手重构无关代码（阶段计划「不做顺手重构」）。批次的顺序与依赖见 §2.2；如果主对话没指定批次，从「依赖已满足的最小批次」里挑一个并在回报开头写明选了哪个。

进入任何一个批次前，先读这三份材料的对应部分（不要通读全文，按指针跳）：

| 要回答的问题 | 去处 |
|--------------|------|
| 这一步为什么要做、风险落在哪 | 评估第 5 节（逐项成熟度）、第 8 节（风险清单） |
| 这个阶段做到什么算完、怎么退回去 | 阶段计划 §4 的对应小节 |
| 某个门禁为什么存在、改成什么样才不破 | 本篇 §1.5 + `tooling/scripts/src/ci/prepush.ts` 的表内 `why` |

### 1.2 六条作业纪律

1. **不做任何 git 写操作**。允许的只有只读命令：`git status`、`git diff`、`git diff --cached`、`git rev-parse`、`git ls-files`、`git log -1`。`git add` / `commit` / `push` / `stash` / `tag` / `checkout` / `restore` / `reset` 一律不许 —— 提交由主对话复核后统一做，这样「首轮大 diff 单独成一个提交」这类要求才有执行者。回滚也不许用 git，见 §1.2 第 5 条。
2. **一次只换一个变量**。换工具不换规则、换规则不换格式、换格式不换逻辑。批次内如果发现某个改动必须连带改另一件事，先在回报里写清，不要自行扩大范围。
3. **依赖只走 catalog**（`pnpm-workspace.yaml`，`catalogMode: strict`），版本写**精确值**（syncpack 的 `semverGroups` 已把 catalog 的 range 定成空串）。新增依赖 = 改 catalog + 在消费方的 `package.json` 写 `catalog:` + `pnpm install`，三件事缺一不可（`lint:lockfile` 与 CI 的 `--frozen-lockfile` 会分别抓到少哪一步）。
4. **改门禁命令必须同步三表加钉死测试**（§1.5）。这是本仓最容易「表还在、命令没人跑」的地方，而且没有运行时报错。
5. **回滚不用 git**。批内回滚 = 用编辑把文件改回原样（本篇每批都给了「改回什么」）；跨批回滚 = 在回报里写明「请主对话 revert 哪一个提交范围」。不要用 `git checkout --` 把别人的未提交改动一起冲掉。
6. **环境缺失要显式说**。跑不了的验收（没有 PostgreSQL / Redis、没有 `pnpm setup-env` 解密、没有浏览器）按四态口径记为「未验证」，在回报里单列 —— **不要写成通过**（`prepush` 的 `[SKIP 未验证]` 就是这条口径的实现）。

### 1.3 写这份文档时实测到的五处差异（执行时按代码）

| # | 文档里的写法 | 代码事实 | 对执行的影响 |
|---|--------------|----------|--------------|
| 1 | 阶段计划 P1 说 `minify: 'esbuild'` 在 `tooling/vite-config` 里 | 它在 `apps/admin/vite.config.ts` 的 `build.minify`（第 151 行附近）；`tooling/vite-config` 只提供插件表与 env 映射 | 批次 2 只改 admin 的 vite 配置，不要动工具包 |
| 2 | 评估写 `@nestjs/cli` 12.0.15 | `pnpm-workspace.yaml` 的 catalog 与已安装版本都是 **12.0.11** | P5c 的 PoC 要按 12.0.11 核；版本号不是判据 |
| 3 | 评估说守卫是版本判断 | 实测 12.0.11 的 `assertProgrammaticApiIsSupported` 判的是 **API 形状**：`typeof ts.getParsedCommandLineOfConfigFile !== 'function'` 才抛 | PoC 的第一条断言直接查这个函数在不在，比查版本号更贴近真实判据 |
| 4 | 评估写「323 条 SFC 诊断」 | 该数是 2026-11-27 的口径，条数随代码增长；且 `types:check` 只有在**零诊断**时才是绿的 | P0 必须在当前 HEAD 上实测：基线非零就先停下问主对话（§3.1） |
| 5 | 阶段计划 P5 把 `baseUrl` 写成「15 份」 | 当前 `grep '"baseUrl"'` 命中 **16 个文件**（含仓库根 `tsconfig.json`；`apps/server` 本就没有） | 批次 3 以 grep 结果为准，清单见 §5.1 |

另外三条与「装不上」直接相关的全局设置（都在 `pnpm-workspace.yaml`，**不许为赶进度改它们**）：

- `minimumReleaseAge: 1440`：新版本必须发布满 24 小时才允许解析。装不上新版本时先怀疑它，不要放宽。
- `trustPolicy: no-downgrade`：可信度下降的版本会被拒。P5c 换 `typescript` 的包面时最可能撞上它（§10.1）。
- `hoist: false`：每个包只能解析自己声明的依赖。任何「幻影依赖」会在第一次运行就报错 —— 这既是纪律，也是 tsrs 必须逐包声明 devDep 的原因。

### 1.4 命令约定

- 一律在**仓库根**执行；需要包目录的命令用 `pnpm -C apps/server …` 或 `pnpm --filter <包名> …`，不要 `cd` 进目录后忘记回来（多步命令建议每行独立）。
- 计时给两套写法，按你的 shell 选一套，**两套别混用**：

```bash
# Git Bash / WSL：两次取第二次（第一次含进程冷启动与磁盘缓存未热身）
time pnpm --filter @walnut/admin types:check
```

```powershell
# PowerShell
Measure-Command { pnpm --filter @walnut/admin types:check | Out-Host }
```

- 子进程的**退出码**才是判据，日志文本只是线索。命令 | tee 会吞掉退出码，要判红就别接管道（或显式看 `${PIPESTATUS[0]}`）。
- 一次性验证脚本不要新建 `.mjs` / `.cjs`（仓库纪律 10）。临时文件写到 gitignored 的 `.zcode/` 下，用 `.ts` 由 Node 原生剥离执行，或直接用 `node -e`。

### 1.5 门禁三表与两道钉死测试（改命令前必读）

三张表按**命令名**互相引用，两个测试把关系钉死：

| 位置 | 它是什么 | 改它要注意什么 |
|------|----------|----------------|
| `tooling/scripts/src/ci/prepush.ts` 的 `PREPUSH_GATES` | 推送前门禁的**唯一**表 | 新段的 `argv` 首词会被当作「可执行名字」去核对 |
| `tooling/scripts/src/ci/local-ci.ts` 的 `LOCAL_CI_STEPS` | **构建类**步骤（要产物、要顺序、要数据库） | 只放构建类；静态检查不要塞进来 |
| `tooling/release/src/release/steps.ts` 的 `RELEASE_BATTERY` | 发版前的全量电池 | 必须是 prepush 的**超集** |
| `.github/workflows/ci.yml` | CI 的触发面 | 步骤名被 `ci-workflow.test.ts` 按名字钉住（只限构建类那几步） |
| `tooling/scripts/src/ci/__tests__/gate-wiring.test.ts` | 三表一致性的机械断言 | 见下面四条 |
| `tooling/scripts/src/ci/__tests__/ci-workflow.test.ts` | workflow 与 `LOCAL_CI_STEPS` 的逐条对齐 | 只对构建类步骤生效 |

`gate-wiring.test.ts` 对新门禁提出的四条硬要求（**这是新增一段门禁的完整清单**）：

1. prepush 段的 `argv` 首词（`['exec', …]` 形态取第 4 项，其余取第 1 项）必须作为 `pnpm <名字>`、`pnpm run <名字>` 或 `pnpm walnut <名字>` 出现在某个 workflow 里；否则「只有本地守」判红。
2. 同一个名字必须以 `'<名字>'` 的字面量出现在发版电池里；否则判红。
3. workflow 里 `pnpm walnut <id>` 的 `<id>` 必须在命令表；`pnpm <名字>` 的 `<名字>` 必须是保留根脚本或命令表 id。
4. 真要例外，只能进 `CI_EXEMPT` / `BATTERY_EXEMPT`，且理由长度必须 > 15 字（写得敷衍也判红）。

命令表（`tooling/scripts/src/lib/commands.ts`）是 `pnpm walnut <id>` 的数据源。新增门禁的顺序固定为：**先加命令表项 → 再加 prepush 段 → 再加电池行 → 再加 workflow 步骤 → 最后跑两个钉死测试**。反过来做的话，中间任何一步都会让测试红在「名字不存在」上，而不是红在真正的问题上。

## 2. 总纲

### 2.1 批次表

| 批次 | 阶段 | 目标一句话 | 前置批次 | 风险 | 工作量感受 |
|------|------|------------|----------|------|------------|
| 1 | P0 | 把「产物与诊断基线」和「`check-pre-hooks` 数据驱动」做掉 | 无 | 低 | 半天到一天 |
| 2 | P1 | Vite 8.0.11 → 8.4.0，并把 `minify` 的取值澄清 | 1 | 低到中 | 半天到一天（大头是视觉回归） |
| 3 | P5-pre | 清 `baseUrl`（16 个文件）并修 `crossOrigin` 真 bug | 2 | 低到中 | 半天 |
| 4 | P2 | oxfmt 正式接入：stylistic 拆除 + lint-staged + CI 阻断 | 3（P0 已够，但排在 P5-pre 后能让首轮格式化同时吃到 paths 变更） | 中 | 一到三天（首轮大 diff） |
| 5 | P3 | Oxlint 双轨：`correctness` 兜底 + 去重 + 归属表 | 4 | 中 | 两到四天 |
| 6 | P4 | tsdown 接管共享包打包：`utils-core` 先行、`contract` 随后 | 2（P1 稳定后） | 中到高 | 两到四天 |
| 7 | P5a/P5b | tsrs 影子接线的配置面 → 影子期满后整批转正 | 3 | 中 | 配置半天；影子期 1–2 周（人工等待） |
| 8 | P5c | TNB 作为 `typescript` 包面接入 + nest-on-TNB PoC（**混合模式**） | 1（基线）、3 | 高 | 一到两天 + 决策等待 |

### 2.2 依赖图

```text
批次 1 (P0) ──► 批次 2 (P1) ──► 批次 3 (P5-pre) ──┬──► 批次 4 (P2) ──► 批次 5 (P3)
                                                   ├──► 批次 6 (P4)
                                                   ├──► 批次 7 (P5a → P5b)
                                                   └──► 批次 8 (P5c，另需批次 1 的 admin 基线)
```

读法：**批次号就是建议执行顺序**；`►` 是硬依赖，`┬`/`├`/`└` 表示「同一条前置之后可以分支，但实际仍按 §2.4 串行」。批次 6、7、8 之间没有代码依赖，但**都改 `pnpm-workspace.yaml` 的 catalog**（批次 8 还改 `overrides`），所以它们实际上必须串行。

### 2.3 文件边界与共享文件租约

**每批独占（owner）的文件** —— 只有这一批可以改它：

| 批次 | 独占文件 |
|------|----------|
| 1 | `tooling/scripts/src/ci/check-pre-hooks.ts`、`tooling/scripts/src/ci/__tests__/check-pre-hooks.test.ts`、新增的同目录数据文件 |
| 2 | `apps/admin/vite.config.ts`（仅 `minify` 与 `checks` 两处） |
| 3 | 16 份 `tsconfig`（清单见 §5.1）、`packages/platform-web/client/src/browser/file/base64.ts`、同目录新增的测试文件 |
| 4 | 新增的 oxfmt 配置文件、`tooling/eslint-config/{base,vue,nest}.ts`（仅 stylistic / prettier 两处）、根 `package.json` 的 `lint-staged`、`apps/docs/.vitepress/config/zh.ts` 以外的格式配置 |
| 5 | 新增的 `.oxlintrc.json`、三个 ESLint 预设的 oxlint 段、`packages/generated/api-types/eslint.config.ts`（如需 ignore 调整） |
| 6 | `packages/platform-any/{utils-core,contract}/` 下的构建配置与 `package.json`、`packages/platform-any/contract/__tests__/entries.drift.test.ts`、`packages/platform-any/contract/scripts/build-barrel.ts`（只读核对，原则上不改） |
| 7 | 各包的 `types:check` / `types:check:tsrs` 脚本、`apps/server/tsconfig.json` 的 `tsBuildInfoFile` |
| 8 | `pnpm-workspace.yaml` 的 `typescript` 条目与 `overrides`、`vue-tsc` 版本 |

**共享文件租约**（多个批次都要碰，但**同一时刻只能有一批在改**）：

| 共享文件 | 谁写什么 | 租约规则 |
|----------|----------|----------|
| `pnpm-workspace.yaml` | 2 改 `vite` 版本；3 无；4 加 `oxfmt`、`eslint-config-prettier`；5 加 `oxlint`、`eslint-plugin-oxlint`、`@oxlint/migrate`；6 加 `tsdown`；7 加 `tsrs`；8 改 `typescript` + 加 `overrides` | **每次只加自己那一条/两条**，插入位置服从既有字母序（`yaml/sort-keys` 会告诉你位置）；改完必须 `pnpm install` 并在回报里贴 `git diff --stat pnpm-lock.yaml` |
| `tooling/scripts/src/lib/commands.ts` | 4 加格式命令；5 加 oxlint 命令；7 加 tsrs 命令 | 只在自己那一批追加条目，不动别人的条目与分组顺序 |
| `tooling/scripts/src/ci/prepush.ts` | 4 加格式化段 | 5 不加入（阶段计划明确：oxlint 先进 CI、不进 prepush） |
| `tooling/release/src/release/steps.ts` | 4 加格式化行 | 与 prepush 段同步；同一批内一起改 |
| `.github/workflows/ci.yml` | 4 加格式化步骤；5 加 oxlint 步骤；7 加 report-only 类型检查步骤 | 只追加自己的步骤，不改别人的步骤名（`ci-workflow.test.ts` 按名字钉住构建类步骤） |
| 根 `turbo.json` | 5 可能登记 `.oxlintrc.json`（仅方案 T，见 §7.6）；7 加 `types:check:tsrs` 任务 | 改 `globalDependencies` 前**先让文件存在**：`check-turbo-cache` 的 `global-dependency-exists` 会判红 |
| 根 `package.json` | 4 改 `lint-staged` 并加 oxfmt devDep；5 加 oxlint devDep | `lint-staged` 的键（glob）只有 4 能改；5 只在值数组里插一项 |

租约的实操含义：**如果不确定另一批是否已经改过共享文件，先 `git diff <文件>` 看一眼当前状态再动手**；发现冲突就停下回报，不要合并别人的改动。

### 2.4 并行规则

- **默认串行**。批次之间共用的 catalog / lockfile / 三表让并行收益小于风险。
- 唯一可考虑并行的是「批次 6（tsdown）」与「批次 7 的 P5a 影子接线」：两者改的文件基本不重叠，但**都要动 catalog 与各包 `package.json`**，所以仍须串行 `pnpm install`（一个装完、另一个再改）。
- 批次 8 的 PoC 可以在**独立工作副本**里做（不动主工作区），但结论必须回填到主工作区再验收。
- 任何并行都必须满足：两批的独占文件不相交、共享文件租约不重叠、`pnpm install` 不并发。

### 2.5 通用验收（每批收尾必跑）

按「最小充分集」跑，跑不了的显式记为未验证：

```bash
# 1) 受影响包的 lint / 类型 / 测试（三表之外最先该绿的）
pnpm exec turbo run lint --filter=<受影响包>
pnpm exec turbo run types:check --filter=<受影响包>
pnpm exec turbo run test --filter=<受影响包>

# 2) 与改动面直接相关的门禁（按批次取子集，见各批「验收」）
pnpm walnut lint:pre-hooks
pnpm walnut lint:exports
pnpm walnut lint:turbo-cache
pnpm walnut lint:lockfile
pnpm walnut boundaries
pnpm walnut syncpack:lint

# 3) 文档类（只要改了 markdown 就跑）
pnpm walnut lint:docs-refs
pnpm walnut lint:doc-ts

# 4) 整表（环境齐备时）
pnpm prepush
```

`pnpm prepush` 里有三段需要本机环境：`openapi`（要 `pnpm setup-env` 解密的 env + PG/Redis）、`post-verify`（Windows 上约 3 分钟）、`workflows`（要 actionlint）。缺环境时按四态口径记 `[SKIP 未验证]`，并在回报里逐个列出。

### 2.6 通用回报模板

每批的回报都按这个骨架写（各批小节里只补充「本批特有的行」）：

```text
批次：<编号与阶段>
结论：完成 / 部分完成 / 阻塞（三选一，不要写「基本完成」）
改了哪些文件：
  - <路径>：<一句话改了什么>
  - <路径>：<新增 / 删除 / 重命名>
跑过的命令与结果：
  - <命令>：exit <码>，<关键读数（耗时 / 条数 / 产物数）>
  - <命令>：SKIP（原因：<缺什么>）
剩余项 / 不确定点：
  - <要么是「无」，要么是具体到能派活的一句>
给主对话的问题：
  - <要么是「无」，要么是必须由人拍板的选择题（附两个选项的代价）>
```

## 3. 批次 1 · P0：基线测量与 `check-pre-hooks` 配置化

**目标一句话**：在换任何工具之前，先能回答「产物和诊断变了吗」；并把「哪些命令必须先跑生成物」从硬编码搬进数据。

**前置**：无（当前分支能 `pnpm build` 即可）。

**产出**：一份基线记录（gitignored 的 `.zcode/` 下）+ `check-pre-hooks` 的数据驱动改造 + 测试。

**回滚**：本批不碰产品代码。基线文件放错位置直接删除；配置化改造回滚见 §3.6。

### 3.1 工作项 A：admin 类型检查基线

这是 P5c 的**对照组**：同一份代码、同一条命令、只换引擎。所以口径必须能复现。

```bash
# 0) 记录代码状态（只读）；基线目录（gitignored）先建出来
mkdir -p .zcode/rust-migration
git rev-parse HEAD
git status --porcelain

# 1) 冷跑：先删掉增量缓存，再计时（Git Bash）
rm -f apps/admin/node_modules/.cache/tsconfig.tsbuildinfo
time pnpm --filter @walnut/admin types:check 2>&1 | tee .zcode/rust-migration/p0-admin-tsc-cold.log
echo "exit=${PIPESTATUS[0]}"

# 2) 热跑：紧接着再跑一次（这才是日常体感）
time pnpm --filter @walnut/admin types:check 2>&1 | tee .zcode/rust-migration/p0-admin-tsc-warm.log
echo "exit=${PIPESTATUS[0]}"
```

PowerShell 用户把 `time …` 换成 `Measure-Command { … | Out-Host }`，`tee` 换成 `Tee-Object`；**同一份基线里不要混两种计时**。

判据与分支：

1. **跑两次取第二次**作为「稳定值」，并同时记录第一次（冷跑）—— P5c 对比时必须用**同一种温度**。
2. 记录四件事：退出码、耗时、诊断行数、完整诊断文本（落 `.zcode/rust-migration/`，不要提交）。
3. **如果退出码非 0 或诊断行数 > 0**：先停下。这说明当前分支的 admin 类型检查本来就是红的，基线不能当对照；在回报里贴前 20 行诊断并问主对话要不要先修。
4. 诊断清单要**归一化**后再存（排序 + 去掉绝对路径前缀 + 统一换行为 LF），P5c 的逐条 diff 直接拿它做基准。

基线记录建议长这样（`jsonc` 只是为了让你能写注释，落盘请写严格 JSON）：

```jsonc
{
  "capturedAt": "2026-11-27T00:00:00+08:00",
  "commit": "<git rev-parse HEAD 的输出>",
  "node": "<node -v>",
  "pnpm": "<pnpm -v>",
  "adminTypesCheck": {
    "coldMs": 0,
    "warmMs": 0,
    "exitCode": 0,
    "diagnosticLines": 0,
    "coldLog": ".zcode/rust-migration/p0-admin-tsc-cold.log",
    "warmLog": ".zcode/rust-migration/p0-admin-tsc-warm.log"
  }
}
```

### 3.2 工作项 B：构建产物与 sourcemap 基线

```bash
# 产物清单：路径 + 字节数（按路径排序，便于后续 diff）
pnpm walnut build:admin
node -e "const{readdirSync,statSync}=require('node:fs');const{join}=require('node:path');const walk=(d,a=[])=>{for(const e of readdirSync(d,{withFileTypes:true})){const p=join(d,e.name);e.isDirectory()?walk(p,a):a.push([p,statSync(p).size])}return a};const rows=walk('apps/admin/dist').sort((x,y)=>x[0].localeCompare(y[0]));require('node:fs').writeFileSync('.zcode/rust-migration/p0-dist-manifest.txt',rows.map(([p,s])=>s+'\\t'+p).join('\\n'));console.log(rows.length,'files')"
```

- sourcemap 两态：`apps/admin/env-local/.env.production` 里 `VITE_BUILD_SENTRY` 置 `false` 构建一次（断言 `dist` 下无 `.map`），再置 `true` 构建一次（断言有 `.map`；Sentry 上传是否成功只记录、不当判据 —— 本机通常缺 token）。改这个文件是 gitignored 的，改完记得复原。
- CSS 视觉基线：登录 / 列表 / 表单 / 暗色主题各截一张，视口与主题固定写在文件名里（如 `login-1440x900-light.png`）。这是批次 2 `cssCodeSplit: false` + Lightning CSS 的回归依据。

### 3.3 工作项 C：`check-pre-hooks` 配置化

现状（读一遍再动手）：`CONSUMERS` 是硬编码的 `Set(['vite', 'vue-tsc'])`，`EXEMPT_SUBCOMMAND` 是单个常量 `'preview'`，判据是「包内有 `build/generate/` ⇒ 跑这些命令的脚本必须有 `pre<script>`」。

改法（只动三个文件；下面第 3 条是可选项）：

1. **新增数据文件**（与 `check-pre-hooks.ts` 同目录，文件名 `pre-hook-consumers.ts`）：唯一真源，导出数组而不是集合，让每条都能带理由与例外：

```ts
/** 「会读生成物」的可执行名字。新增消费者只改这份数据，不动门禁逻辑。 */
export interface PreHookConsumer {
  /** 脚本首词（剥掉 cross-env / KEY=value 之后比对） */
  bin: string
  /** 这些子命令伺服的是已构建产物，不要求 pre 钩子（如 `vite preview`） */
  exemptSubcommands?: readonly string[]
  /** 凭什么它算消费者 —— 写给人看，也写在数据里而不是注释里 */
  why: string
}

export const PRE_HOOK_CONSUMERS: readonly PreHookConsumer[] = [
  {
    bin: 'vite',
    exemptSubcommands: ['preview'],
    why: 'vite 的检查器（vite-plugin-checker）可能在插件把 dts 写盘之前就建好 TS program（2026-09-24 Build admin 事故）',
  },
  {
    bin: 'vue-tsc',
    why: 'vue-tsc 是最早读生成物的那个：types:check 前必须已经生成组件声明与 schema',
  },
]
```

2. **改门禁逻辑**（`check-pre-hooks.ts`）：把 `CONSUMERS` / `EXEMPT_SUBCOMMAND` 换成从数据派生的查表；`findingsForPackage` 增加一个可注入的参数（默认取 `PRE_HOOK_CONSUMERS`），保持它是纯函数 —— 现有测试全靠纯函数 + 注入的 `fileExists`，这条性质不要破坏：

```ts
export interface PackageFacts {
  label: string
  scripts: Record<string, string>
  hasGenerators: boolean
  fileExists: (rel: string) => boolean
}

export function findingsForPackage(
  facts: PackageFacts,
  consumers: readonly PreHookConsumer[] = PRE_HOOK_CONSUMERS,
): Finding[] {
  // 实现不变：查表 → 命中消费者 → 看有没有 pre<script> → 核对钩子里的 node <文件> 是否存在
  return []
}
```

3. **改规则 id 与文案（可选但推荐）**：`vite-script-needs-pre-generate` 这个名字在「消费者不止 vite」之后会误导排查。建议改成 `consumer-script-needs-pre-generate`，detail 里的「vite 的检查器」改成「这个消费者」。**如果不想动历史日志里的 id，保持原名也接受** —— 两种都在回报里写明选了哪种。

4. **同步测试**（`check-pre-hooks.test.ts`）：现有用例的**语义**全部保留（哪条断言什么，不要删）；另外补两条：

```ts
import { describe, expect, it } from 'vitest'
import { findingsForPackage } from '../check-pre-hooks.ts'

const adminLike = { label: '@walnut/admin', hasGenerators: true, fileExists: () => true }

describe('数据驱动：新增消费者只改数据', () => {
  it('注入一个新消费者后，它自动被要求 pre 钩子', () => {
    const findings = findingsForPackage(
      { ...adminLike, scripts: { build: 'oxfmt build' } },
      [{ bin: 'oxfmt', why: '用例：证明名单来自数据而不是硬编码' }],
    )
    expect(findings).toHaveLength(1)
    expect(findings[0]?.detail).toContain('prebuild')
  })

  it('真实名单里至少有 vite 与 vue-tsc（防「数据被清空却全绿」）', () => {
    // 空名单会让所有断言静默通过 —— 这是本仓最忌讳的失效形态
    expect(findingsForPackage({ ...adminLike, scripts: { build: 'vite build' } })).toHaveLength(1)
    expect(findingsForPackage({ ...adminLike, scripts: { 'types:check': 'vue-tsc --noEmit' } })).toHaveLength(1)
  })
})
```

### 3.4 工作项 D：纪律落纸

阶段计划的第 6 条验收要求「明确写下三表 + 钉死测试不可绕过」。**不要为此新增文档文件**：它已经写在根 `AGENTS.md` 关键纪律 2 与 `tooling/scripts/src/ci/prepush.ts` 的文件头。本项的动作是：在回报里引用这两处，并确认你读过了。

### 3.5 验收

```bash
# 单元测试（只跑这一个文件，别跑整包）
pnpm --filter @walnut/scripts exec vitest run src/ci/__tests__/check-pre-hooks.test.ts

# 门禁本体（它跑的就是真仓）
pnpm walnut lint:pre-hooks

# 脚本包自身的 lint / 类型（改了它的源码）
pnpm --filter @walnut/scripts run lint
pnpm --filter @walnut/scripts run types:check
```

逐条对照阶段计划 P0 的 6 条验收：产物快照（§3.2）、sourcemap 两态（§3.2）、截图基线（§3.2）、admin 基线三件套（§3.1）、`check-pre-hooks` 数据驱动且新增消费者有测试（§3.3）、三表纪律已确认（§3.4）。

### 3.6 回滚

- 基线文件：删 `.zcode/rust-migration/` 即可，不影响仓库。
- 配置化：把 `check-pre-hooks.ts` 与测试改回硬编码版本、删除新增数据文件。行为等价（同一份名单），所以「不回滚」也是可用的中间态 —— 但**不要**留下「数据文件存在、门禁仍读硬编码」的半成品。

### 3.7 本批回报模板

按 §2.6 的骨架，本批这四行必须写实（不许留空，也不许写「同上」）：

- **改了哪些文件**：`check-pre-hooks.ts`（改成读数据）、新增的数据文件、测试文件；**没改**产品代码与任何门禁表。
- **跑了哪些验收命令及结果**：§3.5 的四条逐条给退出码与关键读数。
- **剩余项/不确定点**：例如 rule id 是否改名、`vite preview` 之外的例外要不要加。
- **给主对话的问题**：基线是否可作为 P5c 的对照（附读数）。

本批特有的必报项（缺了等于没做）：

- admin `types:check` 的冷/热耗时与诊断行数（这是 P5c 唯一可用的对照数据，缺了它批次 8 无法开始）。
- `check-pre-hooks` 改造选的 rule id 方案（保留 / 改名）与理由。
- 新增消费者的测试用例是否真的能红（把数据清空试一次，确认第二条用例会红）。

## 4. 批次 2 · P1：Vite 收尾

**目标一句话**：把已在 Rolldown 上的 admin 构建推到 8.4.0，并把唯一一处配置矛盾（`minify: 'esbuild'`）改成一个明确取值。

**前置**：批次 1（产物与截图基线可用）。

### 4.1 版本升级

| 文件 | 动作 | 要点 |
|------|------|------|
| `pnpm-workspace.yaml` | `vite: 8.0.11` → `8.4.0` | 只改这一条；catalog 里 Rolldown 版本随 Vite 走，不单独列出 |
| `pnpm-lock.yaml` | 由 `pnpm install` 生成 | 只提交（由主对话）与 vite / rolldown 相关的行；出现无关包的漂移要查原因 |

```bash
pnpm install
git diff --stat pnpm-lock.yaml
# 读一下 lockfile 变动的包名，确认只有 vite 及其传递依赖（rolldown 等）动了
pnpm exec turbo run build --filter=@walnut/admin --force
```

如果 `pnpm install` 报解析失败，先看 `minimumReleaseAge`（8.4.0 是否发布满 24h）与 `trustPolicy`（可信度下降），**不要**放宽全局设置。

### 4.2 `minify` 的取值澄清

现状是两处不一致：`build.minify: 'esbuild'`（而仓内没有 esbuild，`allowBuilds` 里 esbuild 还是 `false`），同时 `rolldownOptions.output.minify` 已经用了 Oxc 的对象形态控制 `dropConsole` / `dropDebugger`。

**推荐改法（方案 A）**：删掉 `build.minify` 那一行，让 Vite 用默认的 `'oxc'`；`dropConsole` / `dropDebugger` 继续只在 `rolldownOptions.output.minify` 里表达（它是唯一的细节位）。理由：仓库里没有 esbuild，而 `'oxc'` 已经是 Vite 8 的默认，显式写一遍反而制造第二个真源。

方案 B（等价，显式）：把 `build.minify` 写成 `'oxc'`。

**两种都别做的写法**：把 `{ compress: { … } }` 对象塞进 `build.minify` —— 它只接受 `'oxc' | 'esbuild' | 'terser' | boolean`，对象形态属于 `rolldownOptions.output.minify`。写错了 `types:check` 会红，但红在 `UserConfig` 上不一定一眼看懂。

改完的目标形状（只列相关行）：

```ts
// apps/admin/vite.config.ts 的 build 段（只列相关行，其余保持原样）
const build = {
  // 不写 minify: 默认就是 Oxc（Vite 8）；细节只在下面这一处表达，避免两个真源
  outDir: processedEnv.build.outDir,
  cssCodeSplit: false,
  target: 'esnext',
  sourcemap: processedEnv.build.sentry.enabled,
  rolldownOptions: {
    output: {
      // …既有 chunkFileNames / entryFileNames / assetFileNames / codeSplitting 不动
      minify: processedEnv.build.dropConsole
        ? { compress: { dropConsole: true, dropDebugger: true } }
        : undefined,
    },
  },
}
```

### 4.3 只读核对（不改）

```bash
# manualChunks 对象形态在 Vite 8 下是 TS2769 硬错，确认没有残留
grep -rn "manualChunks" apps/admin tooling/vite-config packages --include="*.ts"

# 共享包仍在用 rollupOptions 键名：Vite 8 作为 rolldownOptions 的弃用别名保留
grep -rn "rollupOptions" packages/platform-any --include="*.ts"

# 插件耗时告警（可选降噪）：rolldownOptions.checks.pluginTimings
grep -rn "pluginTimings" apps/admin tooling/vite-config --include="*.ts"
```

`manualChunks` 有命中就停下回报（说明 Vite 8 下会直接红）。`rollupOptions` 在共享包里属于**批次 6** 的范围，本批只确认「仍被接受」，不改名。

可选项：`rolldownOptions.checks.pluginTimings: false`（关插件耗时告警）。它不改产物，属于降噪；做了就在回报里写一句。

### 4.4 回归点（本批真正的工作量）

1. **CSS 顺序与去重**（`cssCodeSplit: false` + Lightning CSS 的组合）：拿 §3.2 的产物清单比对 CSS 文件数与体积；再对 CSS 内容做一次「规则顺序」抽查（取前 200 行选择器序列，与基线比）。顺序变了不等于错，但**每一条差异都要能解释**（Lightning CSS 的压缩与去重语义）。
2. **Sentry sourcemap**：两态各跑一次（见 §3.2 的做法），确认「关了没 `.map`、开了有 `.map`」没变。
3. **plugin-legacy 产物**：`VITE_BUILD_LEGACY=true` 构建一次，确认 legacy 产物仍生成、目标不是 ES5（Vite 8 已不支持降到 ES5）。
4. **视觉基线**：关键页截图与 §3.2 一致；有差异就逐条说明。

```bash
# 产物存在性 + 冒烟 + 去密体检（顺序不能反：后两步读的就是 dist）
pnpm exec turbo run build --filter=@walnut/admin --force
pnpm walnut smoke:dist
pnpm walnut lint:dist
```

### 4.5 验收

```bash
pnpm exec turbo run build --filter=@walnut/admin --force
pnpm walnut smoke:dist
pnpm walnut lint:dist
pnpm walnut types:check
pnpm walnut lint
pnpm walnut test
```

阶段计划的 6 条验收逐条对应：构建/类型/测试全绿（上面前三条）、`minify` 有结论（§4.2）、CSS 回归有解释（§4.4）、sourcemap 与 legacy 有结论（§4.4）、**不改分包策略**（本批不动 `codeSplitting.groups`）、门禁命令未变（三表无需动）。

### 4.6 回滚

把 `pnpm-workspace.yaml` 的 `vite` 改回 `8.0.11`、`apps/admin/vite.config.ts` 的 `minify` 行恢复原样，然后：

```bash
pnpm install
pnpm exec turbo run build --filter=@walnut/admin --force
```

回滚后重跑 §3.2 的产物比对，确认没有残留的新 hash chunk（`clean:build` 已在 turbo 里兜住这一点，但手工构建不受 turbo 管）。

### 4.7 本批回报模板

按 §2.6 的骨架，本批这四行必须写实：

- **改了哪些文件**：`pnpm-workspace.yaml`（`vite` 一行）、`apps/admin/vite.config.ts`（`minify` / 可选的 `checks`）。
- **跑了哪些验收命令及结果**：§4.5 的六条逐条给退出码。
- **剩余项/不确定点**：CSS 差异解释、`pluginTimings` 要不要关。
- **给主对话的问题**：`minify` 取方案 A 还是 B（若你有更强的理由）。

本批特有的必报项：

- 锁文件变动的包清单（只该有 vite 与 rolldown 系）。
- `minify` 选的是方案 A 还是 B，以及 `output.minify` 是否仍是唯一细节位。
- CSS 差异清单（没有差异也要写「零差异」）。
- sourcemap 两态与 legacy 的结论。

## 5. 批次 3 · P5-pre：`baseUrl` 清理与真 bug 修复

**目标一句话**：把 TS7 / tsrs 在**配置加载阶段**就会判死的 `baseUrl` 清掉，并顺手修掉它捞出来的那个真 bug。

**前置**：批次 2（Vite 已稳定，避免两件事同时变）。

**为什么它排在 P2 之前**：清完 `baseUrl` 会**同时解除 oxlint type-aware 的硬阻塞**（`baseUrl` 是 type-aware 的硬阻塞），所以 P3 的类型感知观测不必再等一次。

### 5.1 生成清单（以 grep 为准）

```bash
grep -rn '"baseUrl"' --include="tsconfig*.json" . --exclude-dir=node_modules --exclude-dir=.git | sort
grep -rln '"paths"' --include="tsconfig*.json" . --exclude-dir=node_modules --exclude-dir=.git | sort
```

2026-11-27 的命中清单（**执行时以 grep 为准；`build/image/**` 是 gitignored 的发布期产物，不许手改**）：

| # | 文件 | 有 `paths` 吗 | 动作 |
|---|------|---------------|------|
| 1 | 仓库根 `tsconfig.json` | 否 | 删 `baseUrl` |
| 2 | `apps/admin/tsconfig.json` | **是** | 删 `baseUrl` + paths 加 `./` 前缀 |
| 3 | `apps/docs/tsconfig.json` | 否 | 删 `baseUrl` |
| 4 | `apps/e2e/tsconfig.json` | 否 | 删 `baseUrl` |
| 5 | `packages/generated/api-types/tsconfig.json` | 否 | 删 `baseUrl` |
| 6 | `packages/platform-any/contract/tsconfig.json` | 否 | 删 `baseUrl` |
| 7 | `packages/platform-any/types/tsconfig.json` | 否 | 删 `baseUrl` |
| 8 | `packages/platform-any/utils-core/tsconfig.json` | 否 | 删 `baseUrl` |
| 9 | `packages/platform-web/client/tsconfig.json` | 否 | 删 `baseUrl` |
| 10 | `packages/platform-web/http/tsconfig.json` | 否 | 删 `baseUrl` |
| 11 | `tooling/commitlint-config/tsconfig.json` | 否 | 删 `baseUrl` |
| 12 | `tooling/eslint-config/tsconfig.json` | 否 | 删 `baseUrl` |
| 13 | `tooling/release/tsconfig.json` | 否 | 删 `baseUrl` |
| 14 | `tooling/scripts/tsconfig.json` | 否 | 删 `baseUrl` |
| 15 | `tooling/vite-config/tsconfig.json` | 否 | 删 `baseUrl` |
| 16 | `tooling/vitest-config/tsconfig.json` | 否 | 删 `baseUrl` |

`apps/server/tsconfig.json` 本来就没有 `baseUrl`，不要动它（它的 paths 已经是相对写法，这正是它能零改动通过 TS7 实测的原因）。

### 5.2 机械删除

除 #2 外，其余 15 个文件是纯删除一行（`"baseUrl": ".",`），语义零变化（它们都没有 `paths`）。逐个删、逐个看 diff；**不要写脚本批量替换** —— 15 个文件里删错一个逗号就是 JSON 语法错，而且批量脚本会把 `build/image/**` 的副本一起改掉。

### 5.3 `apps/admin/tsconfig.json` 的 paths 改写

这是**唯一有语义风险**的一处：没有 `baseUrl` 之后，paths 的值必须相对 tsconfig 自身，否则报 TS5090。

改前：

```jsonc
{
  "baseUrl": ".",
  "paths": {
    "@/*": ["src/*"],
    "~/*": ["types/*"]
  }
}
```

改后：

```jsonc
{
  // baseUrl 已移除：TS7 / tsrs 判它是 TS5102 硬错误，ignoreDeprecations 无效
  "paths": {
    "@/*": ["./src/*"],
    "~/*": ["./types/*"]
  }
}
```

`typeRoots` 已经是 `./node_modules/@types/` / `./types` 这样的相对写法，不用改。`tsconfig.dts.json` `extends` 主配置，自动继承新 paths，不用改。

### 5.4 真 bug：`crossOrigin` 的大小写

`packages/platform-web/client/src/browser/file/base64.ts` 第 45 行：

```ts
// 改前（TS6 不报；TS7.1 的 lib.dom 收紧成 "anonymous" | "use-credentials" | null，报 TS2820）
img.crossOrigin = 'Anonymous'

// 改后
img.crossOrigin = 'anonymous'
```

这不是风格问题：按 WHATWG，大写 `Anonymous` 不是合法值、会退化成 no-cors，**跨域图转 base64 会静默失败**（图能加载、`toDataURL` 出来是空白）。所以无论迁不迁 tsrs 都该修。

回归证据（二选一，优先第一种）：

1. 在**同目录**新增 `base64.test.ts`（jsdom 环境已由该包的 vitest 配置提供），用假 `Image` 捕获 `crossOrigin` 赋值、假 canvas 让 `toDataURL` 返回固定串：

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { imgUrlToBase64 } from './base64.ts'

describe('imgUrlToBase64 的 crossOrigin', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('必须是规范允许的小写 anonymous（大写会退化成 no-cors，跨域图转 base64 静默失败）', async () => {
    const instances: FakeImage[] = []

    class FakeImage {
      crossOrigin: string | null = null
      height = 4
      width = 4
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      set src(_value: string) {
        // 源码里 src 先赋值、onload 后挂，所以必须延后触发，否则 Promise 永远不 resolve
        queueMicrotask(() => this.onload?.())
      }

      constructor() {
        instances.push(this)
      }
    }

    vi.stubGlobal('Image', FakeImage)
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: () => {} } as never)
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AA==')

    await imgUrlToBase64('https://example.com/a.png')

    expect(instances).toHaveLength(1)
    expect(instances[0]?.crossOrigin).toBe('anonymous')
  })
})
```

这段测试的判据只有一行：`instances[0]?.crossOrigin` 必须是 `'anonymous'`。**别为了让测试过而放宽它** —— 它守的就是那个小写。

2. 退路：手工验证记录（在浏览器里对一张跨域图调用该函数，确认 `toDataURL` 不是空白），写进回报并注明「无自动化回归」。

### 5.5 验收

```bash
# 全仓类型检查（这条是主判据）
pnpm walnut types:check

# admin 的 SFC 检查单独跑一次（它不在 turbo 的普通路径上）
pnpm --filter @walnut/admin types:check

# 覆盖范围没变：清理前后的 --listFiles 项目文件集必须一致
# （每个包各跑一次，比较排序后的文件名列表；差异为零才提交）
pnpm --filter @walnut/utils exec tsc --noEmit --listFiles | sort > .zcode/rust-migration/listfiles-utils-after.txt

# contract 的快照/一致性测试（contract 有快照测试守护）
pnpm --filter @walnut/contract run test

# 受影响的静态门禁
pnpm walnut lint:pre-hooks
pnpm walnut lint:exports
```

`--listFiles` 的「清理前」清单要在**本批开始时**先跑一遍留档（当前 HEAD），否则事后没有对照。

### 5.6 回滚

逐文件把 `baseUrl` 加回去、admin 的 paths 去掉 `./` 前缀、`base64.ts` 改回 `'Anonymous'`，然后 `pnpm walnut types:check` 复核。回滚后 P3 的 type-aware 与批次 7、8 全部退回等待。

### 5.7 本批回报模板

按 §2.6 的骨架，本批这四行必须写实：

- **改了哪些文件**：16 份 `tsconfig`（逐个列或按表引用）、`base64.ts`、新增的测试。
- **跑了哪些验收命令及结果**：§5.5 的每条逐条给退出码；`--listFiles` 差异逐包报。
- **剩余项/不确定点**：base64 的回归是自动化还是手工。
- **给主对话的问题**：若某些包的 `--listFiles` 差异不为零，要不要先暂停。

本批特有的必报项：

- 实际删除的文件数与 grep 命中数是否一致（不一致要解释）。
- `--listFiles` 的差异是否为零（逐包）。
- base64 的回归证据是自动化还是手工。
- 是否观察到任何「运行时才炸」的路径（admin 的 `@/*` 别名既有 vue-tsc 走也有 Vite 的 `resolve.alias` 走，两套都要绿 —— Vite 侧看 `apps/admin/vite.config.ts` 的 `alias`，它不走 tsconfig paths）。

## 6. 批次 4 · P2：oxfmt 正式接入

**目标一句话**：把「格式」交给 oxfmt 这个唯一真源，ESLint 退出格式职责，`oxfmt --check` 进阻断门禁。

**前置**：批次 3（P5-pre 已合入，首轮格式化不会与 paths 变更混在一个 diff 里）。

### 6.1 安装前核对（三条，缺一条就可能装不上或装错）

```bash
# 1) 版本存在性与发布时间（minimumReleaseAge: 1440 = 必须发布满 24h）
npm view oxfmt time --json

# 2) 包名与 bin 名（0.x 期间改名过；bin 名以包的 package.json 为准）
npm view oxfmt bin --json

# 3) 配置文件名与选项名（0.x 的 key 会跨版本改名，抄旧配置会静默失效）
pnpm dlx oxfmt@0.80.0 --help
```

预期：catalog 里写 `oxfmt: 0.80.0`（**精确锁**，不用范围）。升级单独成批或单独成提交，逐 key 对照当版文档。

### 6.2 依赖与配置落地

| 文件 | 动作 |
|------|------|
| `pnpm-workspace.yaml` | catalog 加 `oxfmt: 0.80.0`（字母序在 `otplib` 与 `pagefind` 之间）与 `eslint-config-prettier`（在 `eslint` 与 `eslint-plugin-turbo` 之间） |
| 根 `package.json` | devDependencies 加 `"oxfmt": "catalog:"`；`lint-staged` 改成数组形态（见 §6.4） |
| 新增 oxfmt 配置文件 | 文件名按 6.1 第 3 步核对的结果；0.80.0 的惯例是与 `.oxlintrc.json` 对齐的 `.oxfmtrc.json` |
| `tooling/eslint-config/package.json` | dependencies 加 `"eslint-config-prettier": "catalog:"`（预设要 import 它） |

配置内容（值都有来处，别改）。**这段用 `jsonc` 写是为了带注释；落盘是否允许注释取决于 6.1 第 3 步核对的结果 —— 只吃严格 JSON 就把注释全部删掉（取值不动）。**

```jsonc
{
  // 这三种取值不是偏好，是对齐当前 ESLint 侧的实际配置（下方有 --print-config 证据）
  "semi": false,
  "singleQuote": true,
  "tabWidth": 2,
  // 已拍板：oxfmt 默认值 100（Prettier 是 80）；接受首轮一次性大 diff
  "printWidth": 100,
  // 与 antfu 的 style/comma-dangle=always-multiline 对齐；不同会与 ESLint 打架
  "trailingComma": "all",
  // 首轮关闭：默认 true 会重排所有 package.json，与 catalog 的顺序规则打架
  "sortPackageJson": false,
  // 刻意不写 sortImports（默认关）：要开是后续独立一步、单独回滚（Sentry 有 customGroups 排序回归实录）
  "ignorePatterns": [
    "**/dist/**",
    "**/dist-staging/**",
    "**/dist-stage/**",
    "**/coverage/**",
    "**/.turbo/**",
    "**/node_modules/**",
    "**/env-local/**",
    "pnpm-lock.yaml",
    // 生成物：openapi.json 由 openapi:export 重写、schema.d.ts 由它生成，格式化会与 git diff 门禁打架
    "apps/server/openapi.json",
    "packages/generated/**",
    "apps/admin/types/generated/**",
    // 首轮不碰 markdown：VitePress 的自定义块（tabs / mermaid / 容器）需要单独一轮验证（§6.3）
    "**/*.md"
  ]
}
```

`trailingComma` 的依据（可复跑，别凭记忆）：

```bash
pnpm exec eslint --print-config packages/platform-any/utils-core/src/index.ts | grep -A3 'style/comma-dangle'
# 实测输出：["error","always-multiline"]  → 对应 oxfmt 的 "all"
pnpm exec eslint --print-config packages/platform-any/utils-core/src/index.ts | grep -A2 '"style/semi"'
# 实测输出：["error","never"] → semi: false
```

### 6.3 首轮试跑（只量、不改）

分三段量，每段都记录「涉及文件数 / diff 行数 / 形态」：

```bash
# S1：前端源码（最有代表性，含 .vue）
pnpm exec oxfmt --check apps/admin/src

# S2：共享包与工具链源码
pnpm exec oxfmt --check packages tooling

# S3：仓库根的配置（*.ts / *.json / *.yaml；不引号让 shell 只展开根目录下的文件）
pnpm exec oxfmt --check *.ts *.json *.yaml
```

判据：

- S1 的 diff 规模决定首轮工作量；`.vue` 的模板换行差异要单独看一眼（Pinia 证明 `.vue` 可以整个交给 oxfmt，但模板换行行为与 ESLint 侧不一定逐字一致）。
- **S3 里如果出现 `tsconfig*.json` 的键序变化**：那是 `sortPackageJson` 管不到的地方，说明 oxfmt 也会重排 JSON 键。这类改动要与「只动空白」的承诺分开评估 —— 键序变化不算逻辑改动，但会让 review 变难，必要时给 `tsconfig*.json` 加 ignore 并在回报里写明理由。
- 首轮 `--write` 由主对话安排成**单独一个提交**（agent 不许 commit）。agent 的动作是：跑 `--write`、把 `git diff --stat` 与「有没有非空白改动」的抽查结果写进回报。抽查方法：`git diff -w --stat` 与 `git diff --stat` 的行数应当相差很小（纯空白改动在 `-w` 下会消失）。

### 6.4 lint-staged 与 lefthook

根 `package.json` 的 `lint-staged` 改成数组（**顺序固定**，`oxlint` 的位次由批次 5 插入）。**`package.json` 是严格 JSON：下面两个注释不能带进去，理由写进回报即可。**

```jsonc
{
  "lint-staged": {
    // 顺序就是所有权：先格式化，再 lint。
    // 批次 5 会在 oxfmt 与 eslint 之间插入 "oxlint --fix"，位次现在就要守住。
    "*.{ts,vue,js}": [
      "oxfmt --write",
      "eslint --fix --concurrency=4"
    ]
  }
}
```

- `lefthook.yml` **不需要改**（`--max-arg-length=4000` 在它的 `run` 值里，原样保留）。
- 如果确实要改 `lefthook.yml` 的 `run` 值：**不许带双引号**（Windows 上 lefthook 的引号拼接会静默丢参，`lefthook-config.test.ts` 机械拦）。
- glob 只有 `*.{ts,vue,js}` 这一版：JSON / YAML / CSS 的格式化**只在 `format:check` 门禁里覆盖**，不在 pre-commit 自动改。这是有意的（pre-commit 只碰代码，避免提交时静默重排配置文件）。

### 6.5 stylistic 彻底拆除

三个预设都走同一条改法（`tooling/eslint-config/base.ts`、`vue.ts`、`nest.ts`）：

```ts
import eslintConfigPrettier from 'eslint-config-prettier/flat'

export default function baseConfig(options: OptionsConfig = {}): WalnutEslintConfig {
  return antfu(
    {
      // …既有 ignores / markdown / pnpm / rules 不动
      ...options,
      // 硬边界：格式的唯一真源是 oxfmt。放在 ...options 之后，调用方也改不回去
      stylistic: false,
    },
    turboEnvVarsConfig(),
    commentPolicyConfig(),
    // 兜底：万一有格式化规则漏网，由它关掉，防止两个工具互相改回去
    eslintConfigPrettier,
  )
}
```

四条注意：

1. `eslint-config-prettier/flat` 是 v9+ 的 flat 入口。装完先 `node -p "Object.keys(require('eslint-config-prettier/package.json').exports || {})"` 核对有没有这个子路径；没有就退回默认导出并包成 `{ rules: … }`。**别猜**。
2. `perfectionist` 的 import / export 排序**不受 `stylistic: false` 影响**（实测 antfu 8.2.0 的 `perfectionist()` 在组合里是无条件挂上的）。所以「排序暂留 ESLint」这条决策自动成立，不需要额外配置；但要在回报里贴一条验证：`pnpm exec eslint --print-config <某 ts 文件> | grep perfectionist/sort-imports` 仍然存在。
3. `stylistic: false` 会让 antfu 的 `jsdoc` / `imports` / `vue` 等子配置也收不到 stylistic 选项 —— 这是预期行为（它们内部的格式类规则一起交给 oxfmt）。
4. 拆完之后**跑一次全仓 lint**：任何「oxfmt 写一套、ESLint 要求另一套」的文件都会在这里现形。全绿才算拆干净。

### 6.6 门禁三表接线（本批的第二个成本大头）

命名约定（一次定死，后续批次沿用）：命令 id `format:check`（只读）与 `format:fix`（写），prepush 段 id `format`。

按 §1.5 的顺序，五处一次改完：

1. `tooling/scripts/src/lib/commands.ts`（门禁组）新增两条：

```ts
// COMMANDS 数组里新增的两项
const formatCommands = [
  {
    id: 'format:check',
    group: '门禁',
    label: '格式检查（oxfmt --check，唯一真源）',
    why: '格式的唯一真源是 oxfmt；ESLint 已退出格式职责（stylistic: false），所以这一面没有第二条闸',
    argv: ['exec', 'oxfmt', '--check', '.'],
  },
  {
    id: 'format:fix',
    group: '门禁',
    label: '格式化（oxfmt --write，会改文件）',
    why: '本地一次改完；改完仍要跑 format:check 确认没有剩下的',
    argv: ['exec', 'oxfmt', '--write', '.'],
  },
]
```

2. `tooling/scripts/src/ci/prepush.ts` 新增一段（放在 `lint-root` 之后，读起来与「格式」相邻）：

```ts
// 加进 PREPUSH_GATES 的一项
const formatGate = {
  id: 'format',
  label: '格式检查（oxfmt --check）',
  argv: ['format:check'],
  why: '格式的唯一真源已从 ESLint 拆到 oxfmt（stylistic: false）；缺这一段时唯一能看见格式漂移的是 CI',
}
```

3. `tooling/release/src/release/steps.ts` 的 `RELEASE_BATTERY` 加一行（必须在本批内加，否则 `gate-wiring.test.ts` 判红）：

```ts
// 加进 RELEASE_BATTERY 的一行
const formatBatteryRow = {
  id: 'format',
  label: '格式检查（oxfmt --check）',
  argv: ['format:check'],
}
```

4. `.github/workflows/ci.yml` 的 quality job 里加一步（放在 lint 之后；**只写 run 行，不要引入任何 GitHub 表达式**）：

```yaml
- name: Format check (oxfmt)
  run: pnpm walnut format:check
```

5. 跑两个钉死测试：

```bash
pnpm --filter @walnut/scripts exec vitest run src/ci/__tests__/gate-wiring.test.ts src/ci/__tests__/ci-workflow.test.ts
```

`local-ci.ts` **不加**格式化步骤：它是「构建类步骤」的表（要产物、要顺序、要数据库），静态格式检查塞进去会破坏那张表的语义。这个取舍要写进回报。

### 6.7 验收

```bash
# 拆干净了：lint 全绿，且没有文件在 oxfmt 与 ESLint 之间来回改
pnpm walnut lint
pnpm walnut types:check
pnpm walnut test

# 格式门禁真的会红（阻断生效，而不是只跑不判）
pnpm walnut format:check
# 造一个坏格式的文件（例如把某行的逗号后不加空格），再跑一次，必须非零退出；验完改回去
```

阶段计划的 7 条验收逐条对应：小范围试跑（§6.3）、首轮单独提交（由主对话切分，agent 提供 diff 证据）、stylistic 拆除后三绿（上）、`--check` 在干净仓库通过且故意改坏会红（上）、lint-staged 顺序与 lefthook 引号（§6.4）、`sortPackageJson` 与 `sortImports` 的处置（配置里写死并在回报里登记为后续事项）、精确锁版本（§6.1）。

### 6.8 回滚

三件事分开回退，**回退格式回归的方式是改版本号，不是撤门禁**：

- 格式规则本身有问题 → 把 catalog 的 `oxfmt` 降到上一个可用版本（并在回报里给出触发条件），门禁保留。
- stylistic 拆除引发大面积冲突 → 三处 `stylistic: false` 与 `eslintConfigPrettier` 一起删掉，恢复 ESLint 的格式职责；oxfmt 门禁此时必须**一起撤**（两个真源并存会互相改回去）。
- 门禁接线 → 撤掉 prepush 段 + 电池行 + CI 步骤 + 两条命令表项（撤任何一处都要同时撤其余，否则 `gate-wiring.test.ts` 红）。

首轮格式化提交建议保留（纯格式改动，留着无害）。

### 6.9 本批回报模板

按 §2.6 的骨架，本批这四行必须写实：

- **改了哪些文件**：oxfmt 配置、三个 ESLint 预设、根 `package.json`、catalog、命令表、prepush、电池、CI。
- **跑了哪些验收命令及结果**：§6.7 的每条逐条给退出码；钉死测试单独报。
- **剩余项/不确定点**：markdown 覆盖（S3 之外）与 `sortImports` 的后续安排。
- **给主对话的问题**：首轮格式化的 diff 规模是否接受、要不要拆成两个提交。

本批特有的必报项：

- 三段试跑的文件数与 diff 行数（S1/S2/S3 分开报）。
- `trailingComma` / `semi` / `singleQuote` 的 `--print-config` 实测输出（证明取值有依据）。
- `eslint-config-prettier` 的入口子路径是否可用（flat / 默认导出）。
- 三表 + CI 的四处接线是否在同一次改动里完成，两个钉死测试的结果。
- 「首轮格式化的非空白改动」抽查结论。

## 7. 批次 5 · P3：Oxlint 双轨

**目标一句话**：让 oxlint 先跑一遍快速检查，ESLint 继续跑它独有的面（Vue 模板、本地规则、类型感知分层），并对每类报告给出归属。

**前置**：批次 4（格式与 lint 的边界已定、`oxfmt` 已在 pre-commit 里）。

### 7.1 依赖

```bash
npm view oxlint version
npm view oxlint time --json
npm view eslint-plugin-oxlint version   # 必须与 oxlint 同版（锁步）
npm view @oxlint/migrate version        # 只用来生成初版，用完可删
```

catalog 加三条（字母序：`@oxlint/migrate` 在 `@nestjs/*` 之后、`@playwright/test` 之前；`oxlint` 在 `oxfmt` 之后）。**版本号一律写 `npm view` 查到的精确值，不留占位符**：

```jsonc
{
  "@oxlint/migrate": "<执行时查到的精确版本>",
  "eslint-plugin-oxlint": "1.95.0",
  "oxlint": "1.95.0"
}
```

`eslint-plugin-oxlint` 装进 `tooling/eslint-config` 的 dependencies（预设要 import 它）；`oxlint` 装根 devDependencies；`@oxlint/migrate` 装根 devDependencies 并在**本批收尾时删掉**（临时工具，留在 catalog 里是死条目）。

### 7.2 生成初版配置，再手工收敛

```bash
pnpm exec oxlint-migrate           # 或按 @oxlint/migrate 的实际 bin 名执行
```

生成的初版会很长。**不要直接用**：手工收敛成「`categories.correctness` 兜底 + 少量显式差异规则」（已拍板形态，不手抄几百条规则）。

`.oxlintrc.json` 目标形状（下面用 `jsonc` 带注释；落盘时优先按**严格 JSON** 写 —— 注释只是本文档的讲解，别指望工具一定接受）：

```jsonc
{
  "categories": { "correctness": "error" },
  "rules": {
    // 只放「兜底抓不到、但本仓确实要」的增量规则。
    // 不要预先抄一批：增量规则应当来自观测到的真问题，一条一条加、每条写清为什么。
    "no-console": "off"
  },
  "ignorePatterns": [
    "**/dist/**",
    "**/dist-staging/**",
    "**/dist-stage/**",
    "**/coverage/**",
    "**/.turbo/**",
    "**/node_modules/**",
    "**/env-local/**",
    // 生成物（三方一致测试与 openapi 生成链都在写它们）
    "apps/server/openapi.json",
    "packages/generated/**",
    "apps/admin/types/generated/**",
    // 与 ESLint 侧 ignores 对齐：这些目录在 nest 预设里被豁免，oxlint 也要豁免，
    // 否则同一批文件出现「oxlint 报、eslint 不报」的假红
    "apps/server/public/js/**",
    "apps/server/scripts/**/*.ts",
    "**/*.d.ts"
  ]
}
```

`no-console: off` 这条不是可有可无：本仓三个预设都显式关了它（服务端大量结构性日志），兜底规则会把它打开。

### 7.3 ESLint 侧去重（两段式接入）

用 `buildFromOxlintConfigFile` **拆两段**：`ignores` 段进 antfu 的全局 ignores（它是 flat config 里「最前」的那一段），`rules` 段放在 prettier 兜底**之前**的最后一层（顺序：各包自己的配置 → `oxlint.rules` → `eslintConfigPrettier`）：

```ts
import eslintConfigPrettier from 'eslint-config-prettier/flat'
import { buildFromOxlintConfigFile } from 'eslint-plugin-oxlint'

const oxlint = buildFromOxlintConfigFile('.oxlintrc.json')

export default function vueConfig(options: OptionsConfig = {}): WalnutEslintConfig {
  return antfu(
    {
      // antfu 的 ignores 选项就是 flat config 的全局 ignore 段 —— 两个 linter 共享同一份真源
      ignores: [...oxlint.ignores],
      // …既有选项不动
      ...options,
      stylistic: false,
    },
    turboEnvVarsConfig(),
    commentPolicyConfig(),
    oxlint.rules,
    eslintConfigPrettier,
  )
}
```

**Kibana 的铁律**：双轨期**只关规则、不摘插件注册**。ESLint 侧被 oxlint 覆盖的规则由 `oxlint.rules` 关掉，但插件本身留在配置里 —— 历史 `eslint-disable` 指令一旦找不到规则就会报 unknown rule，那时会冒出一批与本次迁移无关的红。

### 7.4 三条硬边界

1. **Vue 模板留在 ESLint**。oxlint 官方兼容矩阵明示只 lint `.vue` 的 script 块；模板规则（`vue/*` 的模板侧、unocss 顺序）继续由 vue 预设负责。要在配置里写清这一点（一个只有注释的配置块即可），避免后续有人以为模板已经有人管。
2. **五条本地规则全部留在 ESLint**（`walnut-comment/no-emoji`、`walnut-script/script-header`、`walnut-script/script-exit-code`、`local/sort-nestjs-decorators`、`local/no-cross-lib-relative-import`）。默认答案是「保留」，逐条书面结论写进回报（移植成 jsPlugin 仍是 alpha，不在本轮）。
3. **server 的 `typescript/consistent-type-imports` 必须关 fix 或直接 off**。它的 autofix 会删掉 NestJS DI 需要的 import（Twenty 记录 3,814 处后禁用）。本仓 `tooling/eslint-config/nest.ts` 里当前是 `['error', { prefer: 'type-imports', disallowTypeAnnotations: false, fixStyle: 'separate-type-imports' }]` —— **不要**改成 off 之前先确认类型感知 lint 的收益；最小改法是保留规则但确保它不在 lint-staged 的 autofix 路径上造成 DI 断裂。最稳的做法是本批把它降成 off 并在回报里注明「等 ADR 0007 的装饰器元数据纪律与 lint 边界合并后再说」。

### 7.5 CI 与命令

```bash
# 本地先跑一次，确认报告量可解释
pnpm exec oxlint --quiet
```

命令表加两条（门禁组）：

```ts
// COMMANDS 数组里新增的两项
const oxlintCommands = [
  {
    id: 'lint:oxlint',
    group: '门禁',
    label: 'oxlint 快速检查（categories.correctness 兜底）',
    why: '通用正确性规则的第一道快速通道；Vue 模板、本地规则、类型感知分层仍归 ESLint',
    argv: ['exec', 'oxlint', '--quiet'],
  },
  {
    id: 'lint:oxlint:fix',
    group: '门禁',
    label: 'oxlint 自动修复',
    why: '能机械修的一次修完；修完仍要跑 lint:oxlint —— fix 的退出码不能当门禁判据',
    argv: ['exec', 'oxlint', '--fix'],
  },
]
```

CI 加一步（`--format=github` 出 PR 注解；本地调试用默认格式）：

```yaml
- name: Oxlint (correctness)
  run: pnpm walnut lint:oxlint --format=github
```

**本批不加进 prepush**（阶段计划明确：oxlint 先以独立命令存在，连续若干次零误报后再谈进表）。因此 `gate-wiring.test.ts` 的「没有只有本地守的门禁」这一条对它不适用 —— 它不在 prepush 表里。

`--fix` 的退出码不可信（有「修完仍有错却退出 0」的实录）。要判红只用 `--quiet`（不带 `--fix`），或补 `git diff --exit-code`。

### 7.6 turbo 缓存 key（两种接线，选 R）

- **方案 R（本批采用）**：oxlint 在仓库根跑一次（命令表那两条），不经 turbo ⇒ 没有「缓存回放旧规则」的问题，改 `.oxlintrc.json` 立刻生效。
- **方案 T（备查，若将来把 oxlint 并进各包的 `lint` 脚本）**：必须把 `.oxlintrc.json` 登记进根 `turbo.json` 的 `globalDependencies`。注意两条硬约束：
  1. `check-turbo-cache` 的 `global-dependency-exists` 要求登记的 glob 命中真实文件 —— **先建文件、后登记**；
  2. `globalDependencies` 会进**全局哈希**，改它等于让整轮缓存失效一次（这是预期成本，不是 bug）。

### 7.7 类型感知（只在 `baseUrl` 清完之后做，且只观测）

批次 3 已经把硬阻塞清掉，所以本批可以做一次**观测**（不进任何门禁）：

```bash
# 先确认 baseUrl 已清干净（应为空）
grep -rn '"baseUrl"' --include="tsconfig*.json" . --exclude-dir=node_modules --exclude-dir=.git

# 观测：type-aware 后端可用时打开，只记录报告量与耗时
pnpm exec oxlint --type-aware --quiet apps packages tooling
```

不接门禁的理由：oxlint 的 type-aware 需要**先构建依赖包的 d.ts**（monorepo 语义），而本仓的共享包 `types` 指源码、`dist` 的 d.ts 目前是占位 —— 这条前提在本仓不成立，观测结论要如实写进回报。

### 7.8 验收

```bash
pnpm walnut lint          # ESLint 侧（去重后）全绿
pnpm walnut lint:oxlint   # oxlint 侧全绿
pnpm walnut types:check
pnpm walnut test

# 抽查「没有规则同时在两边报」：对同一个文件打印两份配置，看同名规则
pnpm exec eslint --print-config apps/admin/src/main.ts > .zcode/rust-migration/eslint-config.json
pnpm exec oxlint --rules > .zcode/rust-migration/oxlint-rules.txt
```

阶段计划的 6 条验收逐条对应：报告量可解释（§7.2 收敛后逐类归属）、去重生效且插件未摘（§7.3）、本地规则逐条结论（§7.4）、判红方式可信（§7.5）、prepush 不变（§7.5）、生成物全进 ignore 且缓存口径清楚（§7.6）。

### 7.9 回滚

删除 `.oxlintrc.json`、三处 `oxlint.rules` / `ignores` 段、命令表两条、CI 一步，再从 catalog 删三条并在各 `package.json` 删依赖。ESLint 侧只关过规则、没删定义，所以回滚不需要恢复规则内容。

### 7.10 本批回报模板

按 §2.6 的骨架，本批这四行必须写实：

- **改了哪些文件**：`.oxlintrc.json`、三个 ESLint 预设、catalog、根 `package.json`、命令表、CI。
- **跑了哪些验收命令及结果**：§7.8 的每条逐条给退出码。
- **剩余项/不确定点**：类型感知观测的结论、`consistent-type-imports` 的最终处置。
- **给主对话的问题**：oxlint 何时具备进 prepush 的条件（本批刻意不进）。

本批特有的必报项：

- 收敛后的规则清单（`categories` 之外还剩哪几条，各自为什么）。
- 五条本地规则的逐条去留结论。
- `consistent-type-imports` 的处置（off / 留 fix / 留但不 fix）与理由。
- oxlint 与 ESLint 的报告重叠抽样结论（至少 5 个文件）。
- 类型感知观测的报告量与耗时（仅记录）。

## 8. 批次 6 · P4：tsdown 接管共享包

**目标一句话**：把「Vite lib 模式 + vite-plugin-dts + 手写 barrel」换成专门的 lib 打包器，同时守住 exports 四条件、`types` 指源码、barrel 语义三条不变量。

**前置**：批次 2（Vite 键名与版本已稳定）。

### 8.1 依赖：catalog 加 `tsdown`

```bash
npm view tsdown version         # 目标 0.23.7；0.x，锁精确版本
npm view tsdown time --json     # 必须发布满 24h（minimumReleaseAge）
```

catalog 加一条（字母序在 `ts-json-schema-generator` 之后、`turbo` 之前）：

```jsonc
{
  "tsdown": "0.23.7"
}
```

**不接受自动升小版本**：0.23.0 是 breaking 版本，升级要单独成批并跑完 §8.3 / §8.5 的全套验收。装进各自的 devDependencies 时用 `"tsdown": "catalog:"`。

### 8.2 第一步：`utils-core`（管线与验收流程先跑通）

`packages/platform-any/utils-core` 的现状：三个 entry（`index` / `object-paths` / `sign-raw`，以 `vite.config.ts` 的表为准）、只产 CJS、`entryFileNames: '[name].cjs'`、用 `vite-plugin-dts`。

新增 `packages/platform-any/utils-core/` 下的 `tsdown.config.ts`（文件名可写，路径不加反引号 —— 仓库的文档门禁只查已存在的完整路径）：

```ts
import { resolve } from 'node:path'
import { defineConfig } from 'tsdown'

const entries = {
  'index': resolve(import.meta.dirname, 'src/index.ts'),
  'object-paths': resolve(import.meta.dirname, 'src/object-paths.ts'),
  'sign-raw': resolve(import.meta.dirname, 'src/sign-raw.ts'),
}

export default defineConfig({
  entry: entries,
  // 只产 CJS，与现状一致；后端 require 是既成事实
  format: ['cjs'],
  sourcemap: true,
  clean: true,
  // CJS 产物**不要开 minify**：压缩后的 re-export 对 cjs-module-lexer 不可见，
  // ESM 侧具名导入会静默丢失（WebChat 的 tsdown 配置里专门写了这条）
  minify: false,
  // types 指源码、dist 的 d.ts 无消费者（实测是 10 字节占位）⇒ 关掉，同时绕开 rolldown-plugin-dts 的坑
  dts: false,
  // exports 四条件的形状生成器表达不了 ⇒ 手写不动，关掉生成
  exports: false,
  deps: { neverBundle: ['easy-fns-ts'] },
  outputOptions: {
    exports: 'named',
    // rolldown 默认 'if-default-prop'，纯具名导出入口不会带 __esModule，必须显式
    esModule: true,
    strict: true,
  },
  publint: false,
  attw: false,
})
```

要点与「按需调整」的边界：

- `platform` 不写。阶段计划的骨架里有 `platform: 'neutral'`，但 CJS 下它会被忽略并告警（上游 tsdown#1111），省掉能降噪。省了要在回报里说明「与粗粒度计划有出入」。
- **产物扩展名必须仍是 `.cjs`**。tsdown 会按 `format` + 包的 `"type": "module"` 推断扩展名；第一次构建后 `ls dist` 核对，若推断成 `.js`，用它的扩展名配置（当版文档里的 `outExtensions` 一类）钉成 `.cjs`。**不要改 `package.json` 的 `exports` 去迁就产物名** —— 那是反过来把真源交给打包器。
- `scripts.build` 改成 `tsdown`；devDependencies 删 `vite` 与 `vite-plugin-dts`（本包换完之后没有第二个消费者），加 `tsdown`。
- `dist` 里的 d.ts 现状是占位、无人消费；`dts: false` 之后这些占位文件不再产生。**这是预期变化**，要在回报里写明「`dist/*.d.ts` 消失，与 `exports.types` 指源码一致」，不要偷偷改成开启 dts。

### 8.3 `utils-core` 验收

```bash
# 构建（先清一次，避免读到 Vite 的旧产物）
pnpm --filter @walnut/utils run clean
pnpm --filter @walnut/utils run build
ls packages/platform-any/utils-core/dist

# 每个产物都能被 Node 解析（语法层）
for f in packages/platform-any/utils-core/dist/*.cjs; do node --check "$f" || exit 1; done

# 从后端（真实的 CJS 消费面）逐子路径 require 冒烟
# 前置：两个包都已构建（turbo run build --filter=@walnut/utils）
cd apps/server
for f in ../packages/platform-any/utils-core/dist/*.cjs; do
  m=$(basename "$f" .cjs)
  spec=$([ "$m" = index ] && echo @walnut/utils || echo "@walnut/utils/$m")
  node -e "const m=require(process.argv[1]); if(!m||Object.keys(m).length===0) throw new Error('empty: '+process.argv[1])" "$spec" || exit 1
  echo "ok $spec"
done
```

再加四条不变量检查：

```bash
pnpm walnut lint:exports        # exports 四不变量（目标存在 / types 在前 / 与 main 一致）
pnpm walnut lint:turbo-cache    # build 的 outputs 能覆盖 dist
pnpm --filter @walnut/utils run test
pnpm walnut types:check
```

`publint` / `attw` **不作为门禁**：`exports` 指 `.ts` 时它们必然假阳性。临时跑过就把假阳性类型记进回报（阶段计划第 7 条）。

### 8.4 第二步：`contract`（主要成本在这里）

`contract` 比 `utils-core` 多三件事：entry 表更长（以 `vite.config.ts` 的表为准）、手写 barrel 覆盖 `dist/index.cjs`、`entries.drift.test.ts` 用正则解析配置文件文本。

1. **平移 entries**：迁移前 `vite.config.ts` 的 entries 表原样搬进新增的 `tsdown.config.ts`（键名 = 文件名，一条不多一条不少）。
2. **`scripts.build` 改成 `tsdown && node scripts/build-barrel.ts`**：barrel 脚本保留（tsdown 的产物名同样是 `dist/*.cjs`，脚本零改动可用）。
3. **`package.json` 的 `exports` 一条都不动**（`source` / `types` / `import` 指源码，`require` / `default` 指 CJS）。
4. **改一致性测试的解析目标**：`packages/platform-any/contract/__tests__/entries.drift.test.ts` 里 `viteEntries()` 读的是 `read('vite.config.ts')`。改成读新配置文件后，正则 `['"]?([\w-]+)['"]?:\s*resolve\(\s*__dirname\s*,\s*['"]src\/([^'"]+)\.ts['"]\s*\)` 仍然匹配 —— **前提是新配置沿用 `resolve(__dirname, 'src/x.ts')` 的写法**。如果改成 `resolve(import.meta.dirname, …)`，正则里的 `__dirname` 要同步放宽；两种都行，但必须在回报里贴「改完后故意删一个 entry，测试确实红」的证据（否则它可能静默变成空断言）。
5. **补一条 default 导出断言**（CJS 里 `export { default as foo }` 不 unwrap，消费者拿到 `{ default: foo }`）：新增 `dist-exports.test.ts`（同目录），断言每个 `dist/*.cjs` 的键集非空、且**不含 `default`**（本仓公共模块禁止 default 导出，这条同时守住「不 unwrap」的形态）：

```ts
import { readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const require_ = createRequire(import.meta.url)
const distDir = join(import.meta.dirname, '..', 'dist')

describe('CJS 产物形状', () => {
  it('每个 dist/*.cjs 都有具名导出，且不含 default（禁止 default 导出的契约）', () => {
    const files = readdirSync(distDir).filter(f => f.endsWith('.cjs'))
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) {
      const mod = require_(join(distDir, file)) as Record<string, unknown>
      expect(Object.keys(mod).length, `${file} 没有任何导出`).toBeGreaterThan(0)
      expect(Object.hasOwn(mod, 'default'), `${file} 出现了 default 导出（tsdown 的 export { default as x } 不会 unwrap）`).toBe(false)
    }
  })
})
```

前置：这个测试读 `dist`，所以要么在 `test` 之前先 `build`（turbo 的 `test` 有 `dependsOn: ["^build"]`，但**它只构建依赖包、不构建自己**），要么在测试里显式跳过「dist 不存在」。推荐：测试开头 `expect(existsSync(distDir), '先跑 pnpm --filter @walnut/contract build').toBe(true)` —— 让「没构建」红成前置条件，而不是静默跳过。

### 8.5 `contract` 验收

```bash
pnpm --filter @walnut/contract run clean
pnpm --filter @walnut/contract run build
ls packages/platform-any/contract/dist

for f in packages/platform-any/contract/dist/*.cjs; do node --check "$f" || exit 1; done

pnpm --filter @walnut/contract run test          # 含 entries.drift 与 dist-exports
pnpm walnut lint:exports
pnpm walnut types:check

# 后端 require 消费面：逐子路径（子路径清单从 dist 推导，不手抄）
cd apps/server
for f in ../packages/platform-any/contract/dist/*.cjs; do
  m=$(basename "$f" .cjs)
  spec=$([ "$m" = index ] && echo @walnut/contract || echo "@walnut/contract/$m")
  node -e "const m=require(process.argv[1]); if(!m||Object.keys(m).length===0) throw new Error('empty: '+process.argv[1])" "$spec" || exit 1
  echo "ok $spec"
done
```

再加两条与后端启动有关的：

```bash
# 后端构建与产物存在性（Dockerfile 的 CMD 依赖这个路径；注意 server 的 dist 在包目录下）
pnpm --filter @walnut/server run build
ls apps/server/dist/apps/api/src/main.js

# 前端仍走源码：admin 的类型与构建不应有任何变化
pnpm --filter @walnut/admin types:check
pnpm exec turbo run build --filter=@walnut/admin --force

# 全量构建（收尾时跑一次）：确认 turbo 的 build 图里两个包都用 tsdown 产出了 dist
pnpm exec turbo run build
```

`turbo run build` 之后逐个核对产物存在性（turbo 缓存命中时它不会重建，所以正式判定要配 `--force`）：

```bash
ls packages/platform-any/utils-core/dist/*.cjs packages/platform-any/contract/dist/*.cjs
```

阶段计划的 7 条验收逐条对应：dist 清单与基线对得上（§8.3 / §8.5 的 `ls`）、后端 require 逐子路径 + `node --check`、`entries.drift` 改造后仍有效（§8.4 第 4 条）、default 导出断言存在、前端仍走源码、版本精确锁、`publint` / `attw` 不作门禁。

### 8.6 回滚

按包分两次提交（由主对话切分），回退粒度就是包：

- 回退 `utils-core`：删 tsdown 配置、`scripts.build` 改回 `vite build`、devDeps 恢复 `vite` 与 `vite-plugin-dts`、删 `tsdown`。
- 回退 `contract`：同样操作 + `entries.drift.test.ts` 的读取目标改回 `vite.config.ts` + 删 `dist-exports.test.ts`。

回退后必须 `pnpm exec turbo run build --filter=<包> --force` 并重跑 require 冒烟：turbo 缓存命中时它不会重新产出 `dist`，而 `dist` 是 gitignored 的 —— 那会得到「回滚成功但产物还是新的」这种最坏的中间态。

### 8.7 本批回报模板

按 §2.6 的骨架，本批这四行必须写实：

- **改了哪些文件**：`utils-core` 与 `contract` 的构建配置、两个 `package.json`、`entries.drift.test.ts`、新增的产物形状测试、catalog。
- **跑了哪些验收命令及结果**：§8.3 / §8.5 的命令逐条给退出码，require 冒烟报覆盖的子路径数。
- **剩余项/不确定点**：产物扩展名、`platform` 省略、`publint` / `attw` 的假阳性。
- **给主对话的问题**：`dist/*.d.ts` 消失要不要在文档里登记。

本批特有的必报项：

- 两个包的 dist 清单（文件数 + 与基线的差异逐条解释）。
- 产物扩展名、`__esModule` 标记、`default` 键的存在性。
- `entries.drift.test.ts` 的改造点，以及「删一个 entry 会红」的实证。
- 后端 require 冒烟覆盖了多少子路径（从 dist 推导，不手抄数字）。
- `publint` / `attw` 若跑过，假阳性类型是什么。

## 9. 批次 7 · P5a/P5b：tsrs 影子与转正（配置面）

**目标一句话**：先让 tsrs 以**只读影子**的形式与 tsc 并行（判据是时长 + 诊断 diff），影子期满后把 server 与 packages 的 `types:check` **整批**换成 tsrs。

**前置**：批次 3（`baseUrl` 已清）。

**本批是两段，中间有人工等待**：7A 是配置面（agent 做），7B 是转正（影子期满后，agent 做；「期满」由主对话判定）。

### 9.1 7A：影子接线

1. **catalog 加 `tsrs`**（精确锁，无范围）：

```jsonc
{
  "tsrs": "7.1.0-beta.tsrs5"
}
```

装前核对：`npm view tsrs time --json`（必须发布满 24h）；`npm view tsrs dist-tags`（registry 没有 `next`，别写 `latest`）。

2. **逐包声明 devDependency**：`hoist: false` 下不能靠根依赖「借」，每个要跑 tsrs 的包都要自己写 `"tsrs": "catalog:"`。目标包 = `types:check` 里写着 `tsc` 的包，**除** `@walnut/types` 与 `@walnut/commitlint-config`（文件少 / 被 Windows 启动地板拖平，无收益）。`@walnut/admin`（vue-tsc）与 `@walnut/docs`（echo skipped）不在其中。

```bash
# 机械列一遍目标包（执行时以这条输出为准，不要手抄）
pnpm -r exec node -e "const p=require('./package.json');const s=(p.scripts||{})['types:check']||'';if(s.includes('tsc'))console.log(p.name)"
```

3. **每包加影子脚本**（`types:check:tsrs`）：

```jsonc
{
  "scripts": {
    "types:check": "tsc --noEmit",
    "types:check:tsrs": "tsrs --noEmit --pretty",
    "typecheck:watch": "tsc --noEmit --watch"
  }
}
```

`typecheck:watch` **永久留 tsc**（Windows 上 tsrs 的 watch 是 NotImplemented、退出码 5，且缺 fswatch 后端与 LSP watchdog、无 ETA）。不要为了让脚本整齐而把它换成 tsrs。

4. **根 `turbo.json` 加任务**（`types:check:tsrs`）：

```jsonc
{
  "tasks": {
    "types:check:tsrs": {
      "dependsOn": ["transit"],
      "inputs": ["$TURBO_DEFAULT$", "!**/*.md"],
      "outputs": [],
      "cache": true
    }
  }
}
```

`dependsOn: ["transit"]` 与 `types:check` 同口径：共享包源码是类型真源，断了它就会回放假绿。

5. **命令表加一条**（门禁组，影子期 report-only 不进 prepush）：

```ts
// 加进 COMMANDS 的一项
const tsrsCommand = {
  id: 'types:check:tsrs',
  group: '门禁',
  label: 'tsrs 类型检查（影子期只观测，不阻断）',
  why: '检查侧快查的候选实现；影子期只看时长与诊断 diff，期满后再决定是否转正',
  argv: ['exec', 'turbo', 'run', 'types:check:tsrs'],
  budgetMs: 0,
}
```

6. **CI 加一个 report-only 步骤**（失败不阻断）：

```yaml
- name: Type check with tsrs (report only)
  continue-on-error: true
  run: pnpm walnut types:check:tsrs
```

`continue-on-error: true` 是这一步的全部含义 —— 它**不进**任何阻断表，回滚成本就是删掉这几行。

### 9.2 7A 的验收与影子判决

```bash
# 影子跑一遍（各目标包经 turbo 扇出）
pnpm walnut types:check:tsrs

# 与 tsc 的诊断做差集：两边都归一化后排序再 diff
pnpm walnut types:check > .zcode/rust-migration/tcs-diag.txt
pnpm walnut types:check:tsrs > .zcode/rust-migration/tsrs-diag.txt
# 归一化：去绝对路径前缀、去颜色、按 file:line:col code 排序后 diff
```

影子期判据（团队已拍板，**不要自行加严**）：

- 诊断差集为零，或每条差异都有归属（真 bug / TS7.1 版本收紧 / 误报），真 bug 单独修掉。
- `#1114` 那类约 1% 的随机失败**只记录、不设门禁**。出现可复现的失败模式时，触发的是「复评决策」，不是自动阻塞。
- 不允许出现「同一段代码 TS6 绿、tsrs 红」却没人解释的情况。

影子期的时长与 PR 数由主对话判定（阶段计划写的是 1–2 周 / ≥10 PR）。agent 只负责把数据攒齐：每轮的耗时、诊断差集、随机失败次数。

### 9.3 7B：转正（整批，不混搭）

转正的动作是**换命令**，不是换配置：

1. 每个目标包的 `types:check` 改成 `tsrs --noEmit --pretty`；删掉 `types:check:tsrs` 脚本（它已经等于 `types:check`）。
2. `apps/server/tsconfig.json` 的 `tsBuildInfoFile` 分文件：`./node_modules/.cache/tsconfig.tsbuildinfo` → `./node_modules/.cache/tsrs/tsconfig.tsbuildinfo`。理由：tsrs 写 Go 格式的 `version: "7.1.0-beta"`，与 TS6 共路径会乒乓失效（实测互相覆盖不毒化，但反复全量）。
3. 删根 `turbo.json` 的 `types:check:tsrs` 任务、命令表那条、CI 的 report-only 步骤。
4. `tooling/scripts/src/ci/check-pre-hooks.ts` 的消费者数据要不要动？本批**不需要**（tsrs 不读生成物），但要在回报里确认：`@walnut/admin` 仍是唯一需要 pre 钩子的链（`vue-tsc`），server 换 tsrs 后 `types:check` 首词从 `tsc` 变成 `tsrs` —— 若将来某个包同时有生成物又要跑 tsrs，加数据即可。

`pnpm-workspace.yaml` 的 `typescript` 条目**本批不动**（P5b 只换检查命令；引擎替换是批次 8）。

### 9.4 7B 验收

```bash
pnpm walnut types:check          # 现在由 tsrs 跑
pnpm walnut types:check:root     # 根级配置仍是 tsc（Windows 启动地板，无收益）
pnpm walnut lint                 # ESLint 的类型感知不受影响
pnpm walnut test

# 回滚是一行：把某个包的 types:check 改回 tsc 即可复原
```

阶段计划的 4 条验收逐条对应：全仓 `types:check` 由 tsrs 跑且全绿 + CI 冷跑耗时记录（`time` 一次冷跑的整表）、回滚一行、`nest build` 不受影响（emit 链没动，产物与 P0 基线一致）、没有 `--fast` / 范围版本号 / watch 里的 tsrs。

### 9.5 回滚

7A 回滚：删 CI 步骤 + 命令表条目 + turbo 任务 + 各包脚本与 devDep + catalog 条目，`pnpm install`。7B 回滚：每个包的 `types:check` 改回 `tsc --noEmit`，server 的 `tsBuildInfoFile` 改回原路径（否则两份缓存格式不同会一直全量，但不致命）。

### 9.6 本批回报模板

按 §2.6 的骨架，本批这四行必须写实（7A 与 7B 各报一次）：

- **改了哪些文件**：catalog、各目标包的 `package.json`、根 `turbo.json`、命令表、CI、`apps/server/tsconfig.json`。
- **跑了哪些验收命令及结果**：§9.2 / §9.4 的命令逐条给退出码与耗时。
- **剩余项/不确定点**：随机失败（`#1114` 类）的次数与现象、诊断差集的归属。
- **给主对话的问题**：影子期是否满足「期满 + 诊断差集可解释」两个条件（这是 7B 的准入）。

本批特有的必报项：

- 影子期每轮的耗时与诊断差集（按包分开报）。
- 随机失败（`#1114` 类）出现的次数与现象（只记录）。
- `tsBuildInfoFile` 改路径后的冷/热耗时对比。
- 转正后 CI 冷跑整表耗时（这是 `types` 段改为 tsrs 后的真实读数）。

## 10. 批次 8 · P5c：引擎全面 TS7（TNB + nest PoC）—— 混合模式

> **本批是混合模式**：agent 做**PoC 与数据**（步骤 1–3），**转正 / 回退的决策留人工**（步骤 4）。agent 不许自行决定「通过」并直接改 catalog 转正。

**目标一句话**：把 `typescript` 包面换成 TNB（classic 6.0.3 API 外壳 + 进程内 tsgo 7.0.2 引擎），并回答唯一未知：**nest CLI 能不能跑在它上面**。

**前置**：批次 1（admin 基线）、批次 3（`baseUrl` 已清）。若批次 7 已转正，则 server 的 `types:check` 已是 tsrs —— 这与本批**不冲突**（一个换引擎、一个换检查器），但要在回报里写清当前状态。

### 10.1 前置核对（三条，任一不成立就停）

```bash
# 1) TNB 的版本与分发（精确锁；发布满 24h）
npm view typescript-native-bridge versions --json
npm view typescript-native-bridge time --json

# 2) 当前 nest CLI 与它的守卫（判据是 API 形状，不是版本号）
cd apps/server
pnpm exec nest --version
node -e "const ts=require('typescript'); console.log(ts.version, typeof ts.getParsedCommandLineOfConfigFile)"
# 预期：6.0.3 function   ← 换成 TNB 之后这里必须仍是 function，否则 nest build 必挂

# 3) 解析链：当前谁在消费哪个 typescript（在 server 目录里问，答案才是 nest CLI 看到的那个）
pnpm why typescript
cd -
```

`trustPolicy: no-downgrade` 可能拦住「把包面换成一个 2026-10 发布的 bridge 包」。撞上时的处置**只有一个**：把该包加入 `trustPolicyExclude` 并写明理由（当前清单里已有同类历史版本豁免的先例），**不要**关掉整个策略。

### 10.2 接入（agent 做；改完不等于转正）

为了跑 PoC，必须先在工作区改 catalog 与 `overrides` 这两处。**改完不等于转正** —— 保留还是回退由 §10.5 的人工决策定。

接入形态是「catalog + overrides 双改」：

```jsonc
{
  // pnpm-workspace.yaml
  "catalog": {
    // 包名仍是 typescript：让全部消费者（nest CLI / vue-tsc / typescript-eslint / 三支文档检查）
    // 继续 require('typescript')，拿到的却是 classic 6.0.3 外壳 + tsgo 7.0.2 引擎
    "typescript": "npm:typescript-native-bridge@6.0.3-bridge.19.tsgo.7.0.2"
  },
  "overrides": {
    "typescript": "npm:typescript-native-bridge@6.0.3-bridge.19.tsgo.7.0.2"
  }
}
```

同时把 `vue-tsc` 从 3.2.8 升到 3.3.14（评估允许）。`overrides` 在 `pnpm-workspace.yaml` 里的位置按既有排序规则放（改完跑一次 `pnpm lint` 让 `yaml/sort-keys` 告诉你该在哪，不要手工猜）。

**两条退路，装不上时按顺序试**（两种都在回报里写明选了哪种）：

1. 若 catalog 不接受 `npm:` 别名（值类型校验拒绝），退回「catalog 保持 `6.0.3` + 只用 `overrides` 强制解析」，并在 catalog 条目旁留注释说明真源在 `overrides`。
2. 若 `overrides` 也被 `trustPolicy: no-downgrade` 拒绝，把该版本加入 `trustPolicyExclude` 并写理由（清单里已有同类历史版本豁免的先例），**不要**关掉整个策略。

```bash
pnpm install
git diff --stat pnpm-lock.yaml
node -p "require('typescript/package.json').version"          # 期望 6.0.3-bridge.19.tsgo.7.0.2
node -p "typeof require('typescript').getParsedCommandLineOfConfigFile"   # 期望 function
cd apps/admin && node -p "require('typescript/package.json').version"; cd -
cd apps/server && node -p "require('typescript/package.json').version"; cd -
```

`strictPeerDependencies: false` 让 vue-tsc 的 peer `<7` 不会在 install 阶段挡路（本仓刻意这样配的），但**不要**因此认为「peer 没问题 = 运行时没问题」—— vue-tsc 的真实可用性由 §10.3 的基线对比回答。

### 10.3 admin 基线对比与诊断归因（agent 做）

```bash
# 与 P0 完全同一条命令、同一种温度
rm -f apps/admin/node_modules/.cache/tsconfig.tsbuildinfo
time pnpm --filter @walnut/admin types:check 2>&1 | tee .zcode/rust-migration/p5c-admin-tsc-tnb.log
time pnpm --filter @walnut/admin types:check 2>&1 | tee .zcode/rust-migration/p5c-admin-tsc-tnb-warm.log
```

对比 P0 的基线（四种读数逐项比）：退出码、冷跑耗时、热跑耗时、诊断条数。

诊断逐条 diff 的**归因规则**（评估第 11 节留的唯一未决项，这里给出可执行口径）：

1. 两边都归一化（去绝对路径、去颜色、统一 LF、按 `file:line:col code` 排序）后 diff。
2. 每条差异做一次**交叉实验**：用「TS6 的 checker + TS7 的 lib」跑同一条诊断（5.6 抓到 `crossOrigin` 真 bug 用的就是这个方法）。
   - 在 TS6 下也报 → **不是 TNB 的问题**，按真问题修（或按既有规则豁免）。
   - 只在 TS7 lib 下报 → **版本收紧，可归因**，修。
   - 只在 TNB 下报、TS7 裸引擎不报 → **外壳/引擎缺陷**，阻塞，写进回报。
3. `types:check` 只要非零退出，**结论就是「未通过」**，不管差异多小。

### 10.4 nest-on-TNB PoC（agent 做，五步）

```bash
# 步骤 0：装饰器元数据的前提 —— 守卫判的那个函数在不在（应在 §10.1 已确认）
cd apps/server
node -e "const ts=require('typescript'); if(typeof ts.getParsedCommandLineOfConfigFile!=='function'){console.error('guard 会挂');process.exit(1)}; console.log('guard ok', ts.version)"
```

1. **`nest build`（SWC builder）**：

```bash
# 必须在 apps/server 目录里跑：构建脚本里的产物校验按 cwd 解析 dist
cd apps/server
pnpm run build
ls dist/apps/api/src/main.js                        # Dockerfile 的 CMD 依赖这个路径
node infra/scripts/verify-build-assets.ts dist      # 与 build 脚本里的同一支检查
cd -
```

判据：exit 0、产物路径存在、`verify-build-assets` 绿、`dist` 文件清单与 P0 基线一致。

2. **`nest start --watch` 短跑**（不许长跑）：

```bash
cd apps/server
timeout 90 pnpm exec nest start api --watch -c infra/nest/dev.json 2>&1 | tee ../../.zcode/rust-migration/p5c-nest-watch.log
# 判据：日志里出现「Nest application successfully started」且进程是被 timeout 收掉的（不是自己崩的）
grep -c "successfully started" ../../.zcode/rust-migration/p5c-nest-watch.log
```

前置：`pnpm setup-env` 已解密、PostgreSQL 与 Redis 在线（后端必须在 `apps/server` 目录下跑，ConfigModule 用 `process.cwd()` 定位 env）。

3. **`createProgram` 路径（classic API 面）**：

```bash
cd apps/server
node -e "const ts=require('typescript'); const p=ts.createProgram(['apps/api/src/main.ts'],{}); console.log('files', p.getSourceFiles().length)"
```

判据：不抛异常，文件数 > 0。这一条证明「外壳仍是 classic API」，而不是「tsgo 恰好能被 tsc 驱动」。

4. **装饰器元数据冒烟（ADR 0007 的第一道验证）**：生产构建走 SWC、不走 tsc emit，所以这项验的是「如果哪天换成 tsc emit，元数据会不会静默丢」。做法：挑一个构造函数注入 DTO 的文件，用 tsc（此时是 TNB 外壳 + tsgo 引擎）单独 emit 到临时目录，与 SWC 产物比对 `__metadata("design:paramtypes", [...])` 里的类型引用：

```bash
cd apps/server
node -e "const ts=require('typescript');const cfg=ts.getParsedCommandLineOfConfigFile('tsconfig.json',{outDir:'.tmp/poc-tnb-emit',noEmit:false,declaration:false,sourceMap:false,tsBuildInfoFile:'.tmp/poc-tnb-emit.tsbuildinfo'},{});const p=ts.createProgram(cfg.fileNames,cfg.options);p.emit()"
grep -rn "design:paramtypes" .tmp/poc-tnb-emit | head
```

判据：同一文件在 SWC 产物里的 `design:paramtypes` 与上面 tsc emit 的类型引用**逐项一致**。不一致就是**阻塞**（错的症状是接口 200 但字段消失）。`.tmp` 已被 gitignore，验完删掉。

5. **真实请求 + 元数据端到端**（ValidationPipe / 全局过滤器 / 路由表 / DTO 反射）：起后端（`pnpm --filter @walnut/server run start:prod` 或 `dev`），然后：

```bash
# 前缀与版本来自 env（APP_API_PREFIX / APP_API_VERSION，URI versioning 的 prefix = "前缀/v"），
# 不要照抄某一套部署的字面量；端口取 APP_PORT。
PREFIX="$(grep -m1 '^APP_API_PREFIX=' apps/server/env-local/.env.development | cut -d= -f2-)"
VERSION="$(grep -m1 '^APP_API_VERSION=' apps/server/env-local/.env.development | cut -d= -f2-)"
PORT="$(grep -m1 '^APP_PORT=' apps/server/env-local/.env.development | cut -d= -f2-)"
BASE="http://127.0.0.1:${PORT}/${PREFIX}/v${VERSION}"

# a) 需要鉴权的健康端点：不带凭据应得到统一的错误信封（401/403 + 业务 code），而不是 500 或空响应
curl -s -o .zcode/rust-migration/p5c-health.json -w "%{http_code}\n" "$BASE/app/health/postgres"

# b) 带 DTO 的 POST 空 body：路由必须存在、必须回**结构化的**错误信封，而不是 500 / 空响应。
#    注意 Nest 的 guard 先于 pipe 执行，所以这里既可能是校验错误、也可能是 guard 的业务错误 ——
#    判据是「信封结构」，不是具体 code。
curl -s -o .zcode/rust-migration/p5c-validation.json -w "%{http_code}\n" \
  -X POST "$BASE/auth/opaque/user/login/start" -H "content-type: application/json" -d "{}"
```

判据：两次请求都拿到**结构化的错误信封**（含 `code` 字段），不是 500 / 也不是空响应；日志里没有「Cannot read properties of undefined」这类启动期残留。

**DTO 元数据的端到端证据用现成门禁拿**（比上面两条更硬）：`openapi:export` 会以**完整 AppModule** 引导，靠装饰器反射生成 `openapi.json` —— 元数据一旦在 TNB 下丢了字段，导出物就会变、`git diff --exit-code` 立刻红：

```bash
cd apps/server && pnpm run openapi:check:export && cd -
```

这一步需要 env 与 PG/Redis（与 prepush 的 `openapi` 段同一前提）。跑不了就记为未验证，但**不要**因此给 PoC 下「通过」的结论。

它同时是一个额外的 nest 侧信号：`openapi:export` 内部会 `nest build cli`。**若它红了，不要手工还原 `openapi.json`**（那是 `git checkout` 一类操作，本批禁止）—— 停下回报，把 diff 摘要作为阻塞证据交给主对话。

### 10.5 决策（人工）

agent 在回报里给出**三态结论**，不写「通过」以外的自评：

| 结论 | 判定条件 | 人工动作 |
|------|----------|----------|
| PoC 通过 | §10.3 差异全部可归因且已修；§10.4 五步全绿 | 人工决定是否转正全局 catalog（以及是否保留 nest 侧） |
| 仅 nest 不通过 | §10.3 通过、§10.4 任一步失败且定位在 nest CLI 消费面 | 人工决定是否走「仅 nest 回退」 |
| 引擎/外壳有缺陷 | §10.3 出现不可归因差异 | 人工决定是否整批回退 |

**「仅 nest 回退」的机制**（不是改一行 catalog，因为 nest CLI 是从仓库根解析 `typescript` 的）：

1. catalog 的 `typescript` 恢复 `6.0.3`，删掉全局 `overrides.typescript`；
2. 改成**逐消费者**的 scoped override，把 TNB 只留给要继续跑 tsgo 的消费者（例如 admin 的 `vue-tsc` 链与工具链包），`@walnut/server` 不在此列：

```jsonc
{
  "overrides": {
    "@walnut/admin>typescript": "npm:typescript-native-bridge@6.0.3-bridge.19.tsgo.7.0.2"
  }
}
```

3. 验证两条解析链**不同**：

```bash
cd apps/admin  && node -p "require('typescript/package.json').version"   # TNB 版本
cd ../server   && node -p "require('typescript/package.json').version"   # 6.0.3
cd ../server   && pnpm exec nest build api -c infra/nest/prod.json       # 必须能跑
```

### 10.6 回滚

两档，写清各自的代价：

- **全局回退**：catalog 的 `typescript` 恢复 `6.0.3`、删 `overrides`、`vue-tsc` 视情况回 3.2.8，`pnpm install`（lockfile 会大幅变化）。
- **仅 nest 回退**：见 §10.5 的三步。代价是「两个 typescript 版本共存」，`pnpm why typescript` 会给出两条链 —— 这是**有意**的，不是漂移。

### 10.7 本批回报模板

按 §2.6 的骨架，本批这四行必须写实（**结论行必须落在三态之一，不许写「基本通过」**）：

- **改了哪些文件**：catalog（`typescript`、`vue-tsc`）、`overrides`；若走 PoC-only 形态则只改这两个。
- **跑了哪些验收命令及结果**：§10.3 的四项读数 + §10.4 五步的退出码与关键日志行。
- **剩余项/不确定点**：每条诊断差异的归因（交叉实验结论）、`trustPolicy` 是否被触发。
- **给主对话的问题**：三态结论 + 建议动作（转正 / 仅 nest 回退 / 整批回退），并显式写「未执行」。

本批特有的必报项：

- 三态结论（PoC 通过 / 仅 nest 不通过 / 引擎缺陷），附每一条判据的实测读数。
- admin 的四项读数与 P0 的对比（耗时 ×2、诊断条数、退出码）。
- 每条诊断差异的归因（用交叉实验的结论）。
- nest 五步中每一步的退出码与关键日志行（`successfully started` 的条数、`design:paramtypes` 的比对结论）。
- 显式写一句「转正 / 回退未执行，等人工决定」。

## 11. 风险与回退速查表

| 批次 | 最大风险 | 触发条件 | 回退动作（精确到文件/命令） |
|------|----------|----------|------------------------------|
| 1 | 基线不可复现（温度/环境不同），导致批次 8 的对比无效 | 冷热跑混用、或诊断未归一化 | 重跑 §3.1；把「同一温度」写进基线记录 |
| 1 | `check-pre-hooks` 名单被清空却全绿 | 数据文件写空、测试只断言「零 findings」 | 保留 §3.3 的第二条用例（真实名单至少两个消费者） |
| 2 | CSS 顺序差异无法解释 | `cssCodeSplit: false` + Lightning CSS 换压缩器 | 回退 `apps/admin/vite.config.ts` 的 `minify` 与 catalog 的 `vite` 版本，`pnpm install`，`--force` 重建 |
| 2 | `minify` 对象塞进 `build.minify` | 类型检查报 `UserConfig` 不匹配 | 按 §4.2 的方案 A/B 改；对象只留 `rolldownOptions.output.minify` |
| 3 | admin 的 paths 语义变了（`@/*` 解析到别处） | 忘记加 `./` 前缀 → TS5090，或加了但 Vite 侧没核 | 改回 `["./src/*"]` / `["./types/*"]`；两侧都跑（vue-tsc + `turbo run build --filter=@walnut/admin --force`） |
| 3 | `--listFiles` 覆盖范围漂移 | 删 `baseUrl` 时顺手改了 `include` | 用清理前的清单逐包 diff，差异不为零就还原 `include` |
| 4 | oxfmt 与 ESLint 互相改回去 | `stylistic: false` 没生效或 `eslintConfigPrettier` 没接 | 全仓 `pnpm lint` 看是否出现「刚格式化就被改」；补齐三处预设的 `stylistic: false` 与 prettier 兜底 |
| 4 | 门禁只跑不判（`--check` 永远绿） | CI 步骤写成 `--write` 或漏了退出码 | 造坏格式文件验证非零退出；`prepush.ts` 的 argv 必须是 `format:check` |
| 4 | 首轮格式化把逻辑改动混进大 diff | 与 paths / 依赖改动同一次 | 由主对话切分提交；agent 提供 `git diff -w --stat` 与 `git diff --stat` 的对比 |
| 5 | 双轨重复报告（同一问题两个 linter 都报） | 两段式接入顺序错（rules 段不在最后） | 按 §7.3 把 `oxlint.rules` 放在 `eslintConfigPrettier` 之前、其余配置之后；逐文件抽查 |
| 5 | `consistent-type-imports` 删掉 DI import | 对 server 开该规则的 autofix | 关 fix 或 off（§7.4 第 3 条）；`nest build` 与启动冒烟复核 |
| 5 | 生成物进报告造成假红 | ignore 漏了 `openapi.json` / `schema.d.ts` / `components.d.ts` | 按 §7.2 的 ignorePatterns 补齐后重跑 |
| 6 | 产物扩展名/`__esModule` 变了，后端 require 坏 | tsdown 推断出 `.js`，或没开 `esModule: true` | 钉扩展名 + `esModule: true`；逐子路径 require 冒烟 |
| 6 | `entries.drift.test.ts` 静默变成空断言 | 正则不再匹配新配置，`entries.length` 为 0 但断言被跳过 | 保留「存在性断言」（`length > 0`），并做「删一个 entry 会红」的实证 |
| 6 | 回退后 turbo 缓存命中、`dist` 还是新的 | 回退提交后没 `--force` 重建 | `pnpm exec turbo run build --filter=<包> --force` + require 冒烟 |
| 7 | tsrs 随机失败（`#1114`，约 1%） | 立刻把它当唯一阻断检查 | 影子期只观测；转正后保留「把命令改回 tsc」的一行回退 |
| 7 | TS6 与 tsrs 共用 `tsBuildInfo` 反复全量 | 没分 `tsBuildInfoFile` | 改到 `./node_modules/.cache/tsrs/tsconfig.tsbuildinfo` |
| 7 | 本地 watch 被换成 tsrs | 顺手统一脚本 | `typecheck:watch` 永久 tsc（Windows 退出码 5） |
| 8 | nest CLI 在 TNB 下挂 | `getParsedCommandLineOfConfigFile` 不是函数 | 按 §10.5 走「仅 nest 回退」（catalog 回 6.0.3 + scoped overrides） |
| 8 | admin 诊断差异不可归因 | 外壳/引擎缺陷 | 全局回退（§10.6 第一档），并在评估里记录差异 |
| 8 | `trustPolicy` 拦住 TNB | `pnpm install` 报可信度下降 | 把该版本加入 `trustPolicyExclude` 并写理由；不要关策略 |
| 8 | 装饰器元数据丢失（接口 200 但字段消失） | `design:paramtypes` 与 SWC 不等价 | 阻塞，不转正；保留 SWC emit 路径 |
| 任何 | 改了门禁命令但三表没同步 | 表里还有那条命令但名字已改 | 跑 `gate-wiring.test.ts` / `ci-workflow.test.ts`；按 §1.5 五处一起改 |

## 12. 明确的非目标

以下事**本轮不做**，遇到时记下来、不顺手做：

1. **不裸装 `typescript@7`**。nest CLI 的守卫（判 API 形状）与 vue-tsc 的 peer `<7` 都还没解；TNB 外壳是当前唯一合法形态，去掉外壳是后续优化不是目标。
2. **不做 catalog 双别名**（`@typescript/native` 之类的第二条目）。已作废；TNB 全局接入后它失去意义。
3. **不混用检查器**。不给一部分包换 tsrs、一部分留 tsc；要换就整批换（影子期例外，但必须明确「以哪个为准」）。
4. **不用 `tsrs --fast` 做门禁**。它可能改变诊断与退出码，与门禁的确定性要求冲突。
5. **不删 `typescript` 依赖位**。TNB 以同名包面接管；三支文档/产物检查与 drift spec 继续走 classic API。
6. **不动 `apps/e2e` 的编排**（锁 → preflight → 重建库 → playwright、端口与安全阀、不变量）。E2E 只作为下游消费者被动受益（`tsrs` 让它的 `types:check` 变快），编排一行不改。
7. **不升 Vitest 5**。当前 4.1.2 的 peer 已含 vite ^8，升 5 是可选优化、不属于本轮；要做单独立项。
8. **不全量替换 ESLint**。Vue 模板、五条本地规则、类型感知分层至少留一项在 ESLint，所以 oxlint 只能是第二轨。
9. **不趁 P1 重划分包**、**不把共享包改成 ESM-only**、**不做「一次换完全部工具」的演示分支**（四轨道正交的价值就是任意一条停下都不影响其它三条）。
10. **不为赶版本改全局供应链设置**（`minimumReleaseAge` / `trustPolicy` / `catalogMode`）。撞上就等一天或走逐条豁免。

## 13. 附录

### A. 每批的最小验收命令（速查）

| 批次 | 必跑（跑不了要记为未验证） |
|------|---------------------------|
| 1 | `pnpm --filter @walnut/scripts exec vitest run src/ci/__tests__/check-pre-hooks.test.ts`、`pnpm walnut lint:pre-hooks` |
| 2 | `pnpm exec turbo run build --filter=@walnut/admin --force`、`pnpm walnut smoke:dist`、`pnpm walnut lint:dist`、`pnpm walnut types:check` |
| 3 | `pnpm walnut types:check`、`pnpm --filter @walnut/admin types:check`、`pnpm --filter @walnut/contract run test`、`pnpm walnut lint:exports` |
| 4 | `pnpm walnut format:check`、`pnpm walnut lint`、`pnpm --filter @walnut/scripts exec vitest run src/ci/__tests__/gate-wiring.test.ts src/ci/__tests__/ci-workflow.test.ts` |
| 5 | `pnpm walnut lint`、`pnpm walnut lint:oxlint`、`pnpm walnut types:check`、`pnpm walnut test` |
| 6 | `pnpm --filter @walnut/utils run build && pnpm --filter @walnut/contract run build`、逐子路径 `require` 冒烟、`pnpm walnut lint:exports`、`pnpm walnut lint:turbo-cache` |
| 7 | `pnpm walnut types:check`、`pnpm walnut types:check:tsrs`（影子期）、`pnpm walnut test` |
| 8 | §10.3 的基线对比、§10.4 的五步、`pnpm walnut types:check`、`pnpm --filter @walnut/server run build` |

### B. 共享文件租约速查

| 批次 | catalog | commands.ts | prepush.ts | steps.ts | ci.yml | turbo.json | 根 package.json |
|------|---------|-------------|------------|----------|--------|------------|-----------------|
| 1 | — | — | — | — | — | — | — |
| 2 | `vite` | — | — | — | — | — | — |
| 3 | — | — | — | — | — | — | — |
| 4 | `oxfmt`、`eslint-config-prettier` | `format:check` / `format:fix` | `format` 段 | `format` 行 | 格式化步骤 | — | `lint-staged`、`oxfmt` devDep |
| 5 | `oxlint`、`eslint-plugin-oxlint`、`@oxlint/migrate` | `lint:oxlint*` | 不加 | 不加 | oxlint 步骤 | 方案 T 时才动 | `oxlint` devDep |
| 6 | `tsdown` | — | — | — | — | — | — |
| 7 | `tsrs` | `types:check:tsrs` | 不加 | 不加 | report-only 步骤 | `types:check:tsrs` 任务 | — |
| 8 | `typescript`、`vue-tsc` | — | — | — | — | — | — |

### C. 证据指针（写回报时引用章节，不抄全文）

| 结论 | 证据在哪 |
|------|----------|
| 为什么 `baseUrl` 必须先清 | 评估 5.6 / 7.2；本篇 §5 |
| 为什么 `minify` 只动一处 | 评估 5.3；本篇 §1.3 第 1 条、§4.2 |
| 为什么 `dts: false` / `exports: false` | 评估 4.4 / 7.3；本篇 §8.2 |
| 为什么 server 的 `consistent-type-imports` 要特殊处理 | 评估 7.4 第 1 条；本篇 §7.4 |
| 为什么 oxlint 不能全量替代 ESLint | 评估 7.1；本篇 §7.4 |
| 为什么 tsrs 只能先进影子 | 评估 5.5 / 8.2；本篇 §9.2 |
| 为什么 nest-on-TNB 要 PoC 先行 | 评估 5.4 / 8.1；本篇 §10.4 |
| 为什么改命令要动三表加两个测试 | 本篇 §1.5（`gate-wiring.test.ts` / `ci-workflow.test.ts`） |
