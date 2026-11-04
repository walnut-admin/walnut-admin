# 架构待办事项

> **本页是本仓架构债的唯一真源。** 每条都写「**判据** + 证据到 `path:line` + 成本级别」，
> 不写「谁在哪天怎么做的」—— 逐批执行记录、已移出项的核实记录在
> [架构待办的历史](/content/archive/2026-09-24-architecture-ledger-history)（冻结语料，不必逐次通读）。
>
> 判据优先于清单：**「表里还剩什么」比「一共做完多少」有用**。所以做过的条目只留一行证据
> （见「已彻底关闭」），防止将来有人把做完的事再捞回来；仍然开着的条目必须写清「它现在为什么不能做 / 卡在谁那里」。

**最后核实**：2026-11-04 ｜ 工作树 0 dirty ｜ 包数以 `pnpm-workspace.yaml` 的 `packages` 字段为准
｜ 门禁全绿（`prepush` 段数以 `PREPUSH_GATES` 为准 / `lint` / `types:check` / `test` /
`boundaries` / `syncpack` / `build` / `build:docs` / `lint:adr`）

## 优先级总览

| 级别 | 判据 | 条目 |
|------|------|------|
| ~~P0~~ | 阻塞首次发版 | **当前为空** —— 唯一的 tag 发布链路端到端验证已被决定推迟，见下面「搁置」一节 |
| ~~P1~~ | **没有任何东西在看这一面**（不是「哪里写错了」） | **当前为空** —— 已知的几面都有人看着：turbo tags 反向断言、根脚本形态、脚本入口两条 ESLint、动态 import、madge 0 环、四道文档门禁。2026-11-04 复核无新增 |
| **P2** | 维护性 / 体验改善，成本有据 | TS 7 迁移准备 · store 工厂迁移 |
| **P3** | 远期 / 条件触发 | 后端验证策略落地 · E2E · 组件文档补写 · 两处安全观察 · `@walnut/i18n`/`@walnut/security` 新包 · Phase 4 组件自动注册 · `Global/AI` 评审缺陷 · 基建注释历史账 · env 模板三个 `VITE_*` · `list` 旧 `query` 兼容路径退役 |
| **搁置** | 等条件成熟（外部依赖，或已决定先不动） | `pnpm peers check` · knip · tag 发布链路端到端验证 · GitHub Environments · 国内 self-hosted runner · 锚点校验 |
| **未裁决** | 连「做不做」都还没定 | 2 条（`C4` / `C5`）+ 2026-09-21 评审遗留的 4 条设计选型 |

---

## 已彻底关闭（2026-11-04 核实：DONE 且无尾巴）

> 一行一条，只留**证据**。做过的细节在[执行记录](/content/archive/2026-09-24-architecture-ledger-history)，
> 决策理由在 `industry-research/backend-architecture-review/07-decisions.md`。

