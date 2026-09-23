# 架构待办事项

> **本表只列未完成的项。** 2026-09-23 逐条核实了原表里所有 ✅ / ❌ 标记：确认完成的已从表中移除
> （核实方式见文末[「核实记录」](#核实记录已移出待办)，避免再次出现「标了完成其实没做」）；
> 其中 **R1 核实后判定为已回退**，重新回到待办并升级到 P1。
> 完成项的历史留在文末「执行记录」，细节见对应 ADR / 专题文档。

**最后核实**：2026-09-23 ｜ 14 个 workspace 包 ｜ 全门禁绿（`prepush` / `lint` / `types:check` / `test` / `boundaries` / `syncpack` / `build:admin` / `build:docs`）

## 优先级总览

| 级别 | 判据 | 条目 |
|------|------|------|
| **P0** | 阻塞首次发版 | P1-16 |
| **P1** | 静态检查与门禁的缺口（会让「绿」变成假象） | R1 · R4 · R2 |
| **P2** | 维护性 / 体验改善 | R7 · A5 · A7 · A10 · R3 · R8 · R11 · P3-19 · P2-10 · P2-11 |
| **P3** | 远期 / 条件触发 | P3-12 · P3-14 · P3-15 · P3-13 · A8 · A9 · A11 · P3-17 · P3-18 · P3-20 |
| **未裁决** | 2026-09-21 评审提出，**尚未决定做不做**（先看 P0/P1） | F1–F4 · F6–F7 · D1–D6 · D8<br><sub>F0 / F5 已完成；D7（TS 7 排期）已并入 R7</sub> |

---

## P0 — 阻塞首次发版

| # | 事项 | 工作量 | 现状与判据 |
|---|------|--------|-----------|
| **P1-16** | **tag 发布链路端到端验证** | 小 | ❗**一次都没跑过**。质量门禁在 GitHub 实测绿过（CI #3/#4，2m28s），但「构建镜像 → 推 TCR → 自动部署」从未执行（本机无 Docker，Dockerfile / bake 无法本地验证）。且 2026-09-23 又给 `ci.yml` 加了一步 `pnpm lint:root`（根级配置不在 turbo 的 affected 图里），**连质量门禁也需要在新提交上重跑一次**才算验证。<br>清单：① CI 的 affected Summary 表 + 新增的 lint:root 步为绿；② run summary 的 staging 体积与三镜像 digest；③ `docker run --rm --entrypoint ls <backend> /app/env-local` 应报不存在；④ 部署日志出现「三个镜像均存在」、`--wait`、健康检查 200；⑤ 二次发布（Re-run all jobs）明显更快且出现 `scope=backend` / `scope=frontend`；⑥ 新增的 **post-verify** 步骤绿（脚本已用假 docker/curl 覆盖 10 个场景，但没在真实服务器上跑过）。<br>详见 [CI/CD 与容器构建](./ci-cd) |

---

## P1 — 静态检查与门禁的缺口

| # | 事项 | 工作量 | 现状与判据 |
|---|------|--------|-----------|
| **R1** | **`pnpm peers check` 已经红了**（原「✅ 已完成」，本轮改判） | 中 | ⚠️ **回退项**。原记录称「`peerDependencyRules.allowedVersions` 豁免 5 项 → 零告警」，但该段配置已随 2026-09-21 的 pnpm 12 迁移**整段删除**，检查现在 **exit 1**、报 5 组 unmet peer：`vite` 8.0.11（vite-plugin-restart / devtools-json 要 ≤7）、`@swc/cli` 0.8.1（@nestjs/cli 要 ≤0.7）、`chokidar` 4.0.3（要 ^3 / ^5）、`class-validator` 0.15.1（@nestjs/mapped-types 要 ^0.13/0.14）、`typescript` 6.0.3（i18next / tsconfck / madge 要 ^5）。<br>这 5 项都是「本仓显式选用新版本、上游 peer 未跟进」，本身可接受 —— 问题是它现在**没人看的红**。二选一：**(a)** 找 pnpm 12 的等价机制恢复白名单并接进门禁；**(b)** 明确「红是预期」，在 `pnpm-workspace.yaml` 写清楚并把它排除出门禁。 |
| **R4** | **根 `tsconfig.json` 无人执行** | 小 | 根 tsconfig（`include: ["*.ts"]`，extends `@walnut/tsconfig/base.json`）覆盖 `eslint.config.ts` / `commitlint.config.ts` / `knip.config.ts`，但**没有任何脚本跑它**（`types:check` 只跑包任务，`lint:root` 只 lint）。即这三个根配置的类型错误当前无门禁覆盖。<br>建议加 `types:check:root: tsc -p tsconfig.json` 并入 `prepush` 与 `ci.yml`。注意根配置走 `base.json`（无 `erasableSyntaxOnly`），加之前先确认它在 `ts.json` 之外自洽。 |
| **R2** | **knip 集中豁免 95 条** | 中 | `knip.config.ts` 的 `ignoreDependencies` 已 **95 条**（本轮核实），集中豁免会掩盖真实死依赖。建议按包拆豁免、周期性清理（2026-08-08 清过一轮）。<br>另：整仓 `pnpm knip` 当前 **exit 1**，命中的全是 **app 代码既有项**（7 未用文件 / 40 未用导出 / 3 导出类型），且不在任何门禁里 —— 要么修完接进门禁，要么在文档里明确它「只作参考、不设门禁」。 |

---

## P2 — 维护性 / 体验改善

| # | 事项 | 工作量 | 现状与判据 |
|---|------|--------|-----------|
| **R7** | **TS 7 / tsgo 迁移准备**（评审建议上调到 P2） | 中 | `@walnut/tsconfig/base.json` 的 `ignoreDeprecations: "6.0"` 一刀切静音了通往原生编译器的迁移信号。**TS 7.0 已正式发布**（2026-07-08），评审提出应先做一次**阻塞面实测**：全仓 `types:check` 用 TS 7 跑一遍摸清阻塞点，再定排期。另注意 `apps/server/tsconfig.json` 未显式声明 `moduleResolution`（`module: commonjs` 使其落到默认 `node10`）。 |
| **A5** | **API 路由迁移收尾**（原「剩余 11 处 + server 44 controller」） | 中 | admin 侧已大量使用 contract 路由常量（`AuthRoutes` / `AppRoutes` / `SystemRoutes` / `SecurityRoutes` / `SharedRoutes` / `SystemEndpointRoutes`，`apps/admin/src` 里 101 行涉及）。**剩余全在 server 侧**：`git grep WalnutAdminConstApiRoute apps/server` → **0 处**，controller 仍用字面量路径。<br>评审建议（D6）别手工逐个改：写 `gen-route-catalog`（扫 `@Controller` + `contract/routes`）+ `verify-route-parity` 门禁，一次性发现全部差异。 |
| **A7** | **`@walnut/ui` 剩余组件** | 大 | admin 侧仍有 **22** 个 UI 组件目录，`@walnut/ui` 只有 3 个（DynamicTags / Switch / TimePicker）。需处理跨组件相对 import 与 app store 注入。<br>评审建议（D5）先用「零 app 依赖 + 已被 ≥2 处复用」过滤，避免为迁而迁。 |
| **A10** | **store 工厂迁移** | 中 | `createWalnutStore()` 只在 `@walnut/client` 内部被引用（`src/index.ts` + `store/createWalnutStore.ts`），admin 侧 **26** 个 store 文件 **0 处**使用。 |
| **R3** | **root eslint 换 base preset** | 小 | 根 `eslint.config.ts` 现在是 `import vueConfig from '@walnut/eslint-config/vue'`，但根级 glob 只有 `*.ts *.json *.yaml`（无 `.vue`），用 base preset 更贴切、更快。 |
| **R8** | **`@walnut/types` exports 结构** | 小 | 该包 `exports` 只有 `{ "./*": "./src/*.d.ts" }`，**无根 `"."`、无 `types` 字段**，消费方必须写 `@walnut/types/xxx`。评估是否补根导出。 |
| **R11** | **文档漂移清扫** | 小 | 本轮又修掉几处：`apps/docs/CLAUDE.md`（`preinstall` / `only-allow` 已不存在）、`apps/server/CLAUDE.md`（pnpm 11 → 12、preinstall）、`deploy.yml` 注释（setup-env 不再用 tsx）、`.gitignore` 的死规则 `report/*`。剩余 `.claude/`、`.zcode/` 等入口文档待查。 |
| **P3-19** | **turbo build「no output files」警告** | 小 | `@walnut/{client,http,types,ui}` 的 `build` 是 `echo`、无产物，但根 `turbo.json` 的 `build` 任务声明了 `outputs` → 每次刷 4 条警告。四个包都已有自己的 workspace `turbo.json`，加 `"build": { "outputs": [] }` 即可（或移除它们的 build 任务）。 |
| **P2-10** | **Codecov / 覆盖率报告** | 小 | PR 上自动评论覆盖率变化（免费）。现在 6 份 vitest 配置都具备 coverage 能力但未接入。 |
| **P2-11** | **GitHub Environments** | 中 | 已核实 deploy 作业**未**使用原生 `environment:`（只有作业级 `env:` 变量 + `workflow_call`/`workflow_dispatch` 的 `environment` 输入 + `concurrency: deploy-${env}`）。stage 服务器（火山引擎）到位后再评估。 |

---

## P3 — 远期 / 条件触发

| # | 事项 | 工作量 | 现状与判据 |
|---|------|--------|-----------|
| **P3-12** | **后端验证策略**（原「Zod 替换 class-validator」，评审建议重述） | 大 | 方向不变但**前提已变**：NestJS 12 已官方支持 Standard Schema（`@Body({ schema })` + `StandardSchemaValidationPipe`，同一 schema 还能驱动 OpenAPI），`industry-research/07` 里「手写 `ZodValidationPipe`」的示例已过时；class-validator 仍完全支持、无移除计划。<br>评审建议把本条**从「换校验器」重述为「补齐边界校验清单」**：真正的缺口在**持久化读回 / 队列 / SSE** 三处，工程量从「100+ DTO 迁移」降到「补 3 处边界校验」；如果补不上这三处，这次迁移就不值得做。 |
| **P3-14** | **Vitest 共享 preset** | 中 | 规模已跨过阈值：**6 份** vitest 配置（`apps/server/apps/api`、`contract`、`utils-core`、`client`、`scripts`、`release`）。评审提醒技术基线要更新为 Vitest 的 **`projects` 配置**（不是旧的 workspace 配置）。 |
| **P3-15** | **oxlint / biome** | 小 | 结论保留（暂不作为主 linter），措辞修正：不是「都不支持 Vue SFC」，而是**官方框架支持仍在 RFC 阶段，第三方插件（`oxlint-vue` 等）可用但不成熟**。 |
| **P3-13** | **E2E 测试（Playwright）** | 大 | 优先覆盖单元 + 集成测试；E2E 等测试体系稳定后再加。 |
| **A8** | **`@walnut/i18n` 新包** | 大 | 目录**未创建**。locale bootstrap + 状态机 + naive locale 映射。评审（D1）提醒 seam 形态应先决策：ADR 0017 原方案用 TS `interface`，但 `interface` 无运行时令牌，无法表达「依赖 definition 而非 provider」。 |
| **A9** | **`@walnut/security` 新包** | 大 | 目录**未创建**。URL 加密 guard + sign interceptor crypto + VerifyAuth 类型。同 A8，受 D1 阻塞。<br>评审（D2）指出这两条的**真正前置**是前端组合根：不先做显式 `createWalnutApp(options)` 工厂，A8/A9 落不了地。 |
| **A11** | **Phase 4 自动导入迁移** | 中 | 迁入 package 的代码里隐式全局变量改为显式 import；auto-import / component resolver 已指向 `@walnut/ui`（`component.ts` 扫 `packages/platform-web/ui/src/*/index.ts`），其余待迁。 |
| **P3-18** | **`skip_deploy` 开关** | 小 | 给 `release.yml` 加 `workflow_dispatch` + `skip_deploy` 输入（约 5 行），用于「只想验证镜像构建、不碰生产」。现状：有 `workflow_dispatch`，**无** `skip_deploy`。 |
| **P3-17** | **TCR 旧 tag 清理** | 小 | 腾讯云 TCR 个人版单镜像上限 100 版本，每次发布推 `vX.Y.Z` + `nginx:brotli`，长期会顶到上限。可在 `release.yml` 加清理步骤（保留最近 N 个），或交给 TCR 控制台的生命周期策略。 |
| **P3-20** | **国内 self-hosted runner（决策门）** | 中 | **门控在 P0（P1-16）的实测数据**：仅当「tag 发布总时长 > 20 min 且跨境推送占大头」时再评估。runner 在美国、镜像仓库在腾讯云上海，跨境上传是旧流水线 78 分钟的主要嫌疑之一；腾讯云轻量服务器约 ¥30–60/月。**先看数据再决定。** |

---

## 未裁决（2026-09-21 评审提出，尚未决定做不做）

> 来自[归档：架构 Review 与调研审计](../archive/2026-09-21-architecture-review.md)。原文说这些是**新增项**，
> 但一直没进过本表。**先别急着做** —— 建议在 P0/P1 清完之后再逐条裁决。
> 裁决结果要么变成上面的 P0–P3 条目，要么写进 ADR（「已否决」也要留痕）。

| # | 议题 | 一句话 |
|---|------|--------|
| **F1** | 根文档单一化 | `CLAUDE.md` → `AGENTS.md` 的符号链接（Windows 无权限时退化为 include 说明），消灭双份漂移。现状：**两份独立文件**。 |
| **F2** | 补 4 道文档门禁 | `verify-md-links`（失效链接/锚点）、`verify-doc-refs`（拒绝引用已不存在的路径）、`doc-typecheck`（fenced `ts` 块必须编译）、`gen-package-catalog`（从 `package.json` 生成包清单）。现状：**四者皆无**。 |
| **F3** | 重复文档处置 | `apps/docs/{zh-CN,en-US}/` 下现有 **164** 个文件（归档评审认定为不被渲染的重复文档，2026-09-21 时是 156 个）：删除或明确用途。 |
| **F4** | 孤儿报告裁决 | `apps/server/docs/lib-extraction-recommendations.md` **仍存在**：要么废除，要么把结论折进 ADR 0007（并把其中的 `@walnut/*` 改为 `@walnut-server/*`）。 |
| **F6** | ADR 规范化 | `adr/` 补 `## Alternatives considered` 必填 + `Status` 枚举（Proposed / Accepted / Rejected / Superseded）。现有 19 篇全是 `Accepted`，看不出哪些被否决过。 |
| **F7** | 字数上限门禁 | `verify-doc-budgets` 最小版：只给根 `AGENTS.md` / `CLAUDE.md` / `monorepo/index.md` 定上限。优先级最低。 |
| **D1** | `@walnut/i18n` / `@walnut/security` 的 seam 形态 | (a) TS `interface`；(b) abstract class + 独立 provider 包。**倾向 (b)**（`interface` 无运行时令牌）。 |
| **D2** | 前端组合根 | (a) 维持隐式全局；(b) 显式 `createWalnutApp(options)`；(c) 轻量 DI 容器。**倾向 (b)**；(a) 会让 A8/A9 无法落地。 |
| **D3** | 源码面 / 产物面分离 | (a) 维持 ADR 0002 双模 `exports` + 补一道「dist 过期」检测；(b) 让消费者显式声明所在面。**倾向先 (a) + 检测**。 |
| **D4** | admin 内部分层是否入门禁 | 建议先只加最贵的一条：**API 层不得 import store**。 |
| **D5** | `@walnut/ui` 迁移范围 | (a) 按 ADR 0017 迁 22 个；(b) 只迁「零 app 依赖 + 已被 ≥2 处复用」。**倾向 (b)**（与 A7 合并裁决）。 |
| **D6** | A5 的 server 侧迁移方式 | (a) 手工逐个改；(b) `gen-route-catalog` + `verify-route-parity`。**倾向 (b)**（与 A5 合并裁决）。 |
| **D8** | 后端验证策略 | (a) 维持 class-validator；(b) 新模块用 Standard Schema、存量不动；(c) 全量迁移。**倾向先 (b)**（与 P3-12 合并裁决）。 |

---

## 执行记录

> 追加式历史。**只有本表记录「做过什么」**，上面的待办表只回答「还剩什么」。

| 日期 | 完成项 |
|------|--------|
| 2026-09-23 | **待办表核实与瘦身**（本轮）：逐条核实原 P0-P3 / A1-A11 / R1-R11 的 ✅ 标记 → 18 项确认完成并移出、**1 项（R1）判定回退后重开**；剩余项按 P0-P3 重排，新增「未裁决」段收纳 2026-09-21 评审的 F/D 项（即评审建议 **F5「状态移出文档」** 的落地）；新增 `tsx` 全局移除后的文档同步（ADR-0019 / AGENTS.md / CLAUDE.md / package-scripts.md / pnpm-workspace-config.md），catalog 243 → 242 |
| 2026-09-23 | **仓内彻底移除 `tsx`**：`apps/admin` 的 `predev` / `types:check:log` 改由 `node` 原生类型剥离执行（相对导入补 `.ts` 扩展名、JSON 导入补 `with { type: 'json' }`），devDependency 与 catalog 条目删除；顺带修掉 `.gitignore` 的死规则 `report/*`（带斜杠锚定到仓库根，实际产物在 `apps/admin/report/`）。详见 commit `3daafc0` |
| 2026-09-23 | **工具链拆包 + tsconfig 预设提取 + 全仓去 `.mjs`**：`packages/tooling/` 1 → **5 包**；提取 `@walnut/tsconfig`（base / ts / vue）并删根 `tsconfig.base.json`；16 个 `.mjs` → `.ts`（含 249 行装饰器排序插件补类型）；根 devDeps 18 → 19；`prepush` 五段 → 六段。**完整决策与代价见 [ADR 0019](../adr/0019-tsconfig-presets-and-no-mjs.md)**，commit `2190873` |
| 2026-09-23 | **发版与 Git 钩子迁移**：`@changesets/cli` → **pnpm 12 原生 release management**（`versioning` 段为唯一真源、`.changeset/ledger.yaml` 为台账）；changelog 改 git-cliff 逐包渲染；钩子 `simple-git-hooks` → **lefthook**（ADR 0018）。详见 [发布 & 发版指南](./release.md) 与 commit `4e16d7d` |
| 2026-09-23 | **CI/CD 与容器构建重构**：修复 `ci.yml` 的非法表达式（`steps.if` 用 `secrets` 上下文 → `Invalid workflow file`，CI 自 2026-08-13 起五周从未运行）；拆流水线（commit 只跑质量门禁、tag 才构建镜像、`deploy.yml` 改可复用纯部署）；修 buildx 缓存 scope 冲突（单次上线实测 85 min → 正常）；镜像改「薄运行时」并剔除 `pnpm deploy --prod` 拷进产物的 `env-local` 明文密钥；新增 actionlint 闸门。详见 [CI/CD 与容器构建](./ci-cd) |
| 2026-09-23 | **部署后验证（post-verify）**：新增 `deploy/post-verify.sh`（轮询 2 分钟检查三容器 running / 镜像 tag 一致 / 后端日志无致命错误 / 前端与入口 nginx 无 5xx / 公网端到端 200）；`deploy/nginx/Dockerfile` 把 nginx 日志软链到 stdout/stderr；新增 `deploy/post-verify.test.sh` 用假 docker/curl 覆盖 10 个场景 |
| 2026-09-23 | **文档整理**：根 `docs/` 目录移除；CI/CD 设计重写为长期文档 [CI/CD 与容器构建](./ci-cd)；6 份过程文档迁入 `content/archive/` 并加归档横幅 |
| 2026-08-08 | **共享包测试 + peers + AGENTS**：`@walnut/utils` 5 个测试文件、`@walnut/contract` 12 组契约快照测试 + vitest 配置；`peerDependencyRules.allowedVersions` 豁免 5 项 peers 错位（**该机制已于 2026-09-21 随 pnpm 12 迁移删除 → 见 R1**）；根 `AGENTS.md` 重写为分发式导航文档 |
| 2026-08-08 | **文档配套 + 优化池**：A4 表格补勾；P1-4 Remote Cache 标记不接入；P3-14 理由更新；新增「架构优化池」R1-R11；修复 turbo `preview` 任务缺失；release.md / index.md / eslint.md / turbo.md / env-management.md / server+docs 的 CLAUDE.md 同步 |
| 2026-08-08 | **架构 review 第三批**：`@walnut/client` 的 vue/pinia 移入 peerDependencies；DOM lib 下沉到 admin/docs/platform-web；server `strict: true`（保留 `strictPropertyInitialization: false`）；清理 6 处残留空导入 `import { } from '@walnut/contract'`；`build:stage` 升级为独立 turbo 任务（废除三重 `--` 透传）；lint-staged 删除无效的 `*.md` 条目 |
| 2026-08-08 | **架构 review 第二批**：turbo `dev`/`test` 接入 `dependsOn: ["^build"]`（修 fresh clone 下 `dev:server` 的 MODULE_NOT_FOUND）；`turbo boundaries` 接入 pre-push 与 CI；CI workflow 落地（P0-1）；根 `clean:all` glob 修复；`@walnut/eslint-config` 补 lint 脚本；`apps/*` 补 `private: true`；边界验证实测（临时加 `app` 标签 → 正确报 3 处 shared→app 违规） |
| 2026-08-08 | **架构 review 修复批**：修复 production/stage 缺失 `USER_ID_ENCRYPTION_KEY` / `USER_ID_HASH_SALT`（生产启动失败 bug）；根 `pnpm test` 可用（server vitest 配置路径、I18nService 依赖、`--passWithNoTests`、client jsdom）；knip 假门禁修复（`packages/*` → `./packages/*/*`，此前静默空操作）+ 清死依赖；server 的 jest/ts-jest/ts-node 残留清理；根 scripts `NODE_OPTIONS=` 改 cross-env |
| 2026-08-08 | **PWA 移除**：删 vite-plugin-pwa + workbox-window + @vite-pwa/assets-generator 及全部相关代码。原因：workbox-build 传递链问题多（lru-cache CJS 崩溃、高危漏洞、precaching 陈旧内容），后台场景价值有限 |
| 2026-08-08 | **构建与 dev 验证**：P0-3 解决（env 解密流程 + lru-cache override + optimizeDeps 过滤）；修复 tsbuildinfo 掩盖的 6 处既有类型错误（Table / ApiSelect / CountryCallingSelect）；`pnpm build:admin` 成功；dev 前端（3100）+ 后端（3000，连 MongoDB/Redis）启动验证通过 |
| 2026-08-08 | **ADR 0017 收尾批次**：A1 旧目录清理；A2 包 `walnut` 标签补齐；A3 boundaries 升级为 platform 维度 + 修 10 处 `~build/package` 失效 import；A4 client 移除 vue-router 死依赖；A5 admin 硬编码路由 → contract；A6 server 移除 `@walnut/utils` 死依赖；A7 `@walnut/ui` POC（3 组件）。lint 9/9 + types:check 9/9 + boundaries 零违规 |
| 2026-08-08 | 文档同步：commitlint（P1-6）实际已完成；新增 ADR 0017 遗留收尾线（A1-A11） |
| 2026-07-30 | syncpack（P2-9）— 依赖版本一致性检测接入 |
| 2026-07-29 | P0 剩余 3 项未完成（CI/CD 流水线、共享包测试、前端构建修复 —— 后均已完成） |

---

## 核实记录（已移出待办）

> 2026-09-23 逐条复核。**只留一行索引**：记录「当初的验收口径」，便于日后发现回退时对照。

| 原编号 | 事项 | 核实方式与结果 |
|--------|------|----------------|
| P0-1 | CI/CD 流水线 | `.github/workflows/{ci,workflow-lint}.yml` 均在；`ci.yml` 无 `if: … secrets.*`、含 `TURBO_SCM_BASE/HEAD` 与 `Affected set sanity check` 步；`prepush` 含 `lint:workflows`；actionlint v1.7.7 全 workflow 通过 |
| P0-2 | 共享包测试 | `@walnut/utils` 5 个 `*.test.ts`（queue / regex / transformer / persistent×2）；`@walnut/contract/src/index.test.ts` + `vitest.config.ts`；`pnpm test` 12 包全绿（utils 29 例 / contract 12 例 / scripts 66 / release 180） |
| P0-3 | 前端构建修复 | `pnpm-workspace.yaml` 已**无 `overrides:` 段**（`lru-cache` 只剩 catalog 条目，非 override）；`pnpm build:admin` → ✓ built in 1m49s |
| P1-4 | Turbo Remote Cache | 决策为**不接入**；`globalPassThroughEnv` 保留 `TURBO_TOKEN` / `TURBO_TEAM`；无 remoteCache 配置 |
| P1-5 | 部署流水线 | `deploy.yml` 是 `workflow_call` + `workflow_dispatch` 的纯部署；`docker-bake.hcl` 每镜像独立 cache scope；backend Dockerfile 含 env-local 剔除 |
| P1-6 | commitlint | 根 `commitlint.config.ts` + `@walnut/commitlint-config` + lefthook `commit-msg`；本轮两次提交均被其真实校验放行 |
| P1-7 | Changeset Bot | 全仓无 `@changesets/*` 依赖声明、lockfile 无残留、`.changeset/config.json` 已删（目录只剩 `README.md`） |
| P2-8 | Docker 多阶段 → 薄镜像 | 三个 Dockerfile 均**无** `pnpm install` / `pnpm deploy`（只 COPY runner 侧产物） |
| P2-9 | syncpack | `pnpm syncpack:lint` → exit 0「No issues found」 |
| A1 | 旧目录残留清理 | `packages/{axios,client,contract,eslint-config,utils}` 均**不存在** |
| A2 | `walnut` 标签补齐 | `packages/` 下 **11** 个包的 `package.json` 全部带 `walnut` 字段 |
| A3 | turbo boundaries 升级 | 根 `turbo.json` 的 `boundaries.tags` 含 `platform-any` / `platform-node` |
| A4 | `@walnut/client` vue-router 死依赖 | dependencies / devDependencies / peerDependencies 三处均无 `vue-router` |
| A6 | server 死依赖决策 | `apps/server` 无 `@walnut/utils` 声明；`git grep @walnut/utils apps/server/{apps,libs}` → 0 |
| R5 | AGENTS.md 重写 | 根 `AGENTS.md` 是分发式导航文档（含「仓库结构」「常用命令」「关键纪律」） |
| R6 | only-allow | 根 `package.json` **无 `preinstall`**；全仓无 `only-allow` |
| R9 | turbo preview 任务 | 根 `turbo.json` 的 `tasks` 含 `preview` |
| R10 | CI affected 空集行为 | `ci.yml` 含名为「Affected set sanity check」的步骤（文件变更非空但受影响包为 0 → 失败） |
| F0 | 修正 `hoisting: false` | `pnpm-workspace.yaml` 已是合法的 `hoist: false`（2026-09-21 pnpm 12 迁移完成） |
| F5 | 状态移出文档 | **本轮完成**：完成项从待办表移除，只留本核实索引 |

---

## 相关文档

- [CI/CD 与容器构建](./ci-cd)（触发矩阵 / 薄镜像 / 两条硬约束）
- [发布 & 发版指南](./release.md)
- [ADR 索引](../adr/index.md) ｜ [ADR 0009 CI 质量门禁](../adr/0009-ci-quality-gates.md) ｜ [ADR 0017 包重组](../adr/0017-package-reorganization.md) ｜ [ADR 0018 Git 钩子迁 lefthook](../adr/0018-git-hooks-lefthook.md) ｜ [ADR 0019 tsconfig 预设与无 `.mjs`](../adr/0019-tsconfig-presets-and-no-mjs.md)
- [归档：架构 Review 与调研审计](../archive/2026-09-21-architecture-review.md)（F / D 项的完整论证）
- [归档：CI/CD 重构实施记录](../archive/2026-09-21-ci-cd-pipeline-plan.md)
- [行业调研 - CI/CD](./industry-research/03-ci-cd-pipeline.md) ｜ [行业调研 - 测试](./industry-research/04-testing-strategy.md)
