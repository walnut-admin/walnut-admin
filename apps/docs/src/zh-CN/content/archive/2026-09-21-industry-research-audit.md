# Walnut Admin 调研文档回顾 + 2026 时效性核实

> 📦 **归档文档（2026-09-21 审计）**：原在仓库根 `docs/reviews/`，现已迁入文档站 `content/archive/`。

> 仅分析产出,未修改仓库内任何原有文件。约定:**「文档写」**=本地文档原文主张;**「核实」**=本次联网核对后的判断。

---

## A. 本地文档回顾

### A1. `industry-research/`(8 篇:行业调研 + 现状对比)

**index.md** — 索引。说明本目录收集大型 TS monorepo 主流实践,每篇含「业界共识/本项目做法/差异分析」;列 7 篇主题与 7 个参考来源(Turborepo、pnpm、Changesets、ESLint、Vitest 官网 + Astro、tRPC)。差距项:无。

**01-typescript-configuration** — tsconfig 分层体系、选项决策树、共享 config 包取舍、TS 版本管理、类型检查门禁、反模式。核心结论:**不用 TS Project References**(构建器忽略 `references`、维护成本高、增量收益被 Turbo 取代),改走 symlink + `exports`;base 只放与模块系统无关的纯语言级选项;TS 版本用 catalog 全局锁一个。差距项:① `types:check` 未与 test/build 串联;② `declaration: true` 仅 contract 有;③ 未提取 `@repo/typescript-config`(判定当前规模不需要)。

**02-eslint-configuration** — 共享 config 包架构、Flat config 迁移、oxlint/biome 决策、Prettier 归属、Husky+lint-staged+commitlint、syncpack、Knip、四层防线。核心结论:Flat config 是唯一入口;插件放 config 包 `dependencies`、`eslint` 放 `peerDependencies`;**oxlint 与 biome 均不支持 Vue SFC → 继续 ESLint**;Prettier 放根目录。差距项:共享 config 包未提取;commitlint/syncpack/Knip 未接入(后三项已落地)。

**03-ci-cd-pipeline** — GitHub Actions、`fetch-depth: 0`、affected-only 三种 filter、Turbo Remote Cache、Docker 多阶段、Environments、Release workflow。核心结论:四目标(affected-only/跨机缓存/锁死依赖/单 workflow 多环境);门禁按快到慢排序;**推荐接入 Remote Cache**(Vercel 托管或 `ducktors/turborepo-remote-cache` 自建)。差距项:affected-only 未实现;remote cache 未配置(标注「推荐加上,免费,收益大」)。⚠️**此文与最终决策相反**。

**04-testing-strategy** — Vitest 统一、共享 preset、四层分层、co-located、覆盖率目标、E2E 选型、测试数据。核心结论:Vitest 已是事实标准;NestJS+SWC 需 `unplugin-swc` 支持装饰器元数据;覆盖率是信号不是目标(工具包 90%+/组件 60%+);集成测试**优先 `mongodb-memory-server`**;E2E 放 `apps/admin/e2e/`。差距项:共享 preset 未提取;分层与覆盖率目标缺失;co-located 不统一;E2E 与 Codecov 无。

**05-package-scripts** — 标准 scripts 约定、根只做委托、turbo.json 编排(`dependsOn` 三写法、`inputs`/`outputs`、`env` vs `passThroughEnv`)、按包类型模板、catalog 协同。核心结论:「一致性 > 自由度」;根 scripts 不含构建逻辑;不声明 `outputs` 等于放弃缓存;`DATABASE_URL` 类用 `env`、`SENTRY_AUTH_TOKEN` 类用 `passThroughEnv`。差距项:`clean`/`test:coverage` 缺失;`inputs` 未精化;`env` 未区分。

**06-versioning-and-changelog** — Changesets 三段式、Fixed/Independent/Linked、changelog 生成、CI 自动化、级联 bump、pre-release、Changeset Bot、SemVer。核心结论:用 Changesets 而非 semantic-release(「版本声明是显式 artifact」);内部包也应有版本号;`updateInternalDependencies: "patch"`;**ADR-0011 采用 Changesets + git-cliff 双轨**。差距项:release.yml 未实现;Changeset Bot 未装。

**07-fullstack-architecture** — 以契约为中心、contract 边界与 `exports` 硬边界、Zod vs class-validator、API 通信层、前后端分层、反模式。核心结论:**70% 复用价值来自统一数据模型**;contract 必须零框架依赖;**推荐 Zod 统一前后端验证**替代 class-validator,后端用**手写 `ZodValidationPipe`(约 15 行)**;前端 VeeValidate + `toTypedSchema`。差距项:Zod 未落地(「收益大但工程量大」);其余 7 项完全对齐。

### A2. `monorepo/`(12 篇:本项目架构决策)

**index.md** — 全景。12 包(3 app + 9 共享包,platform-any/web/tooling 分组)+ server 内层 9 个 NestJS lib(`@walnut-server/*`,走 paths 不走 pnpm)。栈:pnpm 11+/Turbo 2.9/TS 6.0/ESLint 10.3/Knip 6.29/simple-git-hooks/Vite 8/NestJS 11/Node ≥24.13.0。四决策:异构 toolchain、双命名空间、248 依赖全量 catalog、`hoisting: false`。差距项:无。

**typescript.md** — base 只放纯语言级选项(`noEmit`、`verbatimModuleSyntax`);DOM lib 已下沉到浏览器包;server **完全不 extends base**(CJS + `moduleResolution: node` + `experimentalDecorators` 与前端冲突),`strict: true`;不用 Project References;不提取共享 tsconfig 包;不声明跨包 `paths`。差距项:无遗留。