| 项 | 证据（判据落到路径） |
|---|---|
| **D0** 单体内后台（不拆产品线） | 判据「抽包正当性 = 本仓自己的复用」：没有第二个产品线，`packages/platform-node` 至今未建（延后见「待触发」） |
| **D1** 删 `@walnut/ui` + 注册表改显式 | `packages/platform-web/ui` 已不存在；3 个 naive 透传组件回到 `apps/admin/src/components/UI/`；`Base:Switch` 的「按目录名动态 import」换成静态注册表 |
| **D2** list 三槽位止血 + 显式 `filters` wire | 入参契约在 `apps/server/libs/list/src/list.dto.ts`（`filters: FilterDTO[]`），算子按**列类型**选在 `apps/server/libs/repository/src/pg-list.builder.ts`；回归面是 `apps/server/apps/api/test/integration/` 各 `*.int-spec.ts` 的 `filters` 断言 |
| **D3** worker 真接线 | `apps/server/apps/worker/src/main.ts`（组合根）+ `deploy/docker-compose.yml` 的 worker service（同一镜像、只换 command）+ `deploy/post-verify.sh` 的 `RUN_WORKER` 校验 |
| **D6** `@walnut/types` 保留、platform 改 web | `packages/platform-any/types/package.json` 的 `"platform": "web"`；后端对它的消费为 0（判据：`rg '@walnut/types' apps/server`） |
| **D7** `@walnut/utils` 收缩 | `packages/platform-any/utils-core/src/` 只剩 `sign-raw.ts` / `object-paths.ts`（各带 spec），浏览器专用的值已下沉 `packages/platform-web/client` |
| **D8** platform-web 删桶入口 | `packages/platform-web/{client,http}/src/index.ts` 都不存在，只留子路径导出；ADR 0013 的口径改为「桶取决于有没有仓外消费者」 |
| **D9** `api-types` 归类 + `openapi:check` 两段 | 生成物在 `packages/generated/api-types/`；第二段查**暂存区**（`packages/tooling/scripts/src/ci/__tests__/prepush.test.ts` 的「已 add 的生成物不许让门禁绿」） |
| **D11** 分布式锁端口化 | `apps/server/libs/lock/src/lock.port.ts` + `murlock.adapter.ts`（各带 spec），消费方按端口注入而不是直取 murlock |
| **D12** 域缓存登记制 | ADR 0022 Decision 5 的四条准入判据 + 命名 `<domain>.cache.ts`（`apps/server/libs/cache/src/service/`）；新增域缓存不满足判据就不许进门 |
| **D15** 分页稳定 | `apps/server/libs/repository/src/pg-list.builder.ts:120` 的 `withPgListTiebreaker(...)`：默认排序末尾追加 id 兜底 |
| **D18①** frontend 侧边界规则 | 落在 `turbo.json:62-77`（`platform-web` deny `platform-node`）。刻意**不新建**只服务单包的 `frontend` 键，理由写在注释里；反向断言由 `lint:turbo-cache` 守 |
| **D18③** admin 动态 import 门禁 | `packages/tooling/scripts/src/ci/check-dynamic-imports.ts` 已进 `prepush.ts:145`（`lint:dynamic-imports`）。**`D18②` 仍开着**（编号 `C5`），见「未裁决」 |
| **D19** 不引 dependency-cruiser，madge 0 环进 prepush | `prepush.ts:87-90` 的 circular 段；`prepush.test.ts:67` 断言「摘掉 `--circular` 就红」（防止门禁退化成只数文件） |
| **`.data` mtime 判据** | `apps/server/apps/worker/README.md` 的 SIGTERM 复现段：停 worker 前后比 `stat -c '%Y %s'` 与 sha256 —— `.data/tokensList.json` **不被重写**（不靠「应该不会写」的推断） |
| **段数防腐测试** | `packages/tooling/scripts/src/ci/__tests__/prepush.test.ts`：段数非 0、id 无重复、整表顺序稳定、每段 argv 都落得到真实脚本、每段都写了「凭什么」 |
| **D13①** 删死库 `libs/delay` | 目录已不存在，tsconfig paths / nest projects / swcrc / `tsconfig.app.json` 的 include / ESLint 分层名单等注册面一并清；留着的唯一效果是让人以为有个延迟能力可用 —— `41be94ab` |
| **D13②** `libs/context` 并入 `libs/als` | `libs/context` 已删除，`rg '@walnut-server/context' apps/server` 只剩别名残留。**搬的是模块边界，两套 `AsyncLocalStorage` 实例刻意不合并** —— 合并实例会让 winston 读不到 `requestId` —— `add9481b` |
| **`batch15-a`** 一段超时不再杀并发兄弟段 | 超时分支改调 `killChildTree(child)`（只收本条 gate 的子树），不再是无参的 `killActiveChild()`；兄弟段被连带判死的假红消失 —— `17450ef5` |
| **`batch15-b`** 门禁预算按段区分 | `packages/tooling/scripts/src/ci/prepush.ts` 里 `PrepushGate.budgetMs` 优先、缺省回落 `GATE_BUDGET_MS`（600s），`SLOW_GATE_BUDGET_MS` 给 lint / test 两段；`PREPUSH_BUDGET_MS` 仍是全表一处的覆盖入口 —— `17450ef5` · `5dbdb4e8` |
| **D14** 剩余注册面守卫 | `apps/server/apps/api/src/common/monorepo/__tests__/lib-registration.drift.spec.ts` 现在把磁盘 `libs/<name>` 与它头注释里列的全部注册面逐面对账（含三份 `tsconfig.app.json` 的 `include`、`eslint.config.ts` 的分层名单、`tsconfig.lib.json` 的内容形状）—— `add9481b` |
| **A4** 孤儿模块守卫 | `apps/server/apps/api/src/common/monorepo/__tests__/orphan-module.drift.spec.ts`：扫 `@Module` 类再找 `imports` 命中，零引用即红 —— `add9481b` |
| **C1** admin 请求体 `as` → `satisfies` | `apps/admin/src/api/system/device.ts` 已换成 `satisfies`；真根因不是断言而是 **`Initial` 类型取了实体面**，改取 wire 面 `components['schemas']['SysDeviceDTOInitialRequest']` 后两处松动各按真因修（`getMemoryGB(): number`、`deviceInfo.type` 可选就不发）—— `b382a580` |
| **C3** `concurrency` G6 偶发 | 两条都关：测试侧种子改显式提交事务（`e2dc612d`），库侧是**真 bug** —— `apps/server/libs/db/src/tx.interceptor.ts` 的 catch 只 release 不 rollback，毒连接带着未提交事务回池（`c7f7e11f`）；负对照在真实 PG 上读到 `expected 'idle in transaction' to be 'idle'` |
| **`--skip-gates` 的记账** | 发版电池的「真跑通过」改成只数传入的 Set：显式跳过与子进程退 3 都单列「跳过（未验证）」并减 `ranCount` —— `5dbdb4e8` |

