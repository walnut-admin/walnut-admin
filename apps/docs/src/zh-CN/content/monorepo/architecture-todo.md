# 架构待办事项

> **本表只列未完成的项。** 2026-09-23 逐条核实了原表里所有 ✅ / ❌ 标记：确认完成的已从表中移除
> （核实方式见文末[「核实记录」](#核实记录已移出待办)，避免再次出现「标了完成其实没做」）；
> 其中 **R1 核实后判定为已回退**，重新回到待办并升级到 P1。
> 完成项的历史留在文末「执行记录」，细节见对应 ADR / 专题文档。

**最后核实**：2026-09-23 ｜ 14 个 workspace 包 ｜ 全门禁绿（`prepush` / `lint` / `types:check` / `test` / `boundaries` / `syncpack` / `build:admin` / `build:docs`）

## 优先级总览

| 级别 | 判据 | 条目 |
|------|------|------|
| ~~P0~~ | 阻塞首次发版 | **当前为空** —— 唯一的 P1-16 已被决定推迟，见[「搁置」](#搁置等条件成熟) |
| **P1** | 静态检查与门禁的缺口（会让「绿」变成假象） | R2 |
| **P2** | 维护性 / 体验改善 | R7 · A5 · A7 · A10 · R8 · R11 · P2-10 · P2-11 |
| **P3** | 远期 / 条件触发 | P3-12 · P3-14 · P3-15 · P3-13 · A8 · A9 · A11 · P3-17 · P3-18 |
| **搁置** | 等条件成熟（外部依赖或已决定先不动） | R1 · P1-16 · P2-11 · P3-20 |
| **未裁决** | 2026-09-21 评审提出，**尚未决定做不做** | F1–F4 · F6–F7 · D1–D6 · D8<br><sub>F0 / F5 已完成；D7（TS 7 排期）已并入 R7</sub> |

**已清掉的旧账**（2026-09-23 起逐条做掉即从本表移除，验收口径见文末「核实记录」与「执行记录」）：
R1 改判回退 → 已按决定搁置 ｜ R3 · R4 · P3-19 已做完

---

## P1 — 静态检查与门禁的缺口

| # | 事项 | 工作量 | 现状与判据 |
|---|------|--------|-----------|
| **R2** | **knip 集中豁免 95 条** | 中 | `knip.config.ts` 的 `ignoreDependencies` 已 **95 条**（2026-09-23 核实），集中豁免会掩盖真实死依赖。建议按包拆豁免、周期性清理（2026-08-08 清过一轮）。<br>另：整仓 `pnpm knip` 当前 **exit 1**，命中的全是 **app 代码既有项**（7 未用文件 / 40 未用导出 / 3 导出类型），且不在任何门禁里 —— 要么修完接进门禁，要么在文档里明确它「只作参考、不设门禁」。 |

> R4（根 tsconfig 无人执行）与 R1（peers 检查）已离开本档：前者 2026-09-23 补上 `pnpm types:check:root`
> 并接入 prepush / ci.yml / 发版电池；后者按决定搁置（见下）。

---

## P2 — 维护性 / 体验改善

| # | 事项 | 工作量 | 现状与判据 |
|---|------|--------|-----------|
| **R7** | **TS 7 / tsgo 迁移准备**（评审建议上调到 P2） | 中 | `@walnut/tsconfig/base.json` 的 `ignoreDeprecations: "6.0"` 一刀切静音了通往原生编译器的迁移信号。**TS 7.0 已正式发布**（2026-07-08），评审提出应先做一次**阻塞面实测**：全仓 `types:check` 用 TS 7 跑一遍摸清阻塞点，再定排期。另注意 `apps/server/tsconfig.json` 未显式声明 `moduleResolution`（`module: commonjs` 使其落到默认 `node10`）。<br>⚠️ 与「全量 deps 升级」有重叠，建议并到那一次一起做。 |
| **A5** | **API 路由迁移收尾**（原「剩余 11 处 + server 44 controller」） | 中 | admin 侧已大量使用 contract 路由常量（`AuthRoutes` / `AppRoutes` / `SystemRoutes` / `SecurityRoutes` / `SharedRoutes` / `SystemEndpointRoutes`，`apps/admin/src` 里 101 行涉及）。**剩余全在 server 侧**：`git grep WalnutAdminConstApiRoute apps/server` → **0 处**，controller 仍用字面量路径。<br>评审建议（D6）别手工逐个改：写 `gen-route-catalog`（扫 `@Controller` + `contract/routes`）+ `verify-route-parity` 门禁，一次性发现全部差异。 |
| **A7** | **`@walnut/ui` 剩余组件** | 大 | admin 侧仍有 **22** 个 UI 组件目录，`@walnut/ui` 只有 3 个（DynamicTags / Switch / TimePicker）。需处理跨组件相对 import 与 app store 注入。<br>评审建议（D5）先用「零 app 依赖 + 已被 ≥2 处复用」过滤，避免为迁而迁。 |
| **A10** | **store 工厂迁移** | 中 | `createWalnutStore()` 只在 `@walnut/client` 内部被引用（`src/index.ts` + `store/createWalnutStore.ts`），admin 侧 **26** 个 store 文件 **0 处**使用。 |
| **R8** | **`@walnut/types` exports 结构** | 小 | 该包 `exports` 只有 `{ "./*": "./src/*.d.ts" }`，**无根 `"."`、无 `types` 字段**，消费方必须写 `@walnut/types/xxx`。评估是否补根导出。 |
| **R11** | **文档漂移清扫** | 小 | 本轮又修掉几处：`apps/docs/CLAUDE.md`（`preinstall` / `only-allow` 已不存在）、`apps/server/CLAUDE.md`（pnpm 11 → 12、preinstall）、`deploy.yml` 注释（setup-env 不再用 tsx）、`.gitignore` 的死规则 `report/*`。剩余 `.claude/`、`.zcode/` 等入口文档待查。 |
| **P2-10** | **Codecov / 覆盖率报告** | 小 | PR 上自动评论覆盖率变化（免费）。现在 6 份 vitest 配置都具备 coverage 能力但未接入。<br>⚠️ 需要账号/令牌，**待你确认是否要做**。 |

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

---

## 搁置（等条件成熟）

> 这些**不是不做**，是现在做不了或已决定先不动。写清解冻条件，条件到了再捞回来。

| # | 事项 | 搁置原因与解冻条件 |
|---|------|-------------------|
| **R1** | `pnpm peers check` 红 + `peerDependencyRules` 豁免机制随 pnpm 12 迁移消失 | **2026-09-23 你的决定：先不动。** 理由是**马上要做全量 deps 升级**，5 组 unmet peer 的结论可能变；现在不接门禁、也不恢复白名单。<br>现状记录（免得以后重新查）：`pnpm peers check` **exit 1**，5 组 —— `vite` 8.0.11（插件要 ≤7）、`@swc/cli` 0.8.1（@nestjs/cli 要 ≤0.7）、`chokidar` 4.0.3（要 ^3/^5）、`class-validator` 0.15.1（@nestjs/mapped-types 要 ^0.13/0.14）、`typescript` 6.0.3（i18next / tsconfck / madge 要 ^5）。它**不在任何门禁里**，不影响 CI 与钩子。<br>**解冻**：全量 deps 升级跑完后重跑一次 `pnpm peers check`，看还剩几组再决定 (a) 恢复等价白名单并接门禁 还是 (b) 正式记录「红是预期」。 |
| **P1-16** | tag 发布链路端到端验证 | **2026-09-23 你的决定：首次发版不着急。** 未验证的部分：镜像构建 → 推 TCR → 自动部署 → post-verify（本机无 Docker，只能等真跑一次 tag）。<br>**解冻**：真正准备发第一个版本时。到时清单 —— ① CI 的 affected 表 + `lint:root` / `types:check:root` 两步为绿；② run summary 的 staging 体积与三镜像 digest；③ `docker run --rm --entrypoint ls <backend> /app/env-local` 应报不存在；④ 部署日志出现「三个镜像均存在」、`--wait`、健康检查 200；⑤ 二次发布明显更快且出现 `scope=backend`；⑥ post-verify 绿。详见 [CI/CD 与容器构建](./ci-cd) |
| **P2-11** | GitHub Environments | 已核实 deploy 作业**未**使用原生 `environment:`（只有作业级 `env:` + `workflow_call`/`workflow_dispatch` 的 `environment` 输入 + `concurrency: deploy-${env}`）。**解冻**：stage 服务器（火山引擎）到位后再评估。 |
| **P3-20** | 国内 self-hosted runner（决策门） | **解冻**：仅当 P1-16 的实测显示「tag 发布总时长 > 20 min 且跨境推送占大头」。runner 在美国、镜像仓库在腾讯云上海，跨境上传是旧流水线 78 分钟的主要嫌疑之一；腾讯云轻量服务器约 ¥30–60/月。**先看数据再决定。** |

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
| 2026-09-23 | **清旧账第 1 批**（R4 / R3 / P3-19，验收口径即核实方式）：<br>① **R4 根配置接入类型检查** —— 新增 `types:check:root: tsc -p tsconfig.json`，接入 `prepush`（六段 → **七段**）、`ci.yml`（新步骤 `Type check root configs`）与**发版电池**（新行 `types-root`，`steps.test.ts` 同步）；`eslint.config.ts` / `commitlint.config.ts` / `knip.config.ts` 此前没有任何脚本做类型检查。<br>② **R3 根 eslint 换 base 预设** —— 根 `eslint.config.ts` 由 `vue` 预设改为 `base`。核实中发现原条目描述的前提是错的：仓内只有 5 份 `eslint.config.ts`，**另外 10 个包经 ESLint 向上查找也用根配置**（它们全是 TS-only、零 `.vue`，`base` 才是它们该用的预设）。用 `eslint --print-config` 逐文件比对规则集，确认只丢掉 2 条对 TS 无效的 `unocss/*`；同时给 base 补上 `pnpm: true` 与 `pnpm/yaml-enforce-settings: off`，否则会丢 3~4 条 `pnpm/*` 规则并让 `lint:root` 直接报 `shellEmulator` mismatch。<br>③ **P3-19 turbo 产出警告** —— `@walnut/{client,http,types,ui}` 四个包的 `turbo.json` 声明 `"build": { "outputs": [] }`；根 `turbo.json` 的 `test` 任务把 `outputs` 从 `["coverage/**"]` 改为 `[]`（正常 `vitest run` 不产出任何文件，6 个有 test 脚本的包此前每次刷警告）。实测 `build --force` 与 `test --force` 的 "no output files found" 警告 **合计 10 → 0**。<br>验证：`build`（9/9，2m27s）、`test`（12/12）、`lint`（14/14）、`lint:root`、`types:check:root`、`prepush` 七段、`build:docs`、actionlint 全绿 |
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