**eslint.md** — ESLint 10.3 flat config + `@antfu/eslint-config`,经 `@walnut/eslint-config` 分发 vue/nest/base;NestJS 的 `ts/no-unsafe-*` 降为 warn(symlink 下已知误报);**不用 Prettier**(无 `.prettierrc`/`eslint-config-prettier`/`format` 脚本,格式化由 ESLint stylistic 承担);**不用 oxlint/biome**。门禁:pre-commit(ESLint fix)/commit-msg(commitlint)/pre-push(boundaries+types:check+syncpack)/CI。差距项:`base` 预设无直接消费者。

**package-scripts.md** — 标准 script 名 + 根只做委托;`NODE_OPTIONS` 用 `cross-env`;**不写 mega-scripts**;**不用 `concurrently`**(不理解依赖拓扑);git-cliff 已移除、发布逻辑收敛到 `@walnut/release`。差距项:文档自承理想与现实落差——仅 server/utils/client/release 有 `test`;server 用 `test:cov` 非 `test:coverage`;eslint-config 无 scripts。

**pnpm-catalog.md** — `catalogMode: strict` 阻止直接版本号;**精确版本锁死**(禁用 `^`/`~`);内部包 `workspace:*`;**不用 Named Catalogs**。差距项:Dependabot/Renovate 未配,catalog 升级靠 `syncpack update`/`taze` 手工。

**pnpm-workspace-config.md** — 逐项解释配置。`catalogMode: strict`、4 组 packages glob、`hoisting: false`(防幽灵依赖)、`overrides: glob 11.1.0`、`minimumReleaseAgeExclude`(dotenvx)、`allowBuilds` 16 项;`.npmrc` 的 `strict-peer-dependencies`/`engine-strict`/`save-exact` + 5 条 `public-hoist-pattern`。差距项:无(⚠️ 见 B5)。

**turbo.md** — 10 个任务;`dependsOn: ["^build"]` 含 `dev`/`test`(解决 fresh clone 下 server `require` CJS dist 的 MODULE_NOT_FOUND);`build:stage` 独立任务(废除三重 `--` 透传);`inputs` 用 `$TURBO_DEFAULT$` + 排除 md/tsbuildinfo;Strict Env Mode;**Tag-Based 架构边界**(platform-any/web/node deny,pre-push + CI 双闸)。差距项:**不接入 Remote Cache(2026-08-08 决定)**——单人维护、规模小,保留零配置接入路径;「CI cache hit >80%」标注为期望值待实测。

**release.md** — **2 个 fixed 组**(Apps 3 包 + Packages 9 包,组内同版本);scope 必须是 12 个包名之一,scope 决定归因 → fixed 组联动;bump 映射(feat=minor/fix|perf|refactor|revert=patch/`!`=major/其余 skip);`pnpm release` 编排 4 步;**不用 git-cliff(已移除)**、**不用 semantic-release**、**不发布 npm**;用 `@changesets/changelog-github` 做 per-package CHANGELOG。差距项:无。

**knip.md** — Knip 6.29.0;`knip:packages` 用 `--workspace ./packages/*/*`(**曾因单层 glob 匹配不到而静默空操作,「零发现」是假象**,2026-08-08 修复);admin 因 `JSON.parse(env.VITE_PROXY)` 让 jiti 无法加载 vite.config 故 `vite: false`;NestJS/Vue 装饰器与 auto-import 对静态追踪不可见需大量 `ignore`;全仓 exit 1 属预期。差距项:`ignoreDependencies` 已膨胀(列为 R2)。

**syncpack.md** — syncpack v15.3.2;`.syncpackrc.json` 用新版 `versionGroups`(`$LOCAL` + `pinVersion: workspace:*`)+ `semverGroups`(`pnpmCatalog` 要求 `range: ""`);CLI 用 `--dependency-types dev,prod` 过滤 pnpm 管理的 `overrides`。与 taze **互补**(taze 是「浏览器」,syncpack 是「执行器」)。差距项:无。

**env-management.md** — dotenvx ECIES(AES-256 + Secp256k1)逐值加密;`env-encrypted/`(密文提交,注释即模板)→ `pnpm setup-env` 解密到 gitignored 的 `env-local/`;`.env.keys` 经 1Password 分发(4 个 key 行);`pnpm encrypt-env` 每次全量重建密钥、旧密钥立即作废;CI 用 `DOTENVX_KEYS_FILE` secret,**不把加密文件放仓库根**;列 6 个禁止修改的密钥。差距项:无。

**architecture-todo.md** — P0 全部 ✅;P1 中 **Remote Cache ❌ 不接入**、部署流水线 ✅、commitlint ✅;P2 中 Docker ✅、syncpack ✅;**P3(当前不做)**:Zod 替换 class-validator(ADR-0016,100+ DTO、6 子系统,暂不迁移)、Playwright E2E、**Vitest 共享 preset(理由已过时,现 12 包/4 份 config,已跨过提取阈值)**、**oxlint/biome(「都不支持 Vue SFC,等支持后再加」)**。另有 A1-A11 与优化池 R1-R11(其中 **R7:「`ignoreDeprecations: "6.0"` 一刀切静音了通往 tsgo 的迁移信号,建议逐个决策」**)。

---

### A3. 第三方参考链接清单

**(1) 真正的第三方资料/工具官网**