## 剩余待办

### P2 — 维护性 / 体验改善

| 事项 | 成本 | 判据与证据 |
|---|---|---|
| **TS 7 / tsgo 迁移准备** | **M** | `@walnut/tsconfig/base.json` 的 `ignoreDeprecations: "6.0"` 一刀切静音了通往原生编译器的迁移信号。做法是先做一次**阻塞面实测**（全仓 `types:check` 用 TS 7 跑一遍），再定排期。⚠️ 与「全量 deps 升级」重叠，建议并到那一次。另：`apps/server/tsconfig.json` 未显式声明 `moduleResolution`（`module: commonjs` 使其落到默认 `node10`） |
| **store 工厂迁移** | **M** | `createWalnutStore()` 只在 `@walnut/client` 内部被引用（`src/index.ts` + `store/createWalnutStore.ts`），admin 侧 26 个 store 文件 **0 处**使用（判据：`rg createWalnutStore apps/admin`）。新 store 优先用它，别再复制模式 |

> 已完成但仍需记住口径的两条：**API 路由迁移收尾**（U2 批）47 个 controller 前缀全部改用 contract 常量，
> `route-catalog.drift.spec` 即 parity 门禁；**server 方法级路径仍是相对字面量**（Nest 的方法路径相对前缀，
> 换成绝对常量会改变路由），由 openapi 零 diff 兜底。

### P3 — 远期 / 条件触发

