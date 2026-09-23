# 架构待办事项

> **本表只列未完成的项。** 2026-09-23 逐条核实了原表里所有 ✅ / ❌ 标记：确认完成的已从表中移除
> （核实方式见文末[「核实记录」](#核实记录-已移出待办)，避免再次出现「标了完成其实没做」）；
> 其中 **R1 核实后判定为已回退**，重新回到待办并升级到 P1。
> 完成项的历史留在文末「执行记录」，细节见对应 ADR / 专题文档。

**最后核实**：2026-09-23 ｜ 14 个 workspace 包 ｜ 全门禁绿（`prepush` / `lint` / `types:check` / `test` / `boundaries` / `syncpack` / `build:admin` / `build:docs`）

## 优先级总览

| 级别 | 判据 | 条目 |
|------|------|------|
| ~~P0~~ | 阻塞首次发版 | **当前为空** —— 唯一的 P1-16 已被决定推迟，见[「搁置」](#搁置-等条件成熟) |
| **P1** | 静态检查与门禁的缺口（会让「绿」变成假象） | R2 |
| **P2** | 维护性 / 体验改善 | R7 · A5 · A7 · A10 · R8 · R11 · P2-10 · **F2-a** · **F2-b** |
| **P3** | 远期 / 条件触发 | P3-12 · P3-14 · P3-15 · P3-13 · A8 · A9 · A11 · P3-17 · P3-18 · **A12** |
| **搁置** | 等条件成熟（外部依赖或已决定先不动） | R1 · P1-16 · P2-11 · P3-20 |
| **未裁决** | 2026-09-21 评审提出，**尚未决定做不做** | F1–F2 · F6–F7 · D1–D6 · D8<br><sub>F0 / F3 / F4 / F5 已完成；D7（TS 7 排期）已并入 R7</sub> |

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
| **R11** | **文档漂移清扫** | 小 | 2026-09-23 清了**两轮**，都是机械扫出来的（第一轮扫「不存在的包名」，第二轮扫「不存在的仓库路径」，扫 239 篇活文档 / 335 条路径引用）：<br>**包名轮**：① `README.md` 的结构块**整块是虚构的** —— `packages/{shared,axios,core}` 三个包**一个都不存在**，还在教人跑早已删除的 `pnpm dev:admin`；② `CONTEXT.md` 把已更名的 `@walnut/axios` 当现存包、缺 tooling 5 包与 platform 分组。两处均已校正。<br>**路径轮**（40 条命中，逐条判定后修真错的 9 条）：③ ADR 0009/0015/0016 里的 `docs/reference/*`、`docs/decisions/*`、`docs/adr/*` 全是**迁移前的老路径**（根 `docs/` 早已并入文档站）→ 改成站内相对链接；④ ADR 0015 的测试配置段写的是重组前的平铺路径（`packages/{utils,contract,client}`、`apps/api/vitest.config.ts`）→ 按 ADR 0017 后的真实位置改写，并如实补注「`__tests__/` 与同级 `*.test.ts` 两种并存」；⑤ `.claude/skills/be-gen-module/SKILL.md` 把 DB Model 常量指到 `apps/api/src/const/app/config.ts` → 实际在 `libs/const/src/app/config.ts`；⑥ `typescript.md` / `tsconfig/README.md` 的裸 `scripts/build-barrel.ts` → 补全路径；⑦ **`migration-guide/` 目录根本不存在**（归档评审 2026-09-21 就记过「4 处引用已删除的目录」）→ 清掉 `CLAUDE.md` 树与正文、`README.md` 正文里的最后 3 处，并删掉 `knip.config.ts` 里那条已经打不中任何文件的 `'**/migration-guide/**'` 豁免。<br>**判定为「合法、不动」的**：`env-encrypted/` / `env-local/`（相对 `apps/server/` 的语境写法）、`.changeset/ledger.yaml`（发版时才生成）、`.changeset/config.json`（有意删除，引用处都在说"已删除"）、裸 `scripts/`（历史叙述）、ADR 0017 里的重组前路径（那篇 ADR 讲的就是重组本身）。<br>**剩余**：`.zcode/`（gitignored，无需管）、`apps/server/.agents/docs/` 与 `apps/admin/.../AI/docs/` 待查；`CONTEXT.md` 是否**并进文档站**（归档评审建议新建 `monorepo/glossary.md` 吸收它 —— 它现在**零引用**）留给 F1 一起定。 |
| **P2-10** | **Codecov / 覆盖率报告** | 小 | PR 上自动评论覆盖率变化（免费）。现在 6 份 vitest 配置都具备 coverage 能力但未接入。<br>⚠️ 需要账号/令牌，**待你确认是否要做**。 |
| **F2-a** | **文档死链：已开校验，但 ~74 条链接指向「未编写的组件页」** | 中 | 2026-09-23 把 VitePress 的 `ignoreDeadLinks` 从 `true` 收窄成白名单（只忽略冻结语料 + `content/frontend/component/` 那份索引里指向未编写页面的链接），并修掉 9 条真错的相对路径（`release.md` 的仓库文件表 5 条层级写错、`architecture-todo.md` 2 条少了一级、`content.md` / `vendor.md` / `en-US/configuration.md` 各 1 条）。<br>**剩余欠账**：`content/frontend/component/index.md` 按功能分层列了 ~74 个组件页，但 `content/frontend/component/` 目录下**只有 index.md**。要么补写这些页、要么把索引里的链接降级成纯文本（保留规划信息但不产生死链），然后就能把白名单收掉、让索引也受校验。<br>CI 已加 `Docs build (dead-link check)` 步，所以**以后新增死链会直接红**。 |
| **F2-b** | **锚点校验 + prose 里的仓库路径引用**（调研已完成，结论见下方小节） | 小 | VitePress 内置只查「目标页是否存在」，**不查 `#fragment`**。实测全站只有 **6 条**带锚点的站内链接、其中 **2 条是坏的**（都是 `architecture-todo.md` 里我自己写的，已修 —— 全角括号会被 slugify 转成 `-`）。**现在加锚点门禁 ROI 很低**，配方已记在下方，等锚点链接变多再上。prose 里的 584 处仓库路径引用**没有现成库**可用（理由见下）。 |

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
| **A12** | **server 内部 lib 抽取（24 个候选）** | 大 | 计划已归档：[2026-07-26 内部 lib 抽取建议](../archive/2026-07-26-lib-extraction-recommendations.md) —— 从 `apps/api/src/{modules,common,decorators}` 向 `apps/server/libs/`（**内部 lib，不是 workspace 包**）抽取 13 + 7 + 4 个候选，含耦合分析与推荐顺序。<br>**归档时的两处更正**：① 它不与 ADR 0007 冲突（落点是内部 lib）；② 原稿候选包名用了前端 scope `@walnut/*`，已全部改为 `@walnut-server/*`。<br>**未执行**，也没有排期 —— 属于"深入业务代码"的重构，按 2026-09-23 的决定先不做。要做时从这里捡起。 |

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

## F2-b 调研结论：文档链接校验用什么（2026-09-23）

需求拆成三块，分别找现成工具，**结论是只有第 1 块有零成本方案**：

| 需求 | 候选 | 结论 |
|------|------|------|
| ① 站内相对/绝对链接的**目标页是否存在** | VitePress 内置 `ignoreDeadLinks` | ✅ **已启用**（见执行记录第 2 批）。零依赖、就是构建本身 |
| ② **`#fragment` 锚点**是否真实存在 | [`remark-validate-links`](https://github.com/remarkjs/remark-validate-links)（v13，离线）<br>[`lychee`](https://github.com/lycheeverse/lychee) + [`lycheeverse/lychee-action`](https://github.com/lycheeverse/lychee-action)<br>`markdown-link-check` / `linkinator` / `broken-link-checker` | 见下 |
| ③ prose 里反引号引用的**仓库路径**（约 584 处） | 无 | ❌ **没有现成库**。所有链接检查器都只认真正的链接语法，不认反引号里的纯文本。要么不查，要么自己写几十行 |

**为什么 VitePress 用不了 remark 插件**（这是选型的关键，已核实）：VitePress 的 markdown 引擎是
**markdown-it**，不是 remark/unified —— `markdown.config` 拿到的是 markdown-it 实例（本仓现在用它装
`vitepress-plugin-tabs`），所以 `remark-validate-links` **插不进构建**。若退化成 `remark-cli` 单独一步，
它又要求链接指向**真实存在的文件**，而本仓 174 条相对链接里有 ~15 条是**不带 `.md` 后缀**的（VitePress
允许、会自己补），会直接误报。⇒ **不推荐**。

**推荐（要用时直接抄）**：`lychee` 是唯一能补上锚点校验的现成工具 —— 它支持
`--offline`（不联网）、`--include-fragments`（查锚点）、`--fallback-extensions md`（补 VitePress 的扩展名省略）、
`--exclude-path`（排除冻结语料）。**CI 里用官方 action，不需要本地装二进制**，与本仓
`lint:workflows`（actionlint 没装就跳过、CI 强制）**完全同形**：

```yaml
- uses: lycheeverse/lychee-action@v2
  with:
    args: >-
      --offline --include-fragments --no-progress
      --fallback-extensions md
      --exclude-path 'apps/docs/src/zh-CN/content/archive'
      --exclude-path 'apps/docs/src/zh-CN/content/industry-research'
      'apps/docs/src/zh-CN/content/**/*.md'
```

**为什么现在没装**：全站只有 **6 条**带锚点的站内链接（纯锚点 4 + 跨文件带锚点 0），而 VitePress 内置
已经覆盖了「目标页不存在」这个大头 —— 为 6 条链接引入一个二进制 + 一个 CI 步骤，ROI 说不通。
**触发条件**：等锚点链接涨到几十条，或出现一次「锚点静默失效」的真实事故。

**顺带查出的真实错误（已修）**：`architecture-todo.md` 里两个锚点写错了。VitePress 的 slugify 会把
**全角括号变成 `-`**：`## 搁置（等条件成熟）` 生成的是 `id="搁置-等条件成熟"`，而我原来写的是
`#搁置等条件成熟`（无横杠）。已按构建产物里的真实 `id` 改正。
📌 记住这条规则：**中文标题里的 `（）` 会变成 `-`**，手写锚点必须对照构建产物的 `id`。

---

## 未裁决（2026-09-21 评审提出，尚未决定做不做）

> 来自[归档：架构 Review 与调研审计](../archive/2026-09-21-architecture-review.md)。原文说这些是**新增项**，
> 但一直没进过本表。**先别急着做** —— 建议在 P0/P1 清完之后再逐条裁决。
> 裁决结果要么变成上面的 P0–P3 条目，要么写进 ADR（「已否决」也要留痕）。

| # | 议题 | 一句话 |
|---|------|--------|
| **F1** | 根文档单一化 | `CLAUDE.md` → `AGENTS.md` 的符号链接（Windows 无权限时退化为 include 说明），消灭双份漂移。现状：**两份独立文件**。 |
| **F2** | 补文档门禁（原 4 道 → **已做 2 道**，剩 2 道待定） | — | ① `verify-md-links`（失效链接）→ ✅ **已由 VitePress 内置完成**（执行记录第 2 批）。<br>② `verify-doc-refs`（引用不存在的包名/路径）→ ✅ **已实现并接进门禁**：`@walnut/scripts` 新增 bin `walnut-check-doc-refs`（根脚本 `pnpm lint:docs-refs`），进 `prepush`（八段）、`ci.yml`、发版电池；15 个单测含「豁免清单不许腐化」的守卫。设计口径与全部判据写在 `packages/tooling/scripts/src/ci/check-doc-refs.ts` 的模块注释里（为什么不用现成库见下方 F2-b 小节）。<br>③ `doc-typecheck`（fenced `ts` 块必须编译）：本仓文档里的 ts 块多为片段，成本可能高于收益 —— **待你定**。<br>④ `gen-package-catalog`（从 `package.json` 生成包清单）：手写清单散在 README / AGENTS / CLAUDE / `monorepo/index.md` / `turbo.md` 至少 5 处（本轮已修其中 2 处）。**注意** `verify-doc-refs` 已能挡住「引用了不存在的包」，剩下的是「包清单漏了新包」—— 值不值得再上一道，**待你定**。 |
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
| 2026-09-23 | **清旧账第 7 批（把「幽灵引用」做成门禁）**：`@walnut/scripts` 新增门禁 bin **`walnut-check-doc-refs`**（根脚本 `pnpm lint:docs-refs`），把前两轮靠一次性脚本手工扫出来的东西**制度化** —— 校验活文档正文里的 ① `@walnut/*` 包名 ② 仓库路径引用是否真实存在。<br>**判据刻意「宁可漏报不可误报」**（门禁一旦有噪声就会被无视，等于没做）：包名只认 `@walnut/<段>`（`@walnut-server/` 是内部 lib 命名空间，不查）；路径**只在 markdown 反引号里**查、必须**以顶层目录开头**、且允许**语境解析**（仓库根 → 文档自身目录 → `apps/server/`，这样 `env-encrypted/` 这类相对 server 的写法不再误报）；**ADR 与待办文档排除在路径检查之外** —— 前者合法地引用历史路径（ADR 0017 讲的就是重组），后者的职责就是记录失效引用本身；ADR 里的 markdown 链接仍由 VitePress 内置覆盖。<br>**豁免清单每条强制写理由**，并有单测拦「清单腐化」（已存在的包名不许再留在豁免里、理由不许过短）。实测豁免收敛到 **包名 15 条 / 路径 7 条**，全仓 **0 未豁免失效引用**。<br>**接线**：`prepush`（七段 → **八段**）、`ci.yml`（新步骤 `Doc reference check`）、发版电池（新行 `docs-refs`，`steps.test.ts` 同步，电池 9 → **10 条**）。<br>**开发中被单测抓出的自身缺陷**（都已修）：占位符 `apps/admin/.../AI/docs/` 被当成路径；`pathResolves` 把 `path.join` 的**反斜杠**透给调用方（Windows 上断言假失败）—— 现已统一为「仓库相对正斜杠」契约；以及两处我自己写错的路径层级断言。<br>验证：`@walnut/scripts` 81 用例全绿、`pnpm lint:docs-refs` exit 0、release 195 用例全绿、`pnpm prepush` 八段全绿、actionlint exit 0 |
| 2026-09-23 | **清旧账第 6 批（路径版漂移扫描）**：把上一轮「不存在的包名」扫描扩成「不存在的仓库路径」扫描（239 篇活文档 / 335 条反引号路径引用 → 40 条命中），逐条判定后修真错 **9 类**：<br>① ADR 0009 / 0015 / 0016 里的 `docs/reference/*`、`docs/decisions/*`、`docs/adr/*` 全是**迁移前的老路径**（根 `docs/` 早已并入文档站）→ 改成站内相对链接；② ADR 0015 的测试配置段与示例树写的是**重组前布局**（`packages/{utils,contract,client}`、`apps/api/vitest.config.ts`）→ 按真实位置改写，并如实补注「`__tests__/` 与同级 `*.test.ts` 两种并存」；③ `.claude/skills/be-gen-module/SKILL.md` 把 DB Model 常量指到 `apps/api/src/const/app/config.ts` → 实际在 `apps/server/libs/const/src/app/config.ts`；④ `typescript.md` / `tsconfig/README.md` 的裸 `scripts/build-barrel.ts` → 补全路径；⑤ **`migration-guide/` 目录根本不存在**（归档评审 2026-09-21 就记过「4 处引用已删除的目录」，本轮清掉最后 3 处文字 + 1 条死掉的 knip 豁免 `'**/migration-guide/**'`）。<br>**判定为合法不动**：`env-encrypted/` / `env-local/`（相对 `apps/server/` 的语境写法）、`.changeset/ledger.yaml`（发版时才生成）、`.changeset/config.json`（有意删除）、裸 `scripts/`（历史叙述）、ADR 0017 里的重组前路径（那篇讲的就是重组）。<br>**顺带验证**：上一轮修的 turbo 缓存输入缺陷生效了 —— 改 ADR 后 `build:docs` 这次是 **cache miss（真实重建）**，修之前会重放旧 dist 静默跳过死链校验。<br>验证：`pnpm prepush` 七段全绿、`pnpm build:docs` exit 0、零死链 |
| 2026-09-23 | **清旧账第 5 批（机械扫幽灵引用，查出一个真 bug + 两处过期入口文档）**：写了一次性脚本「枚举真实 workspace 包名 → 扫描全仓引用 → 报出引用了不存在包名的地方」，扫 1840 个文件。结论：**15 类幽灵引用**，其中真问题三个 ——<br>① **真 bug（代码）**：`packages/tooling/release/src/release/attribution.ts` 的 `SCOPE_TO_PACKAGE` 里还留着 `'tooling': '@walnut/tooling'` —— 那个包**已拆成 5 个**。后果：一条 `fix(tooling): …` 且**没动任何包目录**（例如只改根 `turbo.json`）的提交，会为一个**幽灵包**写出 `pnpm change` 意图。已改为把 `tooling` 归入 `NON_PACKAGE_SCOPES`（与基础设施 scope 同理：工具链改动**按路径**归属，路径没命中就不发版），并给日志一句专门说法（原来会误报成「未在册的 scope」）。<br>② **补测试**：该模块此前**零直接测试**。新增 `attribution.test.ts`（15 个用例，release 包 195 个用例全绿），核心是那条不变量 —— **`SCOPE_TO_PACKAGE` 的每个值都必须是真实存在的 workspace 包**（这条守卫就是能提前抓出①的那种）。<br>③ **两处过期入口文档**：`README.md` 的结构块**整块虚构**（`packages/{shared,axios,core}` 三个包一个都不存在，还在教 `pnpm dev:admin`）；`CONTEXT.md` 把 `@walnut/axios` 当现存包。都已按真实结构校正。<br>验证：release 包 `types:check` + 195 用例全绿、`pnpm prepush` 七段全绿 |
| 2026-09-23 | **清旧账第 4 批（F2-b 调研 + 修掉 3 个坏锚点 + 修一个门禁失效）**：调研「文档链接校验用什么现成工具」，结论见[上方小节](#f2-b-调研结论-文档链接校验用什么-2026-09-23)：<br>① **VitePress 是 markdown-it 不是 remark** ⇒ `remark-validate-links` 插不进构建，且它要求链接指向真实文件（本仓 ~15 条不带 `.md` 的链接会误报）；② `lychee`（`--offline --include-fragments --fallback-extensions md`）是唯一能补锚点校验的现成工具，**CI 用 `lycheeverse/lychee-action` 不需要本地装二进制**，配方已写进文档；③ 外链检查器（`markdown-link-check` / `linkinator`）会因 177 条外链常年红，不用；④ **prose 里 584 处反引号仓库路径没有现成库**。<br>**实测 ROI 后决定暂不安装**：全站只有 **6 条**带锚点的站内链接，为它引入二进制 + CI 步骤说不通。<br>**修掉 3 个真实坏锚点**（都在 `architecture-todo.md`，是我自己写的）：VitePress 的 slugify 把**全角括号与全角冒号都转成 `-`** —— `## 搁置（等条件成熟）` 的真实 `id` 是 `搁置-等条件成熟`；已按构建产物的真实 `id` 逐个改正。<br>**顺带修掉一个门禁失效**：根 `turbo.json` 的 `build` 任务把 `!**/*.md` 排除在缓存输入外 ⇒ **改文档不会让 docs 构建缓存失效**，本地 `pnpm build:docs` 会重放旧 dist、静默跳过死链校验（CI 无缓存所以不受影响，但本地会骗人）。已在 `apps/docs/turbo.json` 覆盖 `inputs` 把 `.md` 纳入。<br>验证：`pnpm build:docs` 强制真实构建 exit 0、零死链、页内锚点全部可解析 |
| 2026-09-23 | **清旧账第 3 批（F3 + F4，文档治理）**：<br>① **F3 删掉重复文档树** —— `apps/docs/{zh-CN,en-US}/` **164 个文件**全删。删前逐文件核对（不是拍脑袋）：164 个**全部**在 `apps/docs/src/` 下有同名文件（内层还多 49 个），其中 **157 个逐字节相同**，7 个有差异的都是**旧修订版**（内层 5 个更大、已重写；`support.md` / `frontend/base/vendor.md` 2 个外层更大，含已从站点移除的旧段落）；`srcDir: 'src'` 且全仓零引用 ⇒ 外层树从不参与构建。删后 `pnpm build:docs` exit 0。<br>② **F4 孤儿报告归档**（**不是**按评审说的"废除/折进 ADR 0007"）—— 核对原文后发现**评审的前提有误**：`apps/server/docs/lib-extraction-recommendations.md` 提议的落点是 `apps/server/libs/`（NestJS **内部 lib**），与 ADR 0007「后端 lib 保持内部 lib、不提升为 workspace 包」**并不冲突**；真正的问题是候选包名用了**前端** scope `@walnut/*`（会把 `609722b` 修掉的命名碰撞重新引入），以及全仓零引用。<br>因此按本仓既有归档约定（"新增过程文档直接写在 `content/archive/`"）迁到 [archive/2026-07-26-lib-extraction-recommendations.md](../archive/2026-07-26-lib-extraction-recommendations.md)：加归档横幅说明未被执行的实情 + 把 **21 处** `@walnut/<候选>` 改为 `@walnut-server/<候选>`（核验后无残留）+ 登记进 archive 索引；`apps/server/docs/` 随之清空。抽取计划本身记为 **A12**（未排期）。<br>验证：`pnpm build:docs` exit 0、零死链 |
| 2026-09-23 | **清旧账第 2 批（F2 的第一半：文档链接门禁）**：`apps/docs/.vitepress/config/index.ts` 的 `ignoreDeadLinks` 由 `true` 改为**白名单数组** —— 打开 VitePress 内置死链校验，**零新增依赖、零新增脚本**。打开后实测暴露 **86 条死链**，收窄白名单并修掉真错的 9 条后归零：<br>· 真错并已修：`monorepo/release.md` 的「关键文件」表 5 条相对路径**层级数错**（`../../../../../cliff.toml` 之类，且这些是仓库文件、不是站点页面）→ 统一改 GitHub 链接；`monorepo/architecture-todo.md` 2 条 `./industry-research/…` 少了一级 → `../industry-research/…`；`content.md` 的 `./vue/introduction.md` → `./content/frontend/introduction.md`；`frontend/base/vendor.md` 的 `../components/vendor.md` → `../component/index.md`；`en-US/guide/configuration.md` 的 `../content/monorepo/env-management.md` → 根绝对路径。<br>· 白名单只留两类并各写理由：冻结语料（`archive/`、`industry-research/`）+ `content/frontend/component/index.md` 里指向**尚未编写**的 ~74 个组件页的链接（记为 F2-a）。<br>· `ci.yml` quality job 新增 `Docs build (dead-link check)` 步 —— 以后新增死链直接红。<br>验证：`pnpm build:docs` exit 0（0 死链）、actionlint exit 0 |
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
- [行业调研 - CI/CD](../industry-research/03-ci-cd-pipeline.md) ｜ [行业调研 - 测试](../industry-research/04-testing-strategy.md)