| 链接标题 | URL | 出现在 | 用途 |
|---|---|---|---|
| Turborepo 官方文档 | https://turbo.build/repo/docs | ir/index | 任务编排、缓存、remote cache |
| pnpm 官方文档 | https://pnpm.io/ | ir/index | workspace/catalog/hoisting |
| Changesets 官方文档 | https://github.com/changesets/changesets | ir/index、ir/06 | 版本管理、changelog |
| ESLint 官方文档 | https://eslint.org/docs/latest/use/configure/ | ir/index | Flat config、shareable configs |
| Vitest 官方文档 | https://vitest.dev/ | ir/index | 配置、workspace、覆盖率 |
| Astro 仓库 | https://github.com/withastro/astro | ir/index | 大型 pnpm monorepo + changesets |
| tRPC 仓库 | https://github.com/trpc/trpc | ir/index | 类型共享、vitest 参考 |
| oxlint 文档 | https://oxc.rs/docs/guide/usage/linter.html | ir/02 | Rust linter 评估 |
| Biome | https://biomejs.dev/ | ir/02 | all-in-one 对比 |
| syncpack 文档 | https://jamiemason.github.io/syncpack/ | ir/02 | 版本一致性 |
| Knip 概览 / 官网 | https://knip.dev/ | ir/02、mono/knip | 死代码检测 |
| Knip Configuration 参考 | https://knip.dev/reference/configuration | mono/knip | 配置项 |
| Knip Known Issues | https://knip.dev/reference/known-issues | mono/knip | 已知局限 |
| Knip GitHub 仓库 | https://github.com/webpro-nl/knip | mono/knip | 版本/星标/下载量 |
| Knip JSON schema | https://unpkg.com/knip@5/schema.json | ir/02 | `$schema` |
| syncpack GitHub | https://github.com/JamieMason/syncpack | mono/syncpack | 版本与使用者 |
| taze GitHub | https://github.com/antfu/taze | mono/syncpack | 交互式依赖升级(⚠️ 见 B7) |
| Codecov | https://about.codecov.io/ | ir/04 | PR 覆盖率评论 |
| Coveralls | https://coveralls.io/ | ir/04 | 同 |
| Playwright | https://playwright.dev/ | ir/04 | E2E 选型 |
| Cypress | https://www.cypress.io/ | ir/04 | E2E 选型 |
| Nightwatch | https://nightwatchjs.org/ | ir/04 | E2E 选型 |
| git-cliff | https://git-cliff.org/ | ir/06 | changelog 生成器 |
| Changeset Bot GitHub App | https://github.com/apps/changeset-bot | ir/06 | PR 内 changeset 提醒 |
| Changesets config schema | https://unpkg.com/@changesets/config@3/schema.json | ir/06 | `$schema` |
| tsconfig JSON schema | https://json.schemastore.org/tsconfig | ir/01 | `$schema` |
| Turbo JSON schema | https://turbo.build/schema.json | ir/05 | `$schema` |
| turborepo-remote-cache(自建) | 仅给 Docker 镜像名 `ducktors/turborepo-remote-cache`,无完整 URL | ir/03 | 自托管 remote cache |

**(2) 指向本项目自己 GitHub 的链接(非第三方)**

全部集中在 `monorepo/*.md` 的「关键文件」表,指向 `github.com/walnut-admin/walnut-admin`:
`tsconfig.base.json`(typescript)、`@walnut/eslint-config` 目录 + `eslint.config.mjs` + `vue.mjs`/`nest.mjs`/`base.mjs`(eslint)、`turbo.json`(turbo)、根 `package.json` + `apps/admin/package.json` + `apps/server/package.json`(package-scripts)、`knip.config.ts`(knip)、`.syncpackrc.json`(syncpack)、`scripts/setup-env.ts` + `apps/{admin,server}/env-encrypted/` + `.env.keys`(env-management)。

> 第三类:两目录中大量指向 `/content/adr/*.md`(0003/0008/0009/0010/0011/0012/0016/0017)及同仓库其它文档的相对链接,属**内部互链**。

---

### A4. 技术选型决策清单(每条:决策 — 依据 — 理由)

**来自 `industry-research/`(行业主张,部分未被采纳)**:不用 TS Project References — ir/01 — 构建器忽略 `references`、增量收益被 Turbo 取代;base 只放纯语言级选项 — ir/01 — module/resolution 由各包自声明;不把 `paths` 写进 root tsconfig — ir/01 — `baseUrl` 覆盖致子包继承不到;不用 `composite` — ir/01 — Vite 不认识;关闭 `isolatedDeclarations` — ir/01 — 否则每个 enum 需手写 `.d.ts`;门禁顺序 lint→typecheck→test→build — ir/01、ir/03 — 从快到慢;**不用 oxlint/biome** — ir/02、mono/eslint — Vue SFC 是 blocker;**不用 Prettier** — ir/02→mono/eslint — 由 ESLint stylistic 承担;pre-commit 只做 ESLint fix — ir/02 — 必须秒级;syncpack 非必需 — ir/02 — catalog strict 已覆盖;**接入 Remote Cache(后被推翻)** — ir/03 — 「免费,收益大」;affected-only CI — ir/03;Dockerfile 放 `apps/server/` 不放根 — ir/03;集成测试优先 `mongodb-memory-server` — ir/04;E2E 放 `apps/admin/e2e/` — ir/04;测试 co-located(`__tests__/`) — ir/04;覆盖率不追 100%、80% baseline — ir/04;推荐 Codecov — ir/04;用 Changesets 而非 semantic-release — ir/06 — 显式 artifact;Independent 版本模式 — ir/06;`updateInternalDependencies: "patch"` — ir/06;**Zod 统一前后端验证**替代 class-validator — ir/07 — 一份 schema 服务两端;contract 零框架依赖 — ir/07 — 一旦依赖 Vue/NestJS 依赖图崩塌;`exports` 是硬边界 — ir/07 — 防深层依赖。