| 事项 | 成本 | 判据与证据 |
|---|---|---|
| **后端验证策略（落地）** | **L** | 方向不变、前提已变：NestJS 12 已官方支持 Standard Schema（`@Body({ schema })` + `StandardSchemaValidationPipe`，同一 schema 还能驱动 OpenAPI），class-validator 仍完全支持、无移除计划。真正的缺口不在「换校验器」，而在**持久化读回 / 队列 / SSE** 三处边界校验 —— 补不上这三处，这次迁移就不值得做（详见 [ADRs 0016](../adr/0016-validation-strategy.md) 与 [zod 评估](../adr/zod-evaluation.md) 末尾的 2026-11-04 订正） |
| **E2E 测试（Playwright）** | **L** | 先覆盖单元 + 集成；E2E 等测试体系稳定后再加 |
| **按新命名补写组件文档** | **L** | 正典是 `content/frontend/component/index.md` 规划的那套（kebab-case + 六个目录）。现状：规划里的页面一篇未写，旧树 42 篇仍在 sidebar 里可达（写完之前先留着，否则组件文档就没入口了）。完成标志：新页存在 → 旧树删除 → sidebar 改指 → `index.md` 的纯文本改回链接（要过 `build:docs` 死链校验） |
| **两处业务代码的安全观察**（只登记不动手） | **S** | ① `apps/admin/src/utils/window/open.ts` 的 `openOAuthWindow` 调 `window.open` 没带 `noopener`；**但「照抄加上」是错的** —— 调用点在 `views/auth/src/shared/other.vue` 接住了返回值并靠它 `close()` 关窗，而带 `noopener` 时 `window.open` 返回 `null`（静默失效）。好在该流程的结果走 SSE，不依赖 `window.opener`。② 开 `no-dangerous-html` 类规则会立刻命中 4 个 `v-html`（`components/Global/AI/**`）与 2 处 `innerHTML = ''`（清空、非注入）—— 按「一排开始误报的门禁等于没有门禁」，现在不该开 |
| **`@walnut/i18n` / `@walnut/security` 新包** | **L** | 目录都未创建。**真正的前置是前端组合根**：不先做显式 `createWalnutApp(options)`，这两个包落不了地（seam 形态也未定，见「未裁决」） |
| **Phase 4 组件自动注册迁移** | **M** | `unplugin-auto-import` 已移除（[ADR 0020](../adr/0020-remove-unplugin-auto-import.md)），但 `unplugin-vue-components` 还在 —— 它**没有类型安全网**（`strictTemplates` 未开，组件名写错 `vue-tsc` 不报）。要摘得靠 codemod + 运行时冒烟；component resolver 只扫 admin 自己的组件树 |
| **`Global/AI` 的评审缺陷** | **M** | 仍然成立的：读 localStorage 全是 `as` 无字段级校验、面向用户文案硬编码中文无 i18n、`.pill` 写死浅色导致暗色发白、parser 对 AI 输出无字段守卫、兜底分支缺日志。已失效的**别再修**（`useFloatingDock` 已有卸载清理、`Thinking/TextShimmer` 早已内联 props、B2/B5 引用的 composable 已随业务层删除）。引用那份 REVIEW 前先看条目里的更正 |
| **基建注释里的历史账** | **S**（增量做） | 判据（照它做，别自由发挥）：① 注释里写**规则**、不写叙事；② 判据细节指向文档站；③ **不写会腐烂的计数**；④ 每批自证「`git diff` 里非注释改动为 0」。不单开批次，顺手做 |
| **env 模板里三个 `VITE_*` 是空串** | **S** | `VITE_GA_ID` / `VITE_GOOGLE_CLIENT_ID` / `VITE_SERVER_STATIC_PUBLIC_KEY` 的明文就是 `''`，`pnpm setup-env` 恢复不出真值。GA 与 Google 都有消费点自己的守卫，**`VITE_SERVER_STATIC_PUBLIC_KEY` 没人兜**（登录时与服务端下发的值比对，空串大概率判不匹配，未实测）。要决定：模板是否带一组可用 dev 值，还是把「空值 ⇒ 该功能关闭」定成所有消费点的统一约定 |
| **`list` 的旧 `query` 兼容路径退役** | **S** | `apps/server/libs/repository/src/pg-list.builder.ts` 的 `IListRequestParams.query` / `legacyConditionFromValue()` 及其 `raw` 分支。HTTP 层早已不收这个槽位（DTO 无该字段，顶层白名单直接 40099），今天只剩「库内 / 库外直接构造入参」的兜底，语义是**丢弃 + warn**。删除判据两条全满足：① 静态 0 调用点；② 运行面连续 30 天无触达（这条路径解释成功时**完全静默**，要按它判得先补触达计数）。现在不删：删它零收益，留着有回滚价值 |

## 测试目录约定（2026-11-04 起，`9238dcc8`）

