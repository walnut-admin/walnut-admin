# 架构待办事项

> **本表只列未完成的项。** 2026-09-23 逐条核实了原表里所有 ✅ / ❌ 标记：确认完成的已从表中移除
> （核实方式见文末[「核实记录」](/content/archive/2026-09-24-architecture-ledger-history#核实记录-已移出待办)，避免再次出现「标了完成其实没做」）；
> 其中 **`pnpm peers check` 红 核实后判定为已回退**，重新回到待办并升级到 P1。
> 完成项的历史留在[执行记录](/content/archive/2026-09-24-architecture-ledger-history#执行记录)，细节见对应 ADR / 专题文档。

**最后核实**：2026-09-23 ｜ 15 个 workspace 包 ｜ 全门禁绿（`prepush` 门禁表 14 段 / `lint` / `types:check` / `test` / `boundaries` / `syncpack` / `build` / `build:docs` / `lint:adr`）

## 优先级总览

| 级别 | 判据 | 条目 |
|------|------|------|
| ~~P0~~ | 阻塞首次发版 | **当前为空** —— 唯一的 tag 发布链路端到端验证已被决定推迟，见[「搁置」](#搁置-等条件成熟) |
| ~~P1~~ | 静态检查与门禁的缺口 | **当前为空** —— 2026-09-23 登记的三条静态检查缺口 **当天做完即移出**（见[执行记录](/content/archive/2026-09-24-architecture-ledger-history#执行记录)）；根 `tsconfig.json` 的类型检查已补上，`pnpm peers check` 与 knip 两条按决定搁置 |
| **P2** | 维护性 / 体验改善 | TS 7 迁移准备 · API 路由迁移收尾 · `@walnut/ui` 剩余组件 · store 工厂迁移 |
| **P3** | 远期 / 条件触发 | 后端验证策略（落地） · E2E 测试 · **组件文档补写** · **两处安全观察** · `@walnut/i18n` 新包 · `@walnut/security` 新包 · Phase 4 自动导入迁移 · server 内部 lib 抽取 · `Global/AI` 的评审缺陷 |
| **搁置** | 等条件成熟（外部依赖或已决定先不动） | `pnpm peers check` 红 · knip · tag 发布链路端到端验证 · GitHub Environments · 国内 self-hosted runner · **锚点校验** |
| **未裁决** | 2026-09-21 评审提出，**尚未决定做不做** | 下面表里那 7 条<br><sub>文档类建议 **全部裁决完毕**（2026-09-23 定：英文站不要；组件文档按 74 页那套新命名写 → 已转为上表的「组件文档补写」）；D7（TS 7 排期）已并入 TS 7 迁移准备。**下面表里那 6 条 / 后端验证策略（选型） 全部指向业务代码**，按「本轮只做基建与文档」的决定**只登记不动手**</sub> |

**已清掉的旧账**（2026-09-23 起逐条做掉即从本表移除，验收口径见[核实记录](/content/archive/2026-09-24-architecture-ledger-history#核实记录-已移出待办)与[执行记录](/content/archive/2026-09-24-architecture-ledger-history#执行记录)）：
`pnpm peers check` 与 knip 两条按决定搁置；其余旧账（4 个文档门禁、tags 三条不变量、根脚本形态门禁、两条本地
ESLint 规则、`@walnut/types` 根导出、ADR 规范化、字数上限门禁、文档架构方案、组件文档占位页降级、
`apps/server` 的 README / TODO 处置、`@walnut/vitest-config` 拆包、TCR 版本上限策略、server 两条构建流程抢 `dist`…）全部做完
**最后一次反回归复验**：2026-09-23，把移出的 20 项逐条重跑 → **20/20 通过、0 回退**（判据见[执行记录](/content/archive/2026-09-24-architecture-ledger-history#执行记录)里那一批）

> ### 为什么表里还有条目（读之前先看这段）
>
> **先说清一件事**：本轮的**旧账清单**确实已经清空（见上面那行「已清掉的旧账」）。
> 但 2026-09-23 做的[与参考仓 Z 的基建交叉对比](./reference-repo-comparison) **又登记了 5 条新的基建缺口**
> （当天登记的五条基建缺口）—— 它们不是"欠的债"，而是**"没有任何东西在看这一面"**，
> 是那次横向对比才看见的。**这 5 条当天全部做完并已移出本表**（见[执行记录](/content/archive/2026-09-24-architecture-ledger-history#执行记录)），
> 于是对比页里**只剩 两处安全观察 一条**（业务代码类）。
> 所以「表是空的」从来不是目标，**目标是表里每一项都能说清它现在为什么不能做**。
>
> 剩下的每一项都属于下面四类之一：
>
> | 类别 | 含义 | 谁能让它动 |
> |------|------|-----------|
> | **阻塞** | 等外部条件（全量 deps 升级、首次发版、stage 服务器…），每条都写了「解冻」条件 | 时间 / 外部环境 |
> | **业务代码类** | 要改 `apps/admin/src` 或 `apps/server/{apps,libs}` 的**实现**（含 两处安全观察 那两条安全观察）。这类按「本轮只做基建与文档」的决定**只登记不动手** —— 条目里那些**核实结论**就是留给将来那次改动的 | 先解除那条范围铁律 |
> | **未裁决** | 需要人拍板（下表的 7 条 架构选型 —— 它们全部指向业务代码） | 你 |
>
> **怎么捞回来**（2026-09-23 收尾时加的）：**阻塞**类的解冻条件都在[「搁置」](#搁置-等条件成熟)那张表里，每条都写了「条件到了怎么办」；**业务代码**类在各段自己的表里（P2 / P3），条目里的核实结论就是留给那次改动的；**需要你拍板**的在[「未裁决」](#未裁决-2026-09-21-评审提出-尚未决定做不做)。
> **本轮到此收尾**：从 2026-09-23 起逐批清理旧账 —— **旧账清空，横向对比新登记 5 条基建缺口**（上面第三类）。

---

## P1 — 静态检查与门禁的缺口

**当前为空。** 这个段位进进出出过两轮，每一轮的结论都留在[执行记录](/content/archive/2026-09-24-architecture-ledger-history#执行记录)里：

- 根 `tsconfig.json` 此前无人执行→ 2026-09-23 补上 `pnpm types:check:root`，接入 prepush / ci.yml / 发版电池；
- **`pnpm peers check` 红**（`pnpm peers check` 回退）→ 按决定搁置（见下）；
- **knip**（knip）→ 按决定**不修、写明现状**（见「搁置」）；
- 交叉对比登记的三条（turbo tags 不变量 / 根脚本形态门禁 / 两条本地 ESLint 规则）→ 2026-09-23 当天登记、当天做完：`turbo.json` 的 tags 三条不变量（并入 `lint:turbo-cache`）、根脚本形态门禁（`gate-wiring.test.ts`）、两条脚本入口 ESLint 规则（`script-rules.ts`）。**这三条都属"没有任何东西在看这一面"**，做完即移出本表。

> 判据（值得记住，下次登记新条目时照着用）：**P1 收的是"没有人看这一面"，而不是"哪里写错了"**。
> 所以它天然会被清空 —— 清空不代表没有风险，只代表已知的那些面都有人看着了。

---

## P2 — 维护性 / 体验改善

| 事项 | 工作量 | 现状与判据 |
|------|------|------|
| **TS 7 / tsgo 迁移准备**（评审建议上调到 P2） | 中 | `@walnut/tsconfig/base.json` 的 `ignoreDeprecations: "6.0"` 一刀切静音了通往原生编译器的迁移信号。**TS 7.0 已正式发布**（2026-07-08），评审提出应先做一次**阻塞面实测**：全仓 `types:check` 用 TS 7 跑一遍摸清阻塞点，再定排期。另注意 `apps/server/tsconfig.json` 未显式声明 `moduleResolution`（`module: commonjs` 使其落到默认 `node10`）。<br>⚠️ 与「全量 deps 升级」有重叠，建议并到那一次一起做。<br>**2026-09-23 补记**：`turbo` **已单独升过**（2.9.14 → 2.11.2，为拿 `cacheMaxAge` / `cacheMaxSize` / `concurrency` 三个键；顺带记一条经验：当天的 2.11.3 被本仓自己的 `minimumReleaseAge: 1440` 拦下，最后选的是已过 24h 成熟期的 2.11.2）。**全量升级时可以把它从清单里划掉**；`pnpm peers check` 那次也重跑过，仍是同样 5 组、exit 1 —— 与 turbo 无关。 |
| **API 路由迁移收尾**（原「剩余 11 处 + server 44 controller」） | 中 | admin 侧已大量使用 contract 路由常量（`AuthRoutes` / `AppRoutes` / `SystemRoutes` / `SecurityRoutes` / `SharedRoutes` / `SystemEndpointRoutes`，`apps/admin/src` 里 101 行涉及）。**剩余全在 server 侧**：`git grep WalnutAdminConstApiRoute apps/server` → **0 处**，controller 仍用字面量路径。<br>评审建议（路由迁移的 server 侧方式）别手工逐个改：写 `gen-route-catalog`（扫 `@Controller` + `contract/routes`）+ `verify-route-parity` 门禁，一次性发现全部差异。 |
| **`@walnut/ui` 剩余组件** | 大 | admin 侧仍有 **22** 个 UI 组件目录，`@walnut/ui` 只有 3 个（DynamicTags / Switch / TimePicker）。需处理跨组件相对 import 与 app store 注入。<br>评审建议（`@walnut/ui` 迁移范围）先用「零 app 依赖 + 已被 ≥2 处复用」过滤，避免为迁而迁。 |
| **store 工厂迁移** | 中 | `createWalnutStore()` 只在 `@walnut/client` 内部被引用（`src/index.ts` + `store/createWalnutStore.ts`），admin 侧 **26** 个 store 文件 **0 处**使用。 |

---

## P3 — 远期 / 条件触发

| 事项 | 工作量 | 现状与判据 |
|------|------|------|
| **后端验证策略**（原「Zod 替换 class-validator」，评审建议重述） | 大 | 方向不变但**前提已变**：NestJS 12 已官方支持 Standard Schema（`@Body({ schema })` + `StandardSchemaValidationPipe`，同一 schema 还能驱动 OpenAPI），`industry-research/07` 里「手写 `ZodValidationPipe`」的示例已过时；class-validator 仍完全支持、无移除计划。<br>评审建议把本条**从「换校验器」重述为「补齐边界校验清单」**：真正的缺口在**持久化读回 / 队列 / SSE** 三处，工程量从「100+ DTO 迁移」降到「补 3 处边界校验」；如果补不上这三处，这次迁移就不值得做。 |
| **E2E 测试（Playwright）** | 大 | 优先覆盖单元 + 集成测试；E2E 等测试体系稳定后再加。 |
| **`@walnut/i18n` 新包** | 大 | 目录**未创建**。locale bootstrap + 状态机 + naive locale 映射。评审（i18n / security 的 seam 形态）提醒 seam 形态应先决策：ADR 0017 原方案用 TS `interface`，但 `interface` 无运行时令牌，无法表达「依赖 definition 而非 provider」。 |
| **`@walnut/security` 新包** | 大 | 目录**未创建**。URL 加密 guard + sign interceptor crypto + VerifyAuth 类型。同 `@walnut/i18n` 新包，受 i18n / security 的 seam 形态 阻塞。<br>评审（前端组合根）指出这两条的**真正前置**是前端组合根：不先做显式 `createWalnutApp(options)` 工厂，`@walnut/i18n` 新包/`@walnut/security` 新包 落不了地。 |
| **Phase 4 自动导入迁移** | 中 | 迁入 package 的代码里隐式全局变量改为显式 import；auto-import / component resolver 已指向 `@walnut/ui`（`component.ts` 扫 `packages/platform-web/ui/src/*/index.ts`），其余待迁。 |
| **server 内部 lib 抽取（24 个候选）** | 大 | 计划已归档：[2026-07-26 内部 lib 抽取建议](../archive/2026-07-26-lib-extraction-recommendations.md) —— 从 `apps/api/src/{modules,common,decorators}` 向 `apps/server/libs/`（**内部 lib，不是 workspace 包**）抽取 13 + 7 + 4 个候选，含耦合分析与推荐顺序。<br>**归档时的两处更正**：① 它不与 ADR 0007 冲突（落点是内部 lib）；② 原稿候选包名用了前端 scope `@walnut/*`，已全部改为 `@walnut-server/*`。<br>**未执行**，也没有排期 —— 属于"深入业务代码"的重构，按 2026-09-23 的决定先不做。要做时从这里捡起。 |
| **按 74 页那套新命名补写组件文档** | 大 | **2026-09-23 你定的方向**：正典是 `content/frontend/component/index.md` 规划的那套（kebab-case、`advanced/` `app/` `business/` `extra/` `ui/` `vendor/` 六个目录），**旧的那棵 `zh-CN/component/**` 写完即淘汰**。<br>**现状**：那 74 条已降级为纯文本（第 13 批，为收掉死链白名单），页面一篇未写；旧树 42 篇仍在 sidebar 里可达（第 14 批补的），**在写完之前先留着**，否则组件文档就彻底没有入口了。<br>**为什么排 P3**：逐页要读组件实现（属深入业务代码），是本表里最大的内容工程。做法建议：先写 `ui/`（25 个）与 `extra/`（23 个）这两大类，它们最常被引用。<br>**完成标志**：74 页存在 → 旧树删除 → sidebar 改指新树 → `index.md` 里那些纯文本改回链接（都要过 `build:docs` 死链校验）。 |
| **两处业务代码的安全观察**（对比页 F 组，**只登记不动手**） | 小 | ① `apps/admin/src/utils/window/open.ts` 的 `openOAuthWindow`（第 24 行）调 `window.open` 时**没带 `noopener`**（同文件 `openExternalLink` 的两处都带了），被打开的 OAuth 页因此拿得到 `window.opener`。<br>⚠️ **但"照抄加上 `noopener`"是错的做法**，2026-09-23 核实过：① 该调用点在 `apps/admin/src/views/auth/src/shared/other.vue` 里**接住了返回值**（`childWindow = openOAuthWindow(res)!`），失败分支要 `childWindow?.close()` 关掉弹窗；而带 `noopener` 时 `window.open` **返回 `null`** ⇒ 弹窗再也关不掉（不崩，只是静默失效）。② 好在该流程的登录结果走的是 **SSE**（`EventSource` 订阅 `/auth/oauth/<type>/sse/…`），**不依赖 `window.opener` / `postMessage`** ⇒ 加 `noopener` 不会打断登录。**正确改法**要连"怎么关掉那个窗口"一起重新设计，属业务代码。<br>② 启用 `no-dangerous-html` 类规则会立刻命中 **4 个 `v-html`**（都在 `apps/admin/src/components/Global/AI/**`），另有 `apps/admin/src/views/auth/index.vue` 第 26 / 31 行的 **2 处 `innerHTML = ''`** —— 那两处是**清空**而不是注入，规则报不报得看它怎么定义 sink。**按本仓「一排开始误报的门禁等于没有门禁」的口径，现在不该开**（要开得先把那 4 个 `v-html` 的输入来源逐个核实成可信）。<br>**代码一律未改**（按「只做基建与文档」的范围铁律）。 |
| **`Global/AI` 组件的 12 条评审缺陷**（`apps/admin/src/components/Global/AI/docs/REVIEW.md` 的 A2–A6 / B1–B7） | 中 | 2026-09-23 逐条核实过（**结论在此，别重复查**；那份 REVIEW 本身已部分过期）：<br>**仍然成立**：A2（`store/useConversationStore.ts` 读 localStorage 全是 `as` 断言，无字段级校验 —— `new Date(undefined)` 会变 `Invalid Date`）、A3（全部面向用户文案硬编码中文，无 i18n）、API 路由迁移收尾（`components/core/FloatingTrigger.vue` 的 `.pill` 写死 `background: white !important` 与 `#36b4e7`，暗色模式发白；**注意 REVIEW 给的 `--zd-*` 变量名是错的，本仓用无前缀的 `--card-color` / `--primary-color`**）、B1（`utils/parser/business.ts` 对 AI 输出的 payload 无字段守卫）、B3/B4（兜底分支缺日志）、B7（`docs/TODO.md` 剩 4 项：style 完全移除 / float dock 状态显示 / i18n / 输出语音播放）。另有**一处 REVIEW 没写、核实中发现的真 bug**：action 类型有**两个派发点**（`components/business/index.vue` 的 setup + `composables/business/index.ts` 的 `useActionWatcher`），同一 action 可能执行两次，且 renderer 对任意渲染到的消息都会执行 ⇒ 旧消息重回虚拟列表会被重放。<br>**已失效（别再修）**：A4（`useFloatingDock` 早已有 `onBeforeUnmount` 清理）、A6（`Thinking.vue` / `TextShimmer.vue` 早已是内联 `defineProps`，全树无独立 `interface Props`）、B2 / B5（引用的四个无人机业务 composable 与 `NavigateBanner.vue` **已随业务层删除**，全仓零命中）、B6（`business-design.md` 早已把注册表分发写成「最终方案」）。<br>**引用那份 REVIEW 之前先看这行**：它**自身的文件链接全部少了一段路径**（写的是 `src/components/AI/…`，实际树是 `src/components/Global/AI/…`，共 22 处），行号也全部对不上；第二章的两张表（「业务类型注册完整性」与「业务组件规范检查」）描述的是**已经不存在**的代码库；`docs/composables.md` 的状态表里也仍列着那 4 个已删除的文件。**要引用就以本条的结论为准，别直接照抄那份文档。**<br>**代码一律未改** —— 按「当前对话只做基建与文档」的决定。 |

---

| **基建注释里的历史账** | 小（增量做） | 基建层注释总量约 3400 行，其中不少是「某天实测… / 这里曾经是…」的叙事。**已压**：`turbo.json`、`check-turbo-cache`、`check-doc-refs`、`ci.yml`、`knip.config`，并**实测抓到 5 处已经不准的断言**（3 处计数 + 1 处「只有 3 条」+ 1 处条数）。<br>**判据**（照它做，别自由发挥）：① 注释里写**规则**、不写叙事；② 判据细节指向文档站（`turbo-cache-boundary` / `architecture` / 各专题页）；③ **不写会腐烂的计数** —— 那类数字没有门禁拦得住；④ 每批自证「`git diff` 里非注释改动为 0」。**不单开批次，顺手做**。 |

## 搁置（等条件成熟）

> 🅿️ **这一节是「未落地的设计」（提案性质）**：它们说的是「**打算改成什么**」，而不是「哪里欠了债」。
> 与 P2/P3 的区别就在这儿 —— 那些是「该做但还没做」，这些是「**已经决定先不做**，在等一个外部条件」。
> 所以本节的每一行都必须写出**解冻条件**（条件到了怎么办），否则它就该回 P2/P3。
> 侧边栏有一条直接链到这里，不必从表头翻下来。

| 事项 | 搁置原因与解冻条件 |
|------|------|
| `pnpm peers check` 红 + `peerDependencyRules` 豁免机制随 pnpm 12 迁移消失 | **2026-09-23 你的决定：先不动。** 理由是**马上要做全量 deps 升级**，5 组 unmet peer 的结论可能变；现在不接门禁、也不恢复白名单。<br>现状记录（免得以后重新查）：`pnpm peers check` **exit 1**，5 组 —— `vite` 8.0.11（插件要 ≤7）、`@swc/cli` 0.8.1（@nestjs/cli 要 ≤0.7）、`chokidar` 4.0.3（要 ^3/^5）、`class-validator` 0.15.1（@nestjs/mapped-types 要 ^0.13/0.14）、`typescript` 6.0.3（i18next / tsconfck / madge 要 ^5）。它**不在任何门禁里**，不影响 CI 与钩子。<br>**解冻**：全量 deps 升级跑完后重跑一次 `pnpm peers check`，看还剩几组再决定 (a) 恢复等价白名单并接门禁 还是 (b) 正式记录「红是预期」。<br>**2026-09-23 中途核对**：那天只升了一个包（turbo 2.9.14 → 2.11.2，turbo 无 peer 依赖），重跑 `pnpm peers check` **仍是同样 5 组、exit 1** —— 说明这几组来自别的依赖，别指望靠升 turbo 顺手清掉。 |
| tag 发布链路端到端验证 | **2026-09-23 你的决定：首次发版不着急。** 未验证的部分：镜像构建 → 推 TCR → 自动部署 → post-verify（本机无 Docker，只能等真跑一次 tag）。<br>**解冻**：真正准备发第一个版本时。到时清单 —— ① CI 的 affected 表 + `lint:root` / `types:check:root` 两步为绿；② run summary 的 staging 体积与三镜像 digest；③ `docker run --rm --entrypoint ls <backend> /app/env-local` 应报不存在；④ 部署日志出现「三个镜像均存在」、`--wait`、健康检查 200；⑤ 二次发布明显更快且出现 `scope=backend`；⑥ post-verify 绿。详见 [CI/CD 与容器构建](./ci-cd) |
| GitHub Environments | 已核实 deploy 作业**未**使用原生 `environment:`（只有作业级 `env:` + `workflow_call`/`workflow_dispatch` 的 `environment` 输入 + `concurrency: deploy-${env}`）。**解冻**：stage 服务器（火山引擎）到位后再评估。 |
| 锚点（`#fragment`）校验 | **2026-09-23 实测后搁置**：VitePress 内置只查「目标页是否存在」，**不查 `#fragment`**；能补这一块的现成工具只有 `lychee`（配方见下方 [锚点校验 调研结论](/content/archive/2026-09-24-architecture-ledger-history#锚点校验-调研结论-文档链接校验用什么-2026-09-23)）。<br>**为什么现在不做**：全站带锚点的站内链接**实测 8 条**（2026-09-23 手工对着构建产物逐条核过）—— 为一个二进制 + 一个 CI 步骤换 8 条链接的校验，ROI 说不通。<br>**解冻条件**（满足任一条就捞回来）：① 带锚点的站内链接涨到**几十条**；② 出现一次**锚点静默失效**的真实事故（读者点了跳不到位置，而构建照样绿）。<br>📌 **2026-09-23 补记（这条决定已经付过一次代价了）**：那次手工核对**当场查到 1 条坏的** —— 就是本行这个指向 锚点校验 小节的自指链接（`## 锚点校验 调研结论：…` 的真实 `id` 里，**全角冒号也转成 `-`**，而链接里漏了那个横杠）；更值得记的是，第 4 批的执行记录当时写的是「页内锚点全部可解析」，**那句话从写下那天起就是错的**。也就是说这一面**没有任何东西在替我们看着**，只能靠哪次人工想起去核一遍。<br>⚠️ 另半条（prose 里几百处反引号仓库路径）**已经不做**了 —— 由 `pnpm lint:docs-refs` 覆盖，且它刻意只认「以顶层目录开头」的路径（收窄判据见该模块顶部注释）。 |
| **knip（`pnpm knip` exit 1 + `ignoreDependencies` 95 条）** | **2026-09-23 你的决定：先不动，只写明现状。** 不删代码、不接门禁。<br>**理由**：本仓是**模板项目，「未用导出」不等于死代码** —— 最典型的是 `apps/server/libs/decorators/src/transformer/**` 那 13 个 `WalnutAdminDecoratorTransform*`，它们正是留给模板使用者按需取用的 API 面；按「有没有人 import」删，等于把模板能力删掉。<br>现状已写进 `knip.config.ts` 顶部的文件级注释（7 未用文件 / 40 未用导出 / 3 未用类型，全在 `apps/admin` 与 `apps/server`；不在任何门禁里）。<br>**解冻/若将来要接门禁**：先分类再开闸 —— 用 `entry` / `includeEntryExports` 把「有意的公共面」显式标出来，只让真死代码亮红。 |
| 国内 self-hosted runner（决策门） | **解冻**：仅当 tag 发布链路端到端验证 的实测显示「tag 发布总时长 > 20 min 且跨境推送占大头」。runner 在美国、镜像仓库在腾讯云上海，跨境上传是旧流水线 78 分钟的主要嫌疑之一；腾讯云轻量服务器约 ¥30–60/月。**先看数据再决定。** |

---

## 未裁决（2026-09-21 评审提出，尚未决定做不做）

> 🅿️ **这一节同样是「未落地的设计」**，且比「搁置」更早一步：那节是**已经拍板先不做**，
> 这节是**连做不做都还没定**。每一行都写了选项与倾向，等你一句话就能落进 P2/P3 或搁置。

> 来自[归档：架构 Review 与调研审计](../archive/2026-09-21-architecture-review.md)。原文说这些是**新增项**，
> 但一直没进过本表。**先别急着做** —— 建议在 P0/P1 清完之后再逐条裁决。
> 裁决结果要么变成上面的 P0–P3 条目，要么写进 ADR（「已否决」也要留痕）。

| 议题 | 选项与倾向 |
|------|------|
| 文档类建议（F 组） | 2026-09-21 评审提的那批文档治理建议**已全部落地**（死链白名单收窄、引用/代码块/字数/ADR 四道门禁、文档架构、术语表…），逐条见[执行记录](/content/archive/2026-09-24-architecture-ledger-history#执行记录) |
| `@walnut/i18n` / `@walnut/security` 的 seam 形态 | (a) TS `interface`；(b) abstract class + 独立 provider 包。**倾向 (b)**（`interface` 无运行时令牌）。 |
| 前端组合根 | (a) 维持隐式全局；(b) 显式 `createWalnutApp(options)`；(c) 轻量 DI 容器。**倾向 (b)**；(a) 会让 `@walnut/i18n` 新包/`@walnut/security` 新包 无法落地。 |
| 源码面 / 产物面分离 | (a) 维持 ADR 0002 双模 `exports` + 补一道「dist 过期」检测；(b) 让消费者显式声明所在面。**倾向先 (a) + 检测**。 |
| admin 内部分层是否入门禁 | 建议先只加最贵的一条：**API 层不得 import store**。 |
| `@walnut/ui` 迁移范围 | (a) 按 ADR 0017 迁 22 个；(b) 只迁「零 app 依赖 + 已被 ≥2 处复用」。**倾向 (b)**（与 `@walnut/ui` 剩余组件 合并裁决）。 |
| API 路由迁移收尾 的 server 侧迁移方式 | (a) 手工逐个改；(b) `gen-route-catalog` + `verify-route-parity`。**倾向 (b)**（与 API 路由迁移收尾 合并裁决）。 |
| 后端验证策略 | (a) 维持 class-validator；(b) 新模块用 Standard Schema、存量不动；(c) 全量迁移。**倾向先 (b)**（与 后端验证策略（落地） 合并裁决）。 |

---

## 做过什么（历史）

> 逐批执行记录、已移出待办项的核实记录、以及一份已决的调研结论，**已搬去归档页**：
> [架构待办的历史：执行记录 · 核实记录 · 已决调研](/content/archive/2026-09-24-architecture-ledger-history)。
>
> 搬走的理由：这个页面要回答的是「**还剩什么**」，而它此前 116 KB 里约九成是历史 ——
> 每次都要翻过几万字才找得到剩下的活。历史进冻结语料（`archive/`），不再逐次通读。

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