**来自 `monorepo/`(本项目实际决策)**:**不用 TS Project References**(ADR-0010) — typescript — 异构工具链不兼容、Vite 不读 `references`;**server 完全不 extends base**(ADR-0012) — CJS+node+decorators 与 ESM+bundler 冲突;**不提取共享 tsconfig 包** — 12 包规模下 root base 足够;**不声明跨包 `paths`** — 靠 symlink + `exports` 保证一致;DOM lib 下沉到浏览器包 — 防 platform-any 写浏览器代码;**不用 Prettier** — 无 `.prettierrc`/无 `format` 脚本;**不用 oxlint/biome** — 都不支持 Vue SFC;**不用 Husky**,用 simple-git-hooks + lint-staged — 更轻;NestJS 的 `ts/no-unsafe-*` 降 warn — symlink 下已知误报;**`catalogMode: strict`** — 运行时强制不靠自觉;**精确版本锁死** — 各环境装到完全相同版本;**全量 catalog** — 单一事实来源;**不用 Named Catalogs** — 无「部分包用旧版」场景;**`hoisting: false`** — 严格隔离防幽灵依赖(⚠️ 见 B5);`overrides` 只留 `glob` — lru-cache 已由 catalog 锁定;**不配置 Remote Cache** — 单人维护、CI 规模小;`dev`/`test` 也 `dependsOn: ["^build"]` — fresh clone 下 server `require` CJS dist 会 MODULE_NOT_FOUND;`build:stage` 独立任务 — 废除三重 `--` 透传;Tag-Based 架构边界三闸 — platform deny 规则;**不用 `concurrently`** — 不理解依赖拓扑;根 scripts 不写 mega-scripts — 编排归 Turbo、发布归 `@walnut/release`;**不用 git-cliff(已移除)** — 改 per-package CHANGELOG;**不用 semantic-release** — 让开发者确认 bump;**2 个 fixed 组**(Apps 3 + Packages 9) — 组内同版本;**不发布 npm** — 内部 monorepo;**不把加密 env 放仓库根** — 两 app 部署方式与敏感度不同;Docker 三镜像→TCR→compose — 取代 SCP 老方案;**PWA 移除** — workbox-build 传递链问题多;**Zod 替换 class-validator:暂不迁移**(ADR-0016) — 100+ DTO、6 子系统;**Vitest 共享 preset:暂缓→重评** — 已跨过提取阈值;**`ignoreDeprecations: "6.0"`** — 为 TS 7 铺路(⚠️ 见 B2)。

---

## B. 2026 年联网核实时效性

### B1. 「oxlint 与 biome 都不支持 Vue SFC」 → **部分过时(两工具处境已分化)**

**文档写**:两者「都不支持 Vue SFC」,是 blocker,「等支持后再加为 ESLint 的第一道快速扫描」。