> 判据优先：写「什么该放哪」而不是写文件数 —— 数目会腐烂，落点规则不会。

- **单测与源码同目录**：`__tests__/` 放在被测文件旁边（如 `apps/server/libs/als/src/__tests__/`），
  不再有把单测与源码分居两棵树的集中目录。判据：找一个模块的源码就能在它旁边找到它的单测，
  反之亦然。
- **接口测试**：`apps/server/apps/api/test/api/<模块>/` —— 一级目录与 `apps/server/apps/api/src/modules/`
  的一级目录一一对应；**跨切面的放 `platform/`**，`helpers/` 只放不承载用例的夹具。
  判据：`test/api/` 的一级目录集合 = `src/modules/` 的一级目录集合 + `platform/` + `helpers/`，
  多出一个模块目录或少一个都算漂移。
- **集成测试**：`apps/server/apps/api/test/integration/<领域>/` —— 一级目录按**领域**（一次真实的跨模块
  协作，如 auth / device / tx）分，不按模块分。判据：新建领域协作才新建目录，单个模块的编排进 `test/api/`。
- **e2e**：`apps/server/apps/api/test/e2e/`。

> 这次重整**只动位置、不动内容**（用例集合不变），所以「目录约定」不是新增纪律，而是把已经落地的
> 事实写下来 —— 新增用例按**被测对象**选目录，不按「上一批放哪」。

## 待触发 / 建议不做

| 项 | 为什么现在不做 | 什么情况下捞回来 |
|---|---|---|
| **`D4` 的 P1**（两个包自建 CJS dist，恢复包边界） | 现状走 P2「不搬」：边界清晰今天已由 ESLint 六层 + 3 个 drift spec + madge 提供；P1 的代价是新增一条构建流水线 + `peerDeps(@nestjs/*)` + 28 库搬迁 | 出现**第二个 Node 产品线**（不是第二个进程 —— worker 与 api 共用同一份 AppModule 与构建产物，不构成跨包复用），或决定把后端能力对外发布。触发条件与实测结论见 `industry-research/backend-architecture-review/07-decisions.md` 的 D4 修订记 |
| **`turbo.json` 的 `platform-node` tag** | 留着当 P1 的落点：今天没有 subject（`packages/platform-node` 未建），那条规则永远空转 —— **属已知冗余，不是遗漏** | 走 P1 建包那天它自动生效；现在删掉反而要在同一批里加回来 |
| **`D18②`**（共享包的 barrel 从 knip `entry` 摘出，改「0 引用」脚本） | 处方**实测判为物理不可执行**：knip 会从 `package.json` 的 `exports` 把同一个 barrel 推回 `entry`，**摘了等于没摘** —— 判据与推理写在 `knip.config.ts:155-165` | 要查 barrel 自身的死导出只能另立「barrel 符号 0 引用」专用脚本（成本 M）。**要不要接受「改成不做」需拍板 —— 已编号为 `C5`**，见「未裁决」 |
| **`D20` / `D10` 的 `build/image/**` 旧拷贝** | 是**本地构建遗留**的 deploy 产物，**已被 gitignore**（判据：`git status --ignored -- build` 只显示 `!! build/image/`）⇒ 不进仓、不影响任何门禁 | 不需要捞回来：要清就重跑一次 `pnpm deploy` 让它自净（或直接删目录），别为它写清理脚本 |
| **UUID v7 / dependency-cruiser / 第三个 platform-node 包** | 已决定「不做 / 等触发」，留痕在 `07-decisions.md` 的「明确不做」一节 | 条件写在同一节，别在这里重抄 |

## 搁置（等条件成熟）

> 🅿️ 这一节是「**已经决定先不做**，在等一个外部条件」—— 每行必须写清解冻条件，否则它就该回 P2/P3。

