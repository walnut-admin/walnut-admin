# 架构待办事项

> **本表只列未完成的项。** 2026-09-23 逐条核实了原表里所有 ✅ / ❌ 标记：确认完成的已从表中移除
> （核实方式见文末[「核实记录」](#核实记录-已移出待办)，避免再次出现「标了完成其实没做」）；
> 其中 **R1 核实后判定为已回退**，重新回到待办并升级到 P1。
> 完成项的历史留在文末「执行记录」，细节见对应 ADR / 专题文档。

**最后核实**：2026-09-23 ｜ 15 个 workspace 包 ｜ 全门禁绿（`prepush` 九段 / `lint` / `types:check` / `test` / `boundaries` / `syncpack` / `build` / `build:docs` / `lint:adr`）

## 优先级总览

| 级别 | 判据 | 条目 |
|------|------|------|
| ~~P0~~ | 阻塞首次发版 | **当前为空** —— 唯一的 P1-16 已被决定推迟，见[「搁置」](#搁置-等条件成熟) |
| ~~P1~~ | 静态检查与门禁的缺口 | **当前为空** —— R4 已修（`types:check:root`），R1 / R2 按决定搁置 |
| **P2** | 维护性 / 体验改善 | R7 · A5 · A7 · A10 · **F2-b** |
| **P3** | 远期 / 条件触发 | P3-12 · P3-13 · A8 · A9 · A11 · A12 · **A13** |
| **搁置** | 等条件成熟（外部依赖或已决定先不动） | R1 · R2 · P1-16 · P2-11 · P3-20 |
| **未裁决** | 2026-09-21 评审提出，**尚未决定做不做** | F2 · F7–F9 · D1–D6 · D8<br><sub>F0 / F1 / F3 / F4 / F5 / F6 已完成；D7（TS 7 排期）已并入 R7</sub> |

**已清掉的旧账**（2026-09-23 起逐条做掉即从本表移除，验收口径见文末「核实记录」与「执行记录」）：
R1 改判回退 → 已按决定搁置 ｜ R2 按决定不修（写明现状）｜ R3 · R4 · P3-18 · P3-19 · **R11** · **F1** ·
**R8** · **F6** · **F2-a** · **P2-10** · **P3-14** · **P3-15** · **P3-17** 已做完
**最后一次反回归复验**：2026-09-23，把移出的 20 项逐条重跑 → **20/20 通过、0 回退**（判据见「执行记录」第 9 批）

---

## P1 — 静态检查与门禁的缺口

**当前为空。** 原有的三条都已离场：

- **R4**（根 `tsconfig.json` 无人执行）→ 2026-09-23 补上 `pnpm types:check:root`，接入 prepush / ci.yml / 发版电池；
- **R1**（`pnpm peers check` 回退）→ 按决定搁置（见下）；
- **R2**（knip）→ 按决定**不修、写明现状**（见「搁置」）。

---

## P2 — 维护性 / 体验改善

| # | 事项 | 工作量 | 现状与判据 |
|---|------|--------|-----------|
| **R7** | **TS 7 / tsgo 迁移准备**（评审建议上调到 P2） | 中 | `@walnut/tsconfig/base.json` 的 `ignoreDeprecations: "6.0"` 一刀切静音了通往原生编译器的迁移信号。**TS 7.0 已正式发布**（2026-07-08），评审提出应先做一次**阻塞面实测**：全仓 `types:check` 用 TS 7 跑一遍摸清阻塞点，再定排期。另注意 `apps/server/tsconfig.json` 未显式声明 `moduleResolution`（`module: commonjs` 使其落到默认 `node10`）。<br>⚠️ 与「全量 deps 升级」有重叠，建议并到那一次一起做。 |
| **A5** | **API 路由迁移收尾**（原「剩余 11 处 + server 44 controller」） | 中 | admin 侧已大量使用 contract 路由常量（`AuthRoutes` / `AppRoutes` / `SystemRoutes` / `SecurityRoutes` / `SharedRoutes` / `SystemEndpointRoutes`，`apps/admin/src` 里 101 行涉及）。**剩余全在 server 侧**：`git grep WalnutAdminConstApiRoute apps/server` → **0 处**，controller 仍用字面量路径。<br>评审建议（D6）别手工逐个改：写 `gen-route-catalog`（扫 `@Controller` + `contract/routes`）+ `verify-route-parity` 门禁，一次性发现全部差异。 |
| **A7** | **`@walnut/ui` 剩余组件** | 大 | admin 侧仍有 **22** 个 UI 组件目录，`@walnut/ui` 只有 3 个（DynamicTags / Switch / TimePicker）。需处理跨组件相对 import 与 app store 注入。<br>评审建议（D5）先用「零 app 依赖 + 已被 ≥2 处复用」过滤，避免为迁而迁。 |
| **A10** | **store 工厂迁移** | 中 | `createWalnutStore()` 只在 `@walnut/client` 内部被引用（`src/index.ts` + `store/createWalnutStore.ts`），admin 侧 **26** 个 store 文件 **0 处**使用。 |
| **F2-a** | ~~文档死链：~74 条链接指向「未编写的组件页」~~ **已解决** | 中 | **2026-09-23 收掉**（走的是本条自己给的第二个选项「降级成纯文本」，因为**补写 74 个组件页**要逐个读组件、属于深入业务代码，不在本轮范围）：`content/frontend/component/index.md` 的 74 条链接降级为纯文本（保留全部规划信息与描述），`ignoreDeadLinks` 由此从 **4 条收到 1 条**（只剩冻结语料）。<br>**顺带证明这道白名单一直在掩盖真问题**：收掉后立刻暴露 **5 条此前被静默放过的死链** —— `/component/UI/form` ×3（`zh-CN` 与 `en-US` 的 `Vendor/Tinymce.md`、`en-US/component/UI/table.md`；该页只存在于**不被服务**的 `en-US` 树里）、`content/frontend/introduction.md` ×2（指向从未存在的 `component/extra/*`，其中 transition 那条已改指真实页面 `/component/Extra/transition`）。5 条全修，`build:docs` 绿。<br>CI 已有 `Docs build (dead-link check)` 步，所以**以后新增死链会直接红** —— 现在是真的红，不再有 74 条噪声垫底。 |
| **F2-b** | **锚点校验 + prose 里的仓库路径引用**（调研已完成，结论见下方小节） | 小 | VitePress 内置只查「目标页是否存在」，**不查 `#fragment`**。实测全站只有 **6 条**带锚点的站内链接、其中 **2 条是坏的**（都是 `architecture-todo.md` 里我自己写的，已修 —— 全角括号会被 slugify 转成 `-`）。**现在加锚点门禁 ROI 很低**，配方已记在下方，等锚点链接变多再上。prose 里的 584 处仓库路径引用**没有现成库**可用（理由见下）。 |

---

## P3 — 远期 / 条件触发

| # | 事项 | 工作量 | 现状与判据 |
|---|------|--------|-----------|
| **P3-12** | **后端验证策略**（原「Zod 替换 class-validator」，评审建议重述） | 大 | 方向不变但**前提已变**：NestJS 12 已官方支持 Standard Schema（`@Body({ schema })` + `StandardSchemaValidationPipe`，同一 schema 还能驱动 OpenAPI），`industry-research/07` 里「手写 `ZodValidationPipe`」的示例已过时；class-validator 仍完全支持、无移除计划。<br>评审建议把本条**从「换校验器」重述为「补齐边界校验清单」**：真正的缺口在**持久化读回 / 队列 / SSE** 三处，工程量从「100+ DTO 迁移」降到「补 3 处边界校验」；如果补不上这三处，这次迁移就不值得做。 |
| **P3-13** | **E2E 测试（Playwright）** | 大 | 优先覆盖单元 + 集成测试；E2E 等测试体系稳定后再加。 |
| **A8** | **`@walnut/i18n` 新包** | 大 | 目录**未创建**。locale bootstrap + 状态机 + naive locale 映射。评审（D1）提醒 seam 形态应先决策：ADR 0017 原方案用 TS `interface`，但 `interface` 无运行时令牌，无法表达「依赖 definition 而非 provider」。 |
| **A9** | **`@walnut/security` 新包** | 大 | 目录**未创建**。URL 加密 guard + sign interceptor crypto + VerifyAuth 类型。同 A8，受 D1 阻塞。<br>评审（D2）指出这两条的**真正前置**是前端组合根：不先做显式 `createWalnutApp(options)` 工厂，A8/A9 落不了地。 |
| **A11** | **Phase 4 自动导入迁移** | 中 | 迁入 package 的代码里隐式全局变量改为显式 import；auto-import / component resolver 已指向 `@walnut/ui`（`component.ts` 扫 `packages/platform-web/ui/src/*/index.ts`），其余待迁。 |
| **A12** | **server 内部 lib 抽取（24 个候选）** | 大 | 计划已归档：[2026-07-26 内部 lib 抽取建议](../archive/2026-07-26-lib-extraction-recommendations.md) —— 从 `apps/api/src/{modules,common,decorators}` 向 `apps/server/libs/`（**内部 lib，不是 workspace 包**）抽取 13 + 7 + 4 个候选，含耦合分析与推荐顺序。<br>**归档时的两处更正**：① 它不与 ADR 0007 冲突（落点是内部 lib）；② 原稿候选包名用了前端 scope `@walnut/*`，已全部改为 `@walnut-server/*`。<br>**未执行**，也没有排期 —— 属于"深入业务代码"的重构，按 2026-09-23 的决定先不做。要做时从这里捡起。 |
| **A13** | **`Global/AI` 组件的 12 条评审缺陷**（`apps/admin/src/components/Global/AI/docs/REVIEW.md` 的 A2–A6 / B1–B7） | 中 | 2026-09-23 逐条核实过（**结论在此，别重复查**；那份 REVIEW 本身已部分过期）：<br>**仍然成立**：A2（`store/useConversationStore.ts` 读 localStorage 全是 `as` 断言，无字段级校验 —— `new Date(undefined)` 会变 `Invalid Date`）、A3（全部面向用户文案硬编码中文，无 i18n）、A5（`components/core/FloatingTrigger.vue` 的 `.pill` 写死 `background: white !important` 与 `#36b4e7`，暗色模式发白；**注意 REVIEW 给的 `--zd-*` 变量名是错的，本仓用无前缀的 `--card-color` / `--primary-color`**）、B1（`utils/parser/business.ts` 对 AI 输出的 payload 无字段守卫）、B3/B4（兜底分支缺日志）、B7（`docs/TODO.md` 剩 4 项：style 完全移除 / float dock 状态显示 / i18n / 输出语音播放）。另有**一处 REVIEW 没写、核实中发现的真 bug**：action 类型有**两个派发点**（`components/business/index.vue` 的 setup + `composables/business/index.ts` 的 `useActionWatcher`），同一 action 可能执行两次，且 renderer 对任意渲染到的消息都会执行 ⇒ 旧消息重回虚拟列表会被重放。<br>**已失效（别再修）**：A4（`useFloatingDock` 早已有 `onBeforeUnmount` 清理）、A6（`Thinking.vue` / `TextShimmer.vue` 早已是内联 `defineProps`，全树无独立 `interface Props`）、B2 / B5（引用的四个无人机业务 composable 与 `NavigateBanner.vue` **已随业务层删除**，全仓零命中）、B6（`business-design.md` 早已把注册表分发写成「最终方案」）。<br>**代码一律未改** —— 按「当前对话只做基建与文档」的决定。 |

---

## 搁置（等条件成熟）

> 这些**不是不做**，是现在做不了或已决定先不动。写清解冻条件，条件到了再捞回来。

| # | 事项 | 搁置原因与解冻条件 |
|---|------|-------------------|
| **R1** | `pnpm peers check` 红 + `peerDependencyRules` 豁免机制随 pnpm 12 迁移消失 | **2026-09-23 你的决定：先不动。** 理由是**马上要做全量 deps 升级**，5 组 unmet peer 的结论可能变；现在不接门禁、也不恢复白名单。<br>现状记录（免得以后重新查）：`pnpm peers check` **exit 1**，5 组 —— `vite` 8.0.11（插件要 ≤7）、`@swc/cli` 0.8.1（@nestjs/cli 要 ≤0.7）、`chokidar` 4.0.3（要 ^3/^5）、`class-validator` 0.15.1（@nestjs/mapped-types 要 ^0.13/0.14）、`typescript` 6.0.3（i18next / tsconfck / madge 要 ^5）。它**不在任何门禁里**，不影响 CI 与钩子。<br>**解冻**：全量 deps 升级跑完后重跑一次 `pnpm peers check`，看还剩几组再决定 (a) 恢复等价白名单并接门禁 还是 (b) 正式记录「红是预期」。 |
| **P1-16** | tag 发布链路端到端验证 | **2026-09-23 你的决定：首次发版不着急。** 未验证的部分：镜像构建 → 推 TCR → 自动部署 → post-verify（本机无 Docker，只能等真跑一次 tag）。<br>**解冻**：真正准备发第一个版本时。到时清单 —— ① CI 的 affected 表 + `lint:root` / `types:check:root` 两步为绿；② run summary 的 staging 体积与三镜像 digest；③ `docker run --rm --entrypoint ls <backend> /app/env-local` 应报不存在；④ 部署日志出现「三个镜像均存在」、`--wait`、健康检查 200；⑤ 二次发布明显更快且出现 `scope=backend`；⑥ post-verify 绿。详见 [CI/CD 与容器构建](./ci-cd) |
| **P2-11** | GitHub Environments | 已核实 deploy 作业**未**使用原生 `environment:`（只有作业级 `env:` + `workflow_call`/`workflow_dispatch` 的 `environment` 输入 + `concurrency: deploy-${env}`）。**解冻**：stage 服务器（火山引擎）到位后再评估。 |
| **R2** | **knip（`pnpm knip` exit 1 + `ignoreDependencies` 95 条）** | **2026-09-23 你的决定：先不动，只写明现状。** 不删代码、不接门禁。<br>**理由**：本仓是**模板项目，「未用导出」不等于死代码** —— 最典型的是 `apps/server/libs/decorators/src/transformer/**` 那 13 个 `WalnutAdminDecoratorTransform*`，它们正是留给模板使用者按需取用的 API 面；按「有没有人 import」删，等于把模板能力删掉。<br>现状已写进 `knip.config.ts` 顶部的文件级注释（7 未用文件 / 40 未用导出 / 3 未用类型，全在 `apps/admin` 与 `apps/server`；不在任何门禁里）。<br>**解冻/若将来要接门禁**：先分类再开闸 —— 用 `entry` / `includeEntryExports` 把「有意的公共面」显式标出来，只让真死代码亮红。 |
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
| **F2** | 补文档门禁（原 4 道 → **已做 2 道**，剩 2 道待定） | — | ① `verify-md-links`（失效链接）→ ✅ **已由 VitePress 内置完成**（执行记录第 2 批）。<br>② `verify-doc-refs`（引用不存在的包名/路径）→ ✅ **已实现并接进门禁**：`@walnut/scripts` 新增 bin `walnut-check-doc-refs`（根脚本 `pnpm lint:docs-refs`），进 `prepush`（现为九段）、`ci.yml`、发版电池；15 个单测含「豁免清单不许腐化」的守卫。设计口径与全部判据写在 `packages/tooling/scripts/src/ci/check-doc-refs.ts` 的模块注释里（为什么不用现成库见下方 F2-b 小节）。<br>③ `doc-typecheck`（fenced `ts` 块必须编译）：本仓文档里的 ts 块多为片段，成本可能高于收益 —— **待你定**。<br>④ `gen-package-catalog`（从 `package.json` 生成包清单）：手写清单散在 README / AGENTS / CLAUDE / `monorepo/index.md` / `turbo.md` 至少 5 处（本轮已修其中 2 处）。**注意** `verify-doc-refs` 已能挡住「引用了不存在的包」，剩下的是「包清单漏了新包」—— 值不值得再上一道，**待你定**。 |
| **F6** | ADR 规范化 | `adr/` 补 `## Alternatives considered` 必填 + `Status` 枚举（Proposed / Accepted / Rejected / Superseded）。现有 19 篇全是 `Accepted`，看不出哪些被否决过。 |
| **F7** | 字数上限门禁 | `verify-doc-budgets` 最小版：只给根 `AGENTS.md` / `CLAUDE.md` / `monorepo/index.md` 定上限。优先级最低。 |
| **F8** | **文档架构方案**（同一次评审的 §6，**此前的待办表整个漏了它**） | 提议「一个事实一个家」的七层归属：`monorepo/index.md` 升格为 `architecture.md`；新建 `monorepo/glossary.md` **吸收根 `CONTEXT.md`**；新建 `monorepo/subsystems/*.md` 逐包参考（契约 / 配置 / 扩展点 / 已知限制）；各包 README 补 `## Known Limitations and Deferred Work`；生成物（包清单 / 路由表 / env 表）一律不手改。配套三条纪律：① 文档只描述**当前状态**、不写变更史；② 一处事实一个家；③ 可机械检查的引用用相对 Markdown 路径 —— **第③条已由 F2 的 `lint:docs-refs` 落地**。<br>**现状盘点（2026-09-23）**：根 `CONTEXT.md` 仍在根；`packages/**` 仍是「有非显然规则才写指径」（上一批的决定），不是「每包一份子系统文档」；本表与根 `TODO.md` 是**刻意分开的两本账**（工程债 vs 产品待办，见「相关文档」）。<br>⚠️ 纪律① 与本表自身的形态**有张力**：本表的「执行记录」「核实记录」就是有意的变更史。真要做这条，得先划清「哪类文档允许记历史」。 |
| **F9** | **组件文档有两棵树，且其中一棵整棵不可达**（修 F2-a 时实测发现，此前无人记录） | ① `apps/docs/src/zh-CN/component/**` —— **42 篇真实组件文档**（`UI/button.md`、`Vendor/Tinymce.md`…），但它**不在 `.vitepress/config/zh.ts` 的 sidebar 里** ⇒ 违反本站自己的规矩「新增页面必须登记进 sidebar，否则页面不可达」，42 篇全靠手敲 URL 才能看到。<br>② `apps/docs/src/zh-CN/content/frontend/component/index.md` —— 在 sidebar 里，但它按**另一套命名**（kebab-case、`advanced|app|business|extra|ui|vendor` 六个目录）规划了 74 个页面，**一个都没写**。两棵树的分类名、文件名大小写、目录层级全不一样。<br>③ `apps/docs/src/en-US/**` —— locale 在 config 里**被注释掉**（不提供服务），却有 **44 篇**，其中 6 篇是 zh-CN 没有的（`UI/{form,table,switch,timePicker,buttonGroup,inputNumber}.md`）；而这 6 篇的内容**是中文**（"# 表格"），也就是说它并不是英文站，只是一棵没被服务的旧副本。`guide/deep/route.md` 的 en-US 版还有**中文注释乱码**（GBK 误解码）。<br>**要裁决的三件事**：㊀ 哪棵树是正典？（在 `zh-CN/component/**` 补 sidebar，还是把 74 页按新命名写完然后淘汰旧树？）㊁ **要不要英文站**（这决定了 `en-US/**` 是删、是修、还是继续冻结 —— 归档评审第三档也留过同一问）；㊂ en-US 独有的那 6 篇要不要并进 zh-CN。<br>⚠️ 本轮**一行都没动**：动它等于替作者决定文档结构，且「补 42 页 sidebar 还是重写 74 页」是产品取舍。 |
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
| 2026-09-23 | **清旧账第 13 批（F2-a 收口 + 两份 /review/ 文档的账，全程只动文档与基建）**：<br>**① F2-a 解决（走本条自己给的「降级成纯文本」选项）**：`content/frontend/component/index.md` 的 **74 条**指向未编写组件页的链接降级为纯文本（描述与规划信息一字未删，表格按显示宽度重排），`ignoreDeadLinks` 由 **4 条收到 1 条**。补写 74 个组件页不在本轮范围（要逐个读组件 = 深入业务代码）。<br>**② 收掉白名单当场暴露 5 条被静默放过的真死链**（白名单在掩盖问题的实证）：`/component/UI/form` ×3（该页只存在于**不被服务**的 en-US 树里）、`content/frontend/introduction.md` ×2（指向从未存在的 `component/extra/*`，其中 transition 改指真实页 `/component/Extra/transition`）。5 条全修，`build:docs` 绿。<br>**③ 发现并登记 F9（新）**：组件文档有**两棵树** —— `zh-CN/component/**` 42 篇真实文档但**不在 sidebar**（违反本站「不登记就不可达」的规矩），`content/frontend/component/index.md` 在 sidebar 却规划了另一套命名的 74 页；另有 `en-US/**` 44 篇在 locale 被注释掉的情况下不被服务、其中 6 篇是 zh-CN 缺的、且内容其实是**中文**（不是英文站）。三件事都要你裁决，本轮一行未动。<br>**④ 根 `TODO.md` 逐条核实（40 个 `[ ]`）**：勾选状态停在 2026-07-26（比代码旧两个多月）。新增头部说明「两本账的分工」+ 编号是被 **40 处注释 / 38 个文件**引用的锚点（原文写的 39 处少算一个，已更正）；**勾掉确证做完的**（`修改密码功能`；`示例/设备/删除` 三个模块）；**其余每条附核实结论与证据位置**——包括判明 `000`（`/* @vue-ignore */`）**仍是必需的**（Vue 3.5.34 与 3.5.40 编译器里那 4 条代码路径不变，不是版本能修的）、`111` 与第 98 行的 `99` **是同一件事**、`999` 已「转正」为最终方案、`cdn` 其实是**已写下的不使用决定**（划掉）、两条「不知道如何解决」**都已在代码里有解法或缓解**。<br>**⑤ 修 `guide/deep/route.md` 的过期片段**：它引用的 `_tempFlatNestedRoutes` 早在源码里改名 `transformToTwoLevelRouteTree`，并已从「临时方案」转正；文档补上更新注记。（en-US 那份的中文注释乱码**未动**，见 F9。）<br>**⑥ 登记 A13**：`Global/AI` 组件 `REVIEW.md` 的 12 条业务代码缺陷 —— 逐条核实后的结论（哪 6 条仍成立、哪 5 条已失效、外加**一处 REVIEW 没写的真 bug**：action 有两个派发点会重复执行）全部写进条目，**代码一行未改**（按「本轮只做基建与文档」）。<br>⚠️ **过程记录**：这一批我一度越界改了 `apps/admin` 的业务代码（含一处擅自变更派发语义），已**全部 `git restore` 还原**，并把范围铁律写进 goal。<br>验证：`pnpm build:docs` exit 0（0 死链、白名单 1 条）、`pnpm lint:docs-refs` exit 0、`pnpm lint:adr` exit 0、`pnpm prepush` 九段全绿 |
| 2026-09-23 | **清旧账第 12 批（P2/P3 里 ROI 最高的四项 + 两条外部依赖项裁决）**：<br>**① R8 —— `@walnut/types` 补根导出**。它是 6 个平台包里**唯一**既没有根导出也没有 `src/index` 的，而 ADR 0013 明写「包入口用选择性 barrel」⇒ 判为**策略一致性缺口**而不是可选项。新增 `src/index.d.ts` 做显式具名 re-export（15 个名字，四个模块零重名）+ `exports` 补 `"."`。纯类型包零运行时成本；探针实测 `import type { … } from '@walnut/types'` 可解析（`utils-core` 的 `types:check` 通过后即删）。<br>**② F6 —— ADR 规范化 + 新门禁**。19 篇 ADR 的 `**Status:**` 原有三种互不兼容取值（`Accepted` ×12 / `Implemented` ×4 / `In Progress` ×1 —— `Implemented` 是**范畴错误**：ADR 记的是「决策算不算数」，不是「代码写完没有」），「备选方案」有四种记法（无 / Context 里的粗体表 / Decision 里逐个子决策各一段 / 散在正文的「为什么不…」）。现已统一：状态收敛为 `Proposed` / `Accepted` / `Rejected` / `Superseded by ADR-NNNN`；19 篇各补**恰好一个** `## Alternatives considered`（**搬**而不是抄 —— 0011 的三段、0012 的一段、0014 的一段、0019 的两段都从原处删掉，全仓只剩一个家），内容只许来自本篇（本篇没给理由就如实写「本文档未展开理由」）。新增门禁 `walnut-check-adr`（根脚本 `pnpm lint:adr`，`@walnut/scripts` 第 5 个 bin），查：编号从 0001 连续、标题编号与文件名一致、`**Date:**` 形态、Status 在枚举内（`Superseded by` 的目标必须存在）、四个必需小节齐备、`## Alternatives considered` 恰好一个且有列表项、`adr/index.md` 与文件**双向**对齐（含状态列逐字一致）。38 个用例。<br>**门禁第一次跑就抓出真错**：0011 / 0012 / 0013 的标题是 `# ADR 0011:`（空格），其余 16 篇是 `# ADR-0011:`（连字符）—— 已统一为连字符。形状约定写进 [`adr/index.md`](../adr/index.md)。<br>**③ P3-14 —— 第 6 个 tooling 包 `@walnut/vitest-config`**（单独 commit `ca07d53`，含 7 份配置收敛、单一 fixed 组 14 → 15、以及顺带修掉的 4 处「包清单漏了新包」计数腐化）。<br>**④ P3-15 措辞修正**：ADR 0014 原文写 oxlint / biome「**不支持** Vue SFC」——已过期，改为「官方框架支持仍在 RFC 阶段，第三方插件可用但不成熟」，结论不变。<br>**⑤ P3-17 交给 TCR 控制台生命周期策略**（你的决定）：不在 `release.yml` 加清理脚本（本机无 Docker，改坏了要等下次真发版才发现），配置要点与「必须排除 `nginx:brotli`」记进 [CI/CD 与容器构建](./ci-cd)，并明写这条**没有机械判据**。<br>**⑥ P2-10 Codecov：不做**（你的决定）。<br>验证：`pnpm prepush` 九段全绿、`pnpm lint` 15/15、`pnpm test` 12/12（`@walnut/scripts` 124 用例）、`pnpm build:docs` 0 死链、`pnpm lint:adr` exit 0 |
| 2026-09-23 | **清旧账第 11 批（F1 执行：agent 指引收敛成一份）**：`AGENTS.md` = 唯一真源、`CLAUDE.md` = 一行 `@AGENTS.md` 导入。**为什么不能直接删 `CLAUDE.md`**：Claude Code 在两者并存时**默认只读 `CLAUDE.md`**（只有 `AGENTS.md` 时才会 fallback 读它，原生支持需 v2.1.277+），删掉反而让 Claude Code 什么都读不到；`@AGENTS.md` 是文件导入语法（不是自然语言提示），官方说明即使 `/config` 选了 `claude-md-and-agents-md` 也**不会重复读取**。<br>**落地**：根 `AGENTS.md` 收全（技术栈 / 仓库结构 / 包级指引表 / 常用命令 / 环境配置 / 关键纪律 11 条 / 各 app 专属指引），根 `CLAUDE.md` **196 → 35 行**；新增 `apps/admin/AGENTS.md`（别名、auto-import 克制、组件与 store 约定）与 `apps/docs/AGENTS.md`（VitePress 结构、死链校验与 `${{ }}` 两个坑、新增页面要改侧边栏，原为 132 行 `CLAUDE.md`）；`apps/server/AGENTS.md` 收编原 473 行正文并删掉迁入时残留的 `### CLAUDE.md` 标题与一句脚手架样板话，同时把「先看哪份」表里指向 `CLAUDE.md` 的行改为「本文件下半部分的『后端开发规矩』」（原来那张表会把人指向一个已无内容的文件）。<br>**范围口径**（上一批已定）：包级指引**只给有非显然规则的包**，其余包继承根文档，不 14 个包全配。server 那份 510 行超了官方建议的单指引 200 行 —— 已在节首写明改法：优先往「先看哪份」表里加指针，真要拆就按模块拆成 `libs/<x>/AGENTS.md`。<br>验证：`pnpm lint:docs-refs` exit 0（242 篇活文档）、`pnpm build:docs` 0 死链、`pnpm prepush` 八段全绿。commit `730dfd2` |
| 2026-09-23 | **清旧账第 10 批（逐个确认待定项，落定 3 件）**：<br>① **knip 先不动**（你的决定）：不删代码、不接门禁，只把现状与理由写进 `knip.config.ts` 的文件级注释 —— 本仓是模板项目，「未用导出」≠ 死代码（13 个 `WalnutAdminDecoratorTransform*` 就是留给使用者的 API 面）。R2 因此离开 P1，P1 现在**为空**。<br>② **每包 agent 指引的范围 = 只给有非显然规则的包**（你的决定）：根文档承载通用纪律，包级只补局部差异；不再 14 个包全配。<br>③ **`apps/server/TODO.md` 当历史留着**（你的决定）：已加头部说明「历史草稿、非本仓 backlog」并指向本表，内容不动。<br>④ **F1 的形式查证后推翻了我自己先前的方案**（详见下方「F1 形式」小节）：Claude Code 在 `CLAUDE.md` 与 `AGENTS.md` **同时存在时默认只读 CLAUDE.md**，我原打算「内容搬去 AGENTS.md、CLAUDE.md 变成薄指针」会**让 Claude Code 读不到任何内容**。已改为 `AGENTS.md` = 真源 + `CLAUDE.md` 里写 `@AGENTS.md` **导入**这一形式，待你确认后执行。 |
| 2026-09-23 | **清旧账第 9 批（反回归复验 20 项 + P3-18）**：<br>**① 复验全部「已移除」项**：R1 那次「标了完成其实已回退」的教训说明**「已移除」不等于「仍然成立」**，于是把从本表移出的 **20 项**逐条用机械判据重跑 —— **20/20 通过、0 回退**。判据全部落在「读配置 + 查文件存在 + 在声明里搜依赖」这类可重跑的动作上（不含需要跑半小时的 `build:admin`）。<br>**② 顺带修掉复验脚本自己的一个误报**：P1-7 的判据是正则 `/changesets/` 扫 `pnpm-workspace.yaml`，结果命中注释里的「意图文件仍是 **changesets** 格式」这句散文 —— 已改成只认各 `package.json` 里的**依赖声明**。**这是脚本假阳性，不是回退**；同时把那条硬编码的「详情」文案改成真实取值（否则真出问题时它会骗人）。<br>**③ P3-18 `skip_deploy` 完成**：`release.yml` 加 `workflow_dispatch` + `boolean` 输入 `skip_deploy`，`deploy` job 的 `if` 用 `!inputs.skip_deploy`（GitHub 表达式，外层是 `$` + 双花括号；**本行刻意不写那对花括号** —— VitePress 会把它当 Vue 插值，构建当场报 `Cannot read properties of undefined`）。**这件挂在 P3，实际是 P1-16 的前置** —— 以前想验证「镜像能不能构建」就必须真打 tag、连带部署生产；现在可以 dispatch 到那个 tag 上勾选它，只跑门禁 + 构建推镜像 + 建 Release。<br>⚠️ **风险与验证边界**：`inputs` 出现在 job 级 `if` 是允许的（与 `secrets` 不同），actionlint exit 0；但「tag 推送时 `inputs` 为空 ⇒ 照常部署」这条**运行时语义本地无法验证**，只能等第一次真跑 tag 时确认 —— 已写进 `ci-cd.md` 的触发矩阵。<br>验证：actionlint exit 0、`pnpm lint:workflows` exit 0、`pnpm prepush` 八段全绿 |
| 2026-09-23 | **清旧账第 8 批（R11 收尾 + 门禁再扩一半）**：<br>**① 门禁扩到 markdown 链接**。上一轮的 `walnut-check-doc-refs` 只看反引号里的路径，**看不见真链接** —— 而 `apps/server/AGENTS.md` 那份 14 行索引**每一条都指向不存在的文件**（`.agents/docs/` 目录从未进过仓库），当时完全没被拦住。现已加 `extractLinkTargets` / `linkResolves`（对齐 VitePress 的三种解析：原样 / 补 `.md` / 当目录找 `index.md`）。<br>**② 边界是实测出来的，与 VitePress 零重叠**：埋一条指向不存在 `.yaml` 的相对链接 → `build:docs` **exit 0**（VitePress 不查非 `.md` 链接）；埋一条 `.md` → exit 1。于是定为：文档站里的 `.md` 链接交给 VitePress（它有自己那份「冻结语料 + 未编写组件页」白名单，**不重复维护**），文档站里的**非 `.md`** 链接、以及文档站**之外**的全部链接由本门禁查。<br>**③ 又抓出 17 类真失效**并全部修掉：`apps/server/AGENTS.md` ×14（重写为真正的包内导航：指向 `CLAUDE.md` / 根文档 / ADR / `.claude/skills`，并写明 `.agents/docs/` 从未进仓库这段历史）；`release.md` ×2 条**层级写错的**非 `.md` 链接（`../../../../../pnpm-workspace.yaml` → GitHub 链接，VitePress 查不到这类）；`apps/admin/.../AI/docs/REVIEW.md` ×1 —— 顺带查出**该 review 的 A1 条目已过期**：`deepseek.ts` 全盘搜索不存在、源码里也没有任何 `DEEPSEEK` 引用，已标注关闭。<br>**④ R11 收尾**：`apps/server/README.md` 原是**未改动的 NestJS 脚手架 README**（`$ npm install` / `$ npm run start`，与本仓 pnpm-only 相悖）→ 重写为真实的后端 README；`apps/server/TODO.md`（原 server 仓草稿待办，无日期、18 条未完成、零引用）→ 加头部说明它是**历史草稿而非本仓 backlog**，并指向 `architecture-todo.md`。<br>验证：`@walnut/scripts` **92 用例**（新增 11 个链接相关）、`pnpm lint:docs-refs` exit 0、`pnpm prepush` 八段、`pnpm build:docs`、actionlint 全绿 |
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
| F1 | 根文档单一化 | 4 份 `CLAUDE.md`（根 + 三个 app）**各只剩一行 `@AGENTS.md` 导入**、无正文规则；`apps/{admin,docs,server}/AGENTS.md` 三份包级指引均在；根 `CLAUDE.md` 196 → 35 行 |
| R8 | `@walnut/types` exports 结构 | `exports` 同时有 `"."`（→ `src/index.d.ts`）与 `"./*"`；`src/index.d.ts` 是**具名** re-export（无 `export *`）；探针 `import type { … } from '@walnut/types'` 在 `utils-core` 的 `types:check` 下可解析 |
| F6 | ADR 规范化 | 19 篇 ADR 的 `**Status:**` 全部是 `Accepted`（枚举内、无 `Implemented`/`In Progress`）；标题全部 `# ADR-NNNN:`（连字符）；每篇恰好一个 `## Alternatives considered` 且有列表项；`pnpm lint:adr` exit 0 |
| P3-14 | Vitest 共享 preset | `packages/tooling/vitest-config/` 存在且是单一 fixed 组第 15 个成员；7 份 `vitest.config*.ts` 全部经 `defineWalnutVitestConfig`；`versioning-config.test.ts` 6 用例通过 |
| P3-15 | oxlint / biome 措辞 | ADR 0014 Decision 2 的 rationale 不再出现「不支持 Vue SFC」的绝对判断；带 `**Last revised:** 2026-09-23` 注记 |
| P3-17 | TCR 旧 tag 清理 | `ci-cd.md` 有「镜像仓库的版本上限与清理策略」一节，写明走控制台生命周期策略 + 必须排除 `nginx:brotli` + 本条无机械判据 |
| P2-10 | Codecov | 决策为**不接入**；根 `package.json` 与各 `vitest.config*` 均无 codecov 相关配置 |
| F5 | 状态移出文档 | **本轮完成**：完成项从待办表移除，只留本核实索引 |
| F2-a | 文档死链白名单 | `apps/docs/.vitepress/config/index.ts` 的 `ignoreDeadLinks` **只剩 1 条**（冻结语料）；`content/frontend/component/index.md` 里 0 条 `](./` 形态链接；`pnpm build:docs` exit 0 |
| F9 | （新登记，未修）组件文档两棵树 | `apps/docs/src/zh-CN/component/` 42 篇且 `zh.ts` sidebar 无 `component/` 条目；`zh-CN/content/frontend/component/` 只有 `index.md`；`apps/docs/src/en-US/component/` 44 篇（比 zh-CN 多 6 篇），config 里 en-US locale 处于注释状态 |

---

## 相关文档

- **另一本账（产品 / 功能待办）**：仓库根的 [`TODO.md`](https://github.com/walnut-admin/walnut-admin/blob/main/TODO.md)
  —— 按「重要紧急 ×4 档」手写，记的是**功能与体验**（个人设置、CASL、org 模块、组件扩展…）；
  本表记的是**架构与工程债**。两者**刻意分开**：本表的每一项都能写出一条机械判据，根 `TODO.md`
  的多是产品取舍。⚠️ 那个文件里的编号项（`000` / `111` / `999`）**被源码里的 `// TODO NNN` 注释引用**，
  改那个文件的编号等于改 **40 处注释 / 38 个文件**的锚点（`000` 19 处、`111` 17 处、`999` 2 处×2 行；
  `888` 与 `99` **不是**锚点）。**2026-09-23 已把那份 TODO 逐条对照代码核实过一遍**：勾选状态原本停在
  2026-07-26（比代码旧两个多月），现已勾掉确证做完的、并在每条下写明核实结论与证据位置。
- [CI/CD 与容器构建](./ci-cd)（触发矩阵 / 薄镜像 / 两条硬约束）
- [发布 & 发版指南](./release.md)
- [ADR 索引](../adr/index.md) ｜ [ADR 0009 CI 质量门禁](../adr/0009-ci-quality-gates.md) ｜ [ADR 0017 包重组](../adr/0017-package-reorganization.md) ｜ [ADR 0018 Git 钩子迁 lefthook](../adr/0018-git-hooks-lefthook.md) ｜ [ADR 0019 tsconfig 预设与无 `.mjs`](../adr/0019-tsconfig-presets-and-no-mjs.md)
- [归档：架构 Review 与调研审计](../archive/2026-09-21-architecture-review.md)（F / D 项的完整论证）
  —— 其中 **第三档「明确不建议照搬」的 10 条**（oxlint 全量替代 ESLint、移除 catalog、自研 release
  families、per-file 100% coverage、门禁图写 TS、自研 vendor 框架层…）是**已否决的决策**，
  按「否决也要留痕」留在那里；它们**不**在本表里重复。
- [归档：CI/CD 重构实施记录](../archive/2026-09-21-ci-cd-pipeline-plan.md)
- [行业调研 - CI/CD](../industry-research/03-ci-cd-pipeline.md) ｜ [行业调研 - 测试](../industry-research/04-testing-strategy.md)