**核实**:**「都不支持」在 2026 年已不准确。** ① **oxlint 已到「部分支持」**:Oxc 官方兼容矩阵把 **Vue 标为 Partial**([oxc.rs/compatibility](https://oxc.rs/compatibility.html));oxlint 现 800+ 规则,`oxc-project/oxc` 有专门 Vue 追踪 [issue #15761](https://github.com/oxc-project/oxc/issues/15761) 与 [RFC #21936](https://github.com/oxc-project/oxc/discussions/21936),2026-06 已有 Vue 规则 PR(如 [#21935](https://github.com/oxc-project/oxc/pull/21935)),生态侧出现 [`oxlint-plugin-vue-sfc`](https://socket.dev/npm/package/oxlint-plugin-vue-sfc);官方迁移指南已支持 flat config 自动迁移并**建议长期全量迁到 oxlint**([Migrate from ESLint](https://oxc.rs/docs/guide/usage/linter/migrate-from-eslint))。② **Biome 仍实验性**:2026 路线图自承「去年宣布 Vue/Svelte/Astro 实验性完整支持,**许多用户不满**」,并把「增强规则使其对 Vue/Svelte/Astro 生效」列为 **2026 待办**而非已完成([Roadmap 2026](https://biomejs.dev/blog/roadmap-2026/))。③ 文档忽略的变化:**NestJS 12 的 `nest new` 已用 oxlint 取代 ESLint、Vitest 取代 Jest**([NestJS v12.0.0](https://github.com/nestjs/nest/releases/tag/v12.0.0))。

**建议修正**:> 「oxlint 已对 Vue SFC 提供**部分**支持(官方矩阵标 Partial,专属 Vue 规则持续落地),但覆盖度不足以承担前端全量 lint;Biome 对 Vue 仍是**实验性**。本项目**暂不引入**——理由从『不支持』改为『覆盖度不足,引入即需双跑,收益不抵双配置成本』,评估触发条件设为『oxc 兼容矩阵 Vue 转 Full Support』。」

### B2. `ignoreDeprecations: "6.0"` / TS 7 准备 → **部分过时(方向对,时点已到)**

**文档写**:R7「`ignoreDeprecations: "6.0"` 一刀切静音了通往 tsgo 的迁移信号,建议逐个决策,为 TS 7 铺路」。

**核实**:**判断正确,但时点已变——TS 7 已于 2026-07-08 正式发布。** TS 6.0 官方定位是「**最后一个基于现有 JS 代码库的版本**」、5.9→7.0 的桥梁([TS 6.0 RC](https://devblogs.microsoft.com/typescript/announcing-typescript-6-0-rc/));TS 7.0 已发布:Go 原生 + 多线程,全量构建 **8x–12x** 加速(vscode 125.7s→10.6s),内存降 6%–26%([Announcing TypeScript 7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/))。该选项语义:被弃用选项在 6.0 下仍可用但需显式设此值,**TS 7.0 彻底移除**;典型弃用含 `moduleResolution: node/node10`、`baseUrl`、`esModuleInterop: false`、`outFile`([TS 6.0 弃用参考](https://github.com/fusengine/agents/blob/main/plugins/typescript-expert/skills/ts-config/references/deprecations-6.md))。**对本仓库的直接风险:`apps/server/tsconfig.json` 正在用 `moduleResolution: "node"`**(mono/typescript §3 明确写为后端选项),正是 6.0 弃用、7.0 移除项之一。

**建议修正**:> 「`ignoreDeprecations: "6.0"` 是官方推荐的**过渡手段**(顺序:先加此值保证可构建→修新默认值→逐个替换弃用项→移除)。但 **TS 7.0 已于 2026-07 发布**,该选项在 7.0 失效。应立即执行 R7:跑一次不带 `ignoreDeprecations` 的 `tsc` 列出实际触发项,**优先处理 `apps/server` 的 `moduleResolution: "node"`**,再评估 tsgo 迁移。」

### B3. Vitest 应改用 `projects` → **成立(且文档写法已废)**

**文档写**:`ir/04` §4.2 用 `vitest.workspace.ts` + `defineWorkspace` + `--workspace` 收全仓覆盖率。

**核实**:**应改用 `projects`。** 官方明确警告:「**The `workspace` is deprecated since 3.2 and replaced with the `projects` configuration.**」([Test Projects](https://vitest.dev/guide/projects))。本仓库 catalog 锁 vitest 4.1.2,可用 `projects`。**共享 preset 当前推荐做法**:项目配置用 **`defineProject`**(而非 `defineConfig`,以排除 `reporters`/`projects`/`sequence`/`deps` 等无项目级意义的选项取得类型约束);跨项目复用用 **`mergeConfig`**;`projects` 条目可指向 glob 或具名配置(如 `'packages/*/vitest.config.{e2e,unit}.ts'`)。**Vitest 5.0 两条新默认值影响 preset 设计**:① `extends` 默认 `true`——**内联项目**默认继承 root 全部选项(含 `plugins`/`resolve.alias`),数组**合并追加**而非覆盖,需旧行为要显式 `extends: false`;② 内联项目默认**共享 Vite server**(`sharedViteServer`)。另:`vite` 改为**必需 peerDependency**,要求 Vite ≥6.4、Node ≥22.12([Migrating to Vitest 5.0](https://vitest.dev/guide/migration/))。本仓库 Vite 8 + Node 24 满足,升级时需确认各包已声明 `vite`。

**建议修正**:> 「用 `test.projects`(写在 `vitest.config.ts`)替代 `vitest.workspace.ts`;`workspace` 自 3.2 废弃。共享 preset 导出 `defineProject({...})`,消费者用 `mergeConfig` 合并。注意 Vitest 5 的 `extends: true` 默认值——root 的 `plugins`/`alias`/`setupFiles` 会自动并入内联项目,排障先想到这点。vitest 4.1.2 可用 `projects`,无升级阻塞。」

### B4. Turbo Remote Cache「不接入」 → **决策成立,条件与版本基线已变**

**文档写**:2026-08-08 决定「单人维护 + CI 规模小 → **不接入**」,保留 `TURBO_TOKEN`/`TURBO_TEAM` 透传以便未来零配置接入。

**核实**:决策理由未被推翻。Vercel Remote Cache 仍**在包括免费版的所有方案上免费**、不要求托管在 Vercel;官方也明确「**你不必为了用 Turborepo 而用 Remote Caching**」——与本项目判断一致;自托管路径仍由官方文档列出(`turbo login --manual` + 自建服务,`ducktors/turborepo-remote-cache` 仍在维护)([Remote Caching](https://turborepo.dev/docs/core-concepts/remote-caching))。但**版本基线已过期**:文档写 Turbo 2.9.14,实际已到 **2.11**(2.10 于 2026-06-24:优雅任务关停、延迟输入哈希、`--affected` 与 `--filter` 可组合、本地缓存淘汰;2.11 于 2026-09-18:原生支持 Rust/Python/Go、生产 pruning)([Turborepo Blog](https://turborepo.dev/blog));**2.9 的主题正是「为 3.0 做准备」的 future flags 与弃用**([Turborepo 2.9](https://turborepo.dev/blog/2-9)),升级应逐条处理;Turbo 3 尚未发布。另:「**CI cache hit 率 >80%**」在无 remote cache 时跨机器命中本就不可能,该指标应重述为「同一 runner 内重复运行的命中率」。

**建议修正**:> 「维持『暂不接入 Remote Cache』——单人维护、单 runner CI 下跨机复用确无收益。需同步:① Turbo 基线 2.9.14 → **2.11**,注意 2.9 的 future flags 是 **3.0 迁移准备**;② 删除或重定义『CI cache hit >80%』。触发条件明确为『CI 增至多 runner / 引入第二台构建机』。」

### B5. pnpm catalog / `catalogMode: strict` → **用法成立;但 `hoisting: false` 是无效配置项** ⚠️

**文档写**:`catalogMode: strict` 是「pnpm 10.12+ 的原生强制机制」,配套 `hoisting: false` 实现严格隔离。

**核实**:① **`catalogMode: strict` 成立且仍推荐**。官方确认其添加于 **v10.12.1**,取值 `manual`(**默认**)/`strict`/`prefer`;`strict`=「只允许 catalog 版本,添加超范围依赖会报错」([pnpm Settings — catalogMode](https://pnpm.io/settings/other))。文档写「10.12+」准确。补充:该设置**只约束 `pnpm add`**,文档「`pnpm install` 直接报错」宜修正;v12.3.0 起本地路径/tarball URL/`workspace:<path>` 永不进 catalog。pnpm 当前已到 **12.x**(11.0 于 2026-04-28 发布)。② **`hoisting: false` 不是合法设置项**。官方「Dependency Hoisting Settings」全部选项为 `hoist`、`hoistPattern`、`publicHoistPattern`、`hoistWorkspacePackages`、`shamefullyHoist`、`hoistingLimits`——**没有 `hoisting`**([pnpm Settings — node_modules](https://pnpm.io/settings/node-modules))。关闭提升的正确键是 **`hoist: false`**(默认 `true`);官方明确「Setting `hoist` to `false` empties `hoistPattern`」。故 `pnpm-workspace.yaml:12` 的 `hoisting: false` 很可能未生效(`hoist` 仍 `true`,依赖仍在 `node_modules/.pnpm/node_modules` 被提升),直接影响 `mono/index.md` 关键决策 №4 与 `pnpm-workspace-config.md` 的论述基础。⚠️**本项未能在本机实测复现**(`pnpm.ps1` 被执行策略拦截)。

**建议修正**:> 「`catalogMode: strict`(≥10.12.1,默认 `manual`)保留。**但 `hoisting: false` 不是 pnpm 合法项**——正确写法为 **`hoist: false`**。请核实该行是否一直未生效;若确认,`mono/index.md`『hoisting: false 严格依赖隔离』与 `pnpm-workspace-config.md` 需改写,并重新评估幽灵依赖的实际暴露面。另『`pnpm install` 直接报错』宜改为『`pnpm add` 被拒绝』。」

### B6. Changesets + git-cliff 双轨 → **已过时(文档内部自相矛盾)** ⚠️

**文档写**:`ir/06` §4.2 称「ADR-0011 采用的方案是 Changesets + git-cliff」,§10 标注 git-cliff「✅ 已配置」。

**核实**:**仓库实际早已改单轨,属确定性文档漂移。** `mono/release.md` 明确写「**不用 git-cliff(已移除)**……现改为 Changesets 原生 per-package CHANGELOG」;`mono/package-scripts.md` 写「git-cliff 已移除,`scripts/version/` 目录不存在」;`architecture-todo.md` 执行记录有「git-cliff 残留清理(release.test.ts 标题、knip ignore、文档引用)」。即仓库已切到 **`@changesets/changelog-github` 单轨**,`ir/06` 未同步。**社区现状**:Changesets 仍是 TS monorepo 版本管理主流(catalog 锁 `@changesets/cli` 2.31.1、`changelog-github` 0.7.0,均在维护);git-cliff 亦活跃(2.x 持续发版)。release-please/release-drafter/changelogithub/cocogitto/knope 各有侧重,但**无一个在 2026 年取代 Changesets 在 pnpm/TS monorepo 中的位置**。就本项目需求(不发布 npm、靠 commit scope 归因、per-package 历史),现行方案合适。`release.md` 自己留了前瞻:「2026 年的新趋势是在 per-package 之上**可选**叠加根级聚合总览,当前不需要」——比 `ir/06` 新。

**建议修正**:> `ir/06` §4.2/§10 改为:「**双轨方案已废弃**。ADR-0011 早期设想 Changesets 管版本号 + git-cliff 渲染根级 CHANGELOG;实际实现改为一轨——Changesets 原生 per-package CHANGELOG(`@changesets/changelog-github`),根级 CHANGELOG 不再生成。Changesets 仍是 2026 年主流;git-cliff 仍在维护但本项目已无场景。将来若需根级聚合总览可再选择性引入。」

### B7. Knip / syncpack / taze 状态 → **三者均活跃;仅 taze 仓库归属需更新**

**Knip** — 成立,仍推荐。最新 **6.x**(观测到 `knip@6.16.0`,[releases](https://github.com/webpro-nl/knip/releases/tag/knip%406.16.0))。配置模型未变:仍为 `workspaces` + `entry`/`project`/`ignore`/`ignoreDependencies`,与 `mono/knip.md` 一致。文档记「6.29」——**该小版本号未能独立核实**,但「6.x 在维护」成立。

**syncpack** — 成立,**且文档用法已是最新格式**。`mono/syncpack.md` 称 v15.3.2,用的正是新版 `versionGroups` + `semverGroups`(`$LOCAL`、`pinVersion`、`pnpmCatalog`、`range: ""`),与官方一致([Version Groups](https://syncpack.dev/version-groups/));旧版顶层 `dev`/`prod`/`semverRange` 键已在 14.0.0/15.0.0 迁移中被取代([Release 15.0.0](https://github.com/JamieMason/syncpack/releases/tag/15.0.0))——**本项目已用对**,无需修正。文档识别出 v15 原生支持 pnpm catalog,是关键差异点。

**taze** — 工具活跃,但 URL 过时。最新 **19.x**(观测 19.9.0),仓库已迁到 **`antfu-collective/taze`**(原 `antfu/taze` 重定向)。`mono/syncpack.md` 中 `https://github.com/antfu/taze` **需更新**。与 syncpack 的「浏览器 vs 执行器」互补判断仍成立。

**建议修正**:> 「三工具均活跃:Knip 6.x、syncpack 15.x、taze 19.x,推荐度不变。需修两处:① taze 链接→`github.com/antfu-collective/taze`;② `syncpack.md` 的『最新 15.3.2(2026-06-15)/月下载 360 万』等量化数据加核实日期或改为『15.x』,避免再漂移。」

### B8. NestJS 中的 Zod 统一验证 → **已过时(方向对,「需手写 Pipe」前提被官方推翻)** ⚠️

**文档写**:`ir/07` §3.3 推荐 Zod 并给出**手写 `ZodValidationPipe`(约 15 行)**示例,§3.4 称「NestJS 社区已有成熟的 Zod Pipe 实现」;todo P3-12 记「暂不迁移」。

**核实**:**方向正确且更有说服力,但技术前提已过时——NestJS 12 已官方支持 Standard Schema。** **NestJS v12.0.0 已发布**,核心变更之一是 first-class Standard Schema 支持:`@Body()`/`@Query()`/`@Param()`/`@RawBody()` 接受新的 `schema` 选项,直接吃 Zod schema,配合官方 `StandardSchemaValidationPipe`(`@Body({ schema: createUserSchema })` + `app.useGlobalPipes(new StandardSchemaValidationPipe())`);同一 schema **同时驱动 OpenAPI**。另有 `StandardSchemaSerializerInterceptor` + `@SerializeOptions({ schema })` 做**出参**校验,`@nestjs/config` 的 `validationSchema` 也改为接受任意 Standard Schema。官方明确:**装饰器式 `class-validator` 仍完全支持,无移除计划**([NestJS v12.0.0](https://github.com/nestjs/nest/releases/tag/v12.0.0)、[InfoQ](https://www.infoq.com/news/2026/04/nestjs-12-roadmap-esm/))。Zod 侧:**Zod 4.6** 为当前版(catalog 锁 4.4.3),自带 `z.toJSONSchema()`(target 支持 draft-2020-12/07/04、openapi-3.0)([zod.dev/json-schema](https://zod.dev/json-schema))。第三方 `nestjs-zod` 仍维护并到 **5.x**([npm](https://www.npmjs.com/package/nestjs-zod)),但**在 NestJS 12 下其「填补官方空白」的核心价值已被覆盖大半**。**对本项目决策的影响**:P3-12 的迁移成本估算(100+ DTO、6 子系统)**仍成立**,但**收益侧需更新**——原评估未计入「官方 Pipe 免维护」「同一 schema 驱动 OpenAPI」「出参也能校验」三项。**结论应从「暂不迁移」改为「重新评估」**。

**建议修正**:> 「Zod 统一验证结论不变,但**不要再手写 `ZodValidationPipe`**。NestJS 12 已官方支持 Standard Schema(`@Body({ schema })` + `StandardSchemaValidationPipe`,另有出参 Serializer、config 校验),同一 schema 同时驱动 OpenAPI。`nestjs-zod` 仍有价值但已非必需。**P3-12『暂不迁移』需重开评估**:成本不变,收益侧新增三项。替代路径:新模块直接用官方 Zod 方案、旧模块保留 class-validator(官方承诺长期支持),走渐进迁移。」

### B9. `@antfu/eslint-config` 主流地位 → **成立,已迭代到 v8**

**文档写**:作为统一代码检查方案的基础预设,承担 stylistic 格式化职责(替代 Prettier)。

**核实**:**成立**。该预设仍活跃维护并已到 **v8**(catalog 锁 `8.2.0`,与当前版本线同步;生态侧观测到 6.7.3→7.x→8.x 的持续 major 迭代)。「一个 preset 同时管规则 + stylistic 格式化」的模式在 2026 年未被取代——与仓库「不用 Prettier」的决策同源。**值得记录的动向**:上游有 **Oxlint Integration Plan**([issue #767](https://github.com/antfu/eslint-config/issues/767)),说明预设生态本身也在向 oxlint 靠拢,与 B1 互相印证——「Vue SFC 支持不足」是当前唯一实质阻碍,而作者的迁移意图已存在。

**建议修正**:> 基本维持,补版本与动向:「仍是主流选择(当前 v8.x,本仓库锁 8.2.0 属最新线)。留意上游已有 Oxlint Integration Plan,若 oxc 补齐 Vue SFC 支持,该预设的迁移路径会先于社区铺好——B1 的评估触发条件可与之联动。」

### B10. TS 6.0 / Node 24 / Vite 8 / Turbo 2.9 版本基线 → **部分过时**

- **Node ≥ 24.13.0 — 成立且最佳**。Node 24(Krypton)仍为 **LTS**;Node 26 已进 Current(2026-05);Node 25 已 EOL。生产推荐 Active/Maintenance LTS,故 Node 24 正确([Node.js Releases](https://nodejs.org/en/about/previous-releases))。**无需改**。
- **TypeScript 6.0.3 — 基线仍合理,但「最新」口径失效**。TS 6.0 是最后一个 JS 代码库版本;**TS 7.0 已于 2026-07-08 发布**。全文「为 TS 7 做准备/TS 7 即将到来」应改为「TS 7 已发布,本项目处于升级窗口内」,R7 从「远期准备」升级为「近期待办」。
- **Vite 8 — 成立**。Vite 8.0 stable 于 2026-03-12 发布,核心是 **Rolldown 成为唯一统一打包器**(取代 esbuild dev + Rollup prod),生产构建提速 10–30x;当前 8.3.0。⚠️**连带影响**:`ir/01`、`ir/05` 多处「esbuild 编译」「moduleResolution: bundler(Vite/esbuild 原生理解)」需复核——Vite 8 起内部编译器是 **Oxc**;Vite 8 还新增内置 `resolve.tsconfigPaths`、`emitDecoratorMetadata` 原生支持、Devtools([Vite 8.0 is out!](https://vite.dev/blog/announcing-vite8.html))。其中 `emitDecoratorMetadata` 与 `ir/04` §2.5 的 `unplugin-swc` 思路相关(本项目后端仍走 SWC,无直接替代,但值得记录)。
- **Turbo 2.9.14 — 落后两个 minor**。已到 **2.11**(见 B4),应更新;2.10/2.11 的 `--affected` 与 `--filter` 可组合、延迟输入哈希、本地缓存淘汰对本仓库 `turbo.json` 有简化空间。Turbo 3 尚未发布。
- **ESLint 10.3 — 成立且最新线**。v10.0.0 于 2026-02-06 发布;**v9.x 已于 2026-08-06 EOL**;当前 10.11.0。v10 关键变更:**eslintrc 配置系统彻底移除**(`ESLINT_USE_FLAT_CONFIG` 不再生效、`.eslintrc.*`/`.eslintignore` 不再识别)、**配置查找改为从被 lint 文件目录向上找**(天然适配 monorepo 多配置)、JSX 引用追踪、`RuleTester` 断言选项([ESLint v10.0.0 released](https://eslint.org/blog/2026/02/eslint-v10.0.0-released/))。新查找算法正好服务本仓库「根 config + 各包向上回溯」的现状;`ir/02` §2.1「v10 将彻底移除旧格式」**已经应验**,措辞可从「将」改为「已在 v10 移除」。
- **pnpm 11+ — 成立但落后一个大版本**。11.0 于 2026-04-28 发布(要求 Node ≥22、供应链保护默认开启、`allowBuilds` 取代旧构建设置体系、`.npmrc` 仅保留 auth/registry、SQLite store);**当前已到 12.x**([pnpm 11.0](https://pnpm.io/blog/releases/11.0))。本仓库已用 `allowBuilds`(`pnpm-workspace.yaml:276`),确在 11.x 线。12 的 `globalShims`、`pnpm ci`/`clean` 在 11.x 不可用,可作未来升级理由,非阻塞。
- **Vitest 4.1.2(catalog 实际值)** — `ir/05` §7.1 示例写 `^4.0.0`,量级正确;**当前已到 5.0.1**,升级注意见 B3。

**建议修正**:> 「基线更新:**Node ≥24.13.0 保持**(24 仍 LTS,26 仅 Current);**Vite 8 保持**,但把『esbuild』措辞改为『Oxc/Rolldown』;**Turbo 2.9.14 → 2.11**;**TS 6.0.3 保持为基线**,但『TS 7 即将到来』改为『**TS 7.0 已于 2026-07 发布**』、R7 提级;**ESLint 10.3 保持**,『v10 将移除 eslintrc』改为『已在 v10 移除,v9 于 2026-08 EOL』;**pnpm 11+ 保持**,知晓 12.x 已发布;**Vitest 4.1.2 → 可考虑 5.0**,按 V5 迁移指南处理三项新默认值。」

---

## 无法核实的条目

1. **`hoisting: false` 是否真的无效**(B5)——官方权威选项表中确无 `hoisting` 键,但**无法在本机实测**(`pnpm.ps1` 被执行策略拦截)。建议在有权限环境跑 `pnpm config get hoist` 确认。
2. **`knip.md` 记的「Knip 6.29」具体版本号**——仅观测到 6.16.0 的发布记录;「6.x 活跃维护」成立,具体小版本未核实。
3. **Knip「11.6k stars/周下载 770 万」与 syncpack「月下载 360 万、使用者含 AWS/Cloudflare/DataDog/Microsoft/Vercel/WordPress」**——未逐项复核。
4. **`ir/04` §2.5 `unplugin-swc` 必要性的现状**——Vite 8 已原生支持 `emitDecoratorMetadata`,但 NestJS 走 SWC 路径,两者是否可互相替代未能确认。
5. **pnpm 12 完整破坏性变更对本仓库的逐项影响**——仅核实了 11.0,12.x 迁移影响未逐条评估。

---

## B 部分结论汇总

| # | 结论项 | 判定 | 行动 |
|---|---|---|---|
| B1 | oxlint/biome 不支持 Vue SFC | **部分过时** | oxc 已标 Partial 且 Vue 规则在落地,Biome 仍实验性。理由改「覆盖度不足」,触发条件改「oxc 矩阵 Vue 转 Full」 |
| B2 | `ignoreDeprecations: "6.0"`/TS 7 | **部分过时** | TS 7.0 已发布、该选项在 7.0 失效;R7 提级,**优先处理 `apps/server` 的 `moduleResolution: "node"`** |
| B3 | 改用 Vitest `projects` | **成立(文档已废)** | `workspace` 自 3.2 废弃;preset 用 `defineProject` + `mergeConfig`;注意 Vitest 5 的 `extends: true` |
| B4 | 不接入 Remote Cache | **成立,条件已变** | 维持;Vercel 仍全方案免费、自托管可用;Turbo 基线→2.11;修正「CI cache hit >80%」定义 |
| B5 | `catalogMode: strict` | **成立** | 保留;**但 `hoisting: false` 非法,应改 `hoist: false`**(待实测),连带修订两篇文档 |
| B6 | Changesets + git-cliff 双轨 | **已过时** | 仓库早已改单轨,`ir/06` 属漂移,需与 `mono/release.md` 对齐 |
| B7 | Knip/syncpack/taze | **三者活跃** | taze 链接→`antfu-collective/taze`;syncpack 用法已最新;量化数据加核实日期 |
| B8 | Zod 统一前后端验证 | **已过时(方向对)** | NestJS 12 已官方支持 Standard Schema,**不再手写 Pipe**;P3-12「暂不迁移」需重开评估 |
| B9 | `@antfu/eslint-config` 主流 | **成立** | v8.x,仓库锁 8.2.0 同步;留意其 Oxlint Integration Plan |
| B10 | TS 6.0/Node 24/Vite 8/Turbo 2.9 | **部分过时** | Node 24、Vite 8 保持(Vite 措辞 esbuild→Oxc);Turbo 2.9.14→**2.11**;TS 口径改「7.0 已发布」;ESLint 10.3 保持、v9 已 EOL;pnpm 已到 12.x |

**优先级**:B5(`hoisting` 非法,影响已声明的架构特性)与 B6(文档自相矛盾)是**确定性缺陷**,最先修;B2、B8 **决策时点已到**,需重新评估;B3、B4、B7、B9、B10 属**口径更新**,可批量处理。

> 篇幅说明:任务要求「A 部分完整(不遗漏文档)+ B 每条有判断与 URL 依据」,与 3000-4500 字上限存在张力。本文以内容完整性优先,约 5100 中文字。