| 事项 | 搁置原因与解冻条件 |
|------|------|
| `pnpm peers check` 红（+ `peerDependencyRules` 豁免机制随 pnpm 12 迁移消失） | **2026-09-23 的决定：先不动**，因为马上要做全量 deps 升级，5 组 unmet peer 的结论可能变。它**不在任何门禁里**，不影响 CI 与钩子。**解冻**：全量升级后重跑，看还剩几组再决定 (a) 恢复等价白名单并接门禁 还是 (b) 正式记录「红是预期」。⚠️ 单独升 turbo 那次重跑**仍是同样 5 组**，别指望顺手清掉 |
| tag 发布链路端到端验证 | **2026-09-23 的决定：首次发版不着急**。未验证的是镜像构建 → 推 TCR → 自动部署 → post-verify（本机无 Docker，只能等真跑一次 tag）。**解冻**：准备发第一个版本时；清单见 [CI/CD 与容器构建](./ci-cd) |
| GitHub Environments | 已核实 deploy 作业**未**使用原生 `environment:`（只有作业级 `env:` + `workflow_call`/`workflow_dispatch` 的 `environment` 输入 + `concurrency`）。**解冻**：stage 服务器到位后再评估 |
| 锚点（`#fragment`）校验 | **2026-09-23 实测后搁置**：VitePress 只查「目标页存在」，**不查 fragment**；能补的现成工具只有 `lychee`。当时全站带锚点的站内链接**实测 8 条**，为一个二进制 + 一个 CI 步骤换 8 条链接的校验，ROI 说不通。**解冻**：① 带锚点的站内链接涨到几十条；② 出现一次锚点静默失效的真实事故（读者点不到，构建照样绿）。📌 已经付过一次代价：那次手工核对当场查到 1 条坏的，且执行记录里「页内锚点全部可解析」那句从写下那天起就是错的 —— 这一面没有任何东西在替我们看着。另半条（prose 里几百处反引号仓库路径）**已经不做**，由 `pnpm lint:docs-refs` 覆盖 |
| knip（`pnpm knip` exit 1） | **2026-09-23 的决定：先不动，只写明现状**。理由：本仓是模板项目，「未用导出」不等于死代码（`libs/decorators/src/transformer/**` 那批就是给使用者按需取用的 API 面）。**现状不写计数** —— 要读数就跑 `pnpm knip`；判据与怎么看写在 `knip.config.ts` 顶部注释。**若将来要接门禁**：先用 `entry` / `includeEntryExports` 把「有意的公共面」显式标出来，只让真死代码亮红 |
| 国内 self-hosted runner（决策门） | **解冻**：仅当 tag 链路实测显示「tag 发布总时长 > 20 min 且跨境推送占大头」。runner 在美国、镜像仓库在腾讯云上海，跨境上传是旧流水线 78 分钟的主要嫌疑之一。**先看数据再决定** |

## 未裁决（等你一句话）

> 每条都写了选项与倾向；裁决结果要么变成上面的 P2/P3 条目，要么写进 ADR（「已否决」也要留痕）。

### 本批 2 条（带 `C` 编号，登记在[需要拍板的](/content/reports/decisions)）

| # | 议题 | 选项与倾向 |
|---|---|---|
| **C4** | `platform-node` 走 **P1**（两个包自建 CJS dist）还是 **P2**（不搬 = 现状） | (a) **P2 不搬**（当前按这个做的）：边界由 ESLint 六层 + drift spec 守；(b) P1 自建 dist，第一关必须是「`tsc` 产出的装饰器元数据与 SWC 等价」—— 错了的症状是**静默的**（接口 200 但字段消失）。**推荐 (a)**，触发条件见「待触发」 |
| **C5** | `D18②` 的原处方被判**物理不可执行**，接不接受「改成不做」 | (a) **接受**（当前按这个做的）：barrel 死导出这条面**不做**，只在 `knip.config.ts` 留判据与理由（成本 0）；(b) 另立「barrel 符号 0 引用」专用脚本（报告模式 → 白名单 → 进 prepush，成本 M）。**推荐 (a)**；编号来由：这条原在本表里没有 `C` 号，2026-11-04 补成 `C5` |

### 2026-09-21 评审遗留的 4 条设计选型

| 议题 | 选项与倾向 |
|------|------|
| `@walnut/i18n` / `@walnut/security` 的 seam 形态 | (a) TS `interface`；(b) abstract class + 独立 provider 包。**倾向 (b)**（`interface` 无运行时令牌，表达不了「依赖 definition 而非 provider」） |
| 前端组合根 | (a) 维持隐式全局；(b) 显式 `createWalnutApp(options)`；(c) 轻量 DI 容器。**倾向 (b)**；(a) 会让上面那两个新包无法落地 |
| 源码面 / 产物面分离 | (a) 维持 ADR 0002 的双模 `exports` + 补一道「dist 过期」检测；(b) 让消费者显式声明所在面。**倾向先 (a) + 检测** |
| admin 内部分层是否入门禁 | 建议先只加最贵的一条：**API 层不得 import store** |

> 已裁决的留痕（不再列进本表）：文档类建议全部落地；`@walnut/ui` 迁移**撤销**（实测「零 app 依赖 + ≥2 处复用」为 1/0/0）；
> API 路由迁移的 server 侧采用「drift spec 即 parity 门禁」；后端验证策略的选型并入上面的 P3 条目。

## 做过什么（历史）

> 逐批执行记录、已移出待办项的核实记录、以及一份已决的调研结论，都在
> [架构待办的历史：执行记录 · 核实记录 · 已决调研](/content/archive/2026-09-24-architecture-ledger-history)。
>
> 搬走的理由：这个页面要回答的是「**还剩什么**」，而历史占过九成篇幅 ——
> 每次都要翻过几万字才找得到剩下的活。历史进冻结语料（`archive/`），不再逐次通读。

## 相关文档

- **另一本账（产品 / 功能待办）**：仓库根的 [`TODO.md`](https://github.com/walnut-admin/walnut-admin/blob/main/TODO.md)
  —— 记的是**功能与体验**；本表记的是**架构与工程债**，两者刻意分开。
  ⚠️ 那个文件里的编号项（`000` / `111` / `999`）**被源码里的 `// TODO NNN` 注释引用**，改编号等于改一堆注释锚点。
- **需要拍板与已代拍的账**：[需要拍板的](/content/reports/decisions)（已收口：§1 只剩 `C4` / `C5` 两条待拍板，`C1` / `C2` / `C3` 均已结案留档）
- **后端结构调研的决策与计划**：`industry-research/backend-architecture-review/` 的
  [06 复核](/content/industry-research/backend-architecture-review/06-cross-check) ·
  [07 决策](/content/industry-research/backend-architecture-review/07-decisions) ·
  [08 排期](/content/industry-research/backend-architecture-review/08-recommended-plan) ·
  [10 实施计划](/content/industry-research/backend-architecture-review/10-implementation-plan)
- [CI/CD 与容器构建](./ci-cd) ｜ [发布 & 发版指南](./release.md)
- [ADR 索引](../adr/index.md) ｜ [ADR 0009 CI 质量门禁](../adr/0009-ci-quality-gates.md) ｜ [ADR 0017 包重组](../adr/0017-package-reorganization.md) ｜ [ADR 0018 Git 钩子迁 lefthook](../adr/0018-git-hooks-lefthook.md) ｜ [ADR 0019 tsconfig 预设与无 `.mjs`](../adr/0019-tsconfig-presets-and-no-mjs.md) ｜ [ADR 0022 后端 lib 分层与组合根](../adr/0022-backend-lib-layering-and-composition-roots.md)
- [归档：架构 Review 与调研审计](../archive/2026-09-21-architecture-review.md)（F / D 项的完整论证）
  —— 其中**第三档「明确不建议照搬」的 10 条**是**已否决的决策**，按「否决也要留痕」留在那里，本表不重复。
- [归档：CI/CD 重构实施记录](../archive/2026-09-21-ci-cd-pipeline-plan.md)
- [行业调研 - CI/CD](../industry-research/03-ci-cd-pipeline.md) ｜ [行业调研 - 测试](../industry-research/04-testing-strategy.md)
