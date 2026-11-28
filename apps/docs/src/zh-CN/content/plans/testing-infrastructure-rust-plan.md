# 测试基建 Rust 化：实施计划

> 状态：**P0–P2 已执行**（2026-11-28 立项并同日落地）；P3 起的每一项都在等一个明确的拍板或一个前置条件。
> **定位**：把「测试基建要不要动、怎么动」拆成可独立验收、可独立回滚的阶段，回答每一步
> **先做什么、做到什么算完、怎么退回去**。
> **读者**：执行各阶段的 agent；评审阶段产出的仓库所有者。
> **权威边界**：**为什么这么判、证据在哪**在[调研与判定](../industry-research/testing-infrastructure-rust-assessment.md)
> （下称「调研」）；本篇只写**怎么做、怎么验**。与代码冲突时以代码为准。
> **节点标记**：每个阶段标题后带一个标记 —— **已落地**（本轮做完）、**可直接实施**（不需拍板，条件满足就能做）、
> **需拍板**（涉及取舍，要仓库所有者决定）、**观望**（等上游或等前置条件）、**否决**（记录结论，不再讨论）。

## 1. 口径与原则

三条写作口径（与[迁移计划](./rust-toolchain-migration-plan.md)同源）：

1. **不写具体 diff**：给范围与判据，实现细节在阶段执行时决定。
2. **不写会腐烂的清单**：涉及文件写「在哪找」，不写「一共几个」；数量以指到的配置文件为准。
3. **尚未存在的路径不加反引号**：`pnpm walnut lint:docs-refs` 会校验反引号里的仓库路径是否真实存在。

四条执行原则：

| 原则 | 含义 | 为什么 |
|------|------|--------|
| **一次一个变量** | 一轮只动依赖版本、或只动编排、或只动单个包的配置；不同时动 | 测试基建的坏法常常是「少跑了一批」而不是「红了」，混着改无法定位 |
| **先记基线再改** | 每个阶段开始前记下 `turbo run test --force` 的总时长与各 task 时长 | 测试耗时受机器负载影响极大（调研 §9.2 的方差就是这个坑），没有同机对照就没有结论 |
| **回滚=编辑，不是 git 操作** | 每个阶段写明「改回哪一行就退回去」 | 本仓 agent 不做 git 写操作；回滚必须是一次可描述的编辑 |
| **门禁三表同步** | 若阶段新增 / 改名 / 删除任何门禁命令，必须同时改 `tooling/scripts/src/ci/prepush.ts`、`tooling/scripts/src/ci/local-ci.ts`、`tooling/release/src/release/steps.ts`，并同步对应 drift 测试 | 三张表按命令名互相引用，漏一处等于门禁静默失效 |

## 2. 阶段总览

按「收益 / 风险比」排序。收益指**可观测的测试耗时或可靠性改善**，风险指**改动后可能静默少跑**的面。

| 阶段 | 标记 | 目标 | 收益 | 风险 | 依赖 |
|------|------|------|------|------|------|
| P0 基线 | 已落地 | 同机记录冷缓存全量与各 task 时长 | —— | 无 | 无 |
| P1 contract 的 `test`/`build` 竞态 | 已落地 | 消掉 `dist/` 上的并发写 | 假红消失 | 低 | 无 |
| P1b `test:debug` 的失效参数 | 已落地 | 让调试脚本重新能按下去 | 修好一条坏掉的入口 | 低 | 无 |
| P2 vitest 4.1.2 → 5.1.2 | 已落地 | 与 Oxc/Vite 8 同一条维护线 | 中位数约 −6%（官方口径 −13% ~ −19%，本仓属 ±3% 档） | 中（major，`clearMocks` 默认变化） | P8 的判据表 |
| P3 `isolate: false` | 需拍板 | 拿回最大的一块单点提速 | **−72%（实测）** | 高（3 个文件的隐式全局状态会串） | 先做「全局状态显式化」 |
| P4 Playwright 1.59 → 1.65.1 | 需拍板 | 跟上 6 个 minor | 报告能力（`onlyFailures`）与安全修复 | 中到高（编排 + 基线 + 整栈验收） | 完整 E2E 栈 |
| P5 Oxc 元数据实证门 | 观望 | 给「可否弃 SWC」一个机械判据 | 若通过：server transform 进 Rust | 高（DI/TypeORM/Swagger 静默坏） | Oxc 上游修 [#21922](https://github.com/oxc-project/oxc/issues/21922) |
| P6 `pool: threads` | 观望 | 再挤一档 worker 启动开销 | −9%（单次实测） | 中（Windows 原生崩溃带回） | 多轮无崩溃证据 |
| P7 否决项 | 否决 | 记录 `deps.optimizer` / node:test / Rust e2e / `turbo-test` 的结论 | 省掉重复讨论 | —— | —— |
| P8 升级判据表 | 已落地 | 把「major 升级怎么算过」写死 | 下一轮直接复用 | 无 | 无 |

## 3. P0 基线（已落地）

**目标**：在任何改动之前，拿到同机、同条件的一组读数。

**改动面**：无（只记录）。

**做法**：`pnpm exec turbo run test --force --summarize`，从 `.turbo/runs/<hash>.json` 取每个 task 的
`execution.startTime/endTime`；再对耗时的头号包单独跑 3 次（独占机器），取中位数。

**验收**：有一份带日期的读数，且**同时记下当时的机器状态**（是否并发跑别的重任务）。

**风险**：把 `turbo` 的总时长当提速证据 —— 同一轮里 `build` 类 task 也会「变快」，那是负载差异
不是工具差异（调研 §9.2 记了这个反例）。

## 4. P1 contract 的 `test` / `build` 竞态（已落地）

**目标**：消掉冷缓存 `--force` 下 `@walnut/contract#test` 的偶发 `ENOENT ... scandir '...dist'`。

**改动面**：`packages/platform-any/contract/turbo.json` 一处。

**判据**：`contract` 的 `test` 脚本是 `pnpm run build && vitest run`（要验 `dist` 的导出），
而根 turbo 的 `test` 只挂 `^build`；contract 自己的 `build` 由**别的包**的 `^build` 触发，
于是两条 task 在同一份 `dist/` 上并发写。修法是把自家的 `build` 显式串进 `test` 的依赖。

**关键注意**：`dependsOn` 数组是**整键替换**不是追加 —— 写了 `["build"]` 就会把根上的 `^build` 丢掉。
所以必须写成 `["^build", "build"]`。

**验收**：`pnpm exec turbo run test --force --filter=@walnut/contract --dry=json` 里
`@walnut/contract#test` 的 `dependencies` 含 `@walnut/contract#build`；随后两次冷缓存 `--force`
全量跑不出该签名。

**回滚**：把那行 `dependsOn` 删掉（回到只有 `extends` + `tags` 的形态）。

**风险**：`test` 现在会多跑一次 `build` 的 task（脚本内部的 `pnpm run build` 保留，因为单独
`pnpm --filter @walnut/contract test` 仍要能跑）。多出来的是一次毫秒级重建，可接受。

## 4b. P1b `test:debug` 的失效参数（已落地）

**目标**：`apps/server` 的 `test:debug` 脚本带着 `--threads=false`，该参数在 vitest 里早已移除，
实测直接以 unknown option 退出 1 —— 这个脚本是**坏掉**的，不是「不好用」。

**改动面**：`apps/server/package.json` 的 `test:debug` 一行。

**判据**：旧参数的作用是「单进程、便于断点」，对应的现役开关是 `--no-file-parallelism`
（`--pool` / `--isolate` 是另一维度，不该在这里动）。`--inspect-brk` 与 `--logHeapUsage` 保留原意。

**验收**：脚本启动后进入 `Debugger listening on ws://…`（不报 unknown option）。

**回滚**：改回 `--threads=false`（等于恢复一条按不下去的脚本，不建议）。

**风险**：无。该脚本不进门禁表，只影响本地调试。

## 4c. 待评估：用 Vite 原生 `resolve.tsconfigPaths` 替掉 `vite-tsconfig-paths`（观望）

Vite 8 自带 tsconfig `paths` 解析（`resolve.tsconfigPaths: true`，默认关），运行时会对
`vite-tsconfig-paths` 打印一条「可以换掉」的提示。三个 server 测试配置各挂一次该插件。

**为什么不在本轮做**：收益只有「少一个插件、少一次 tsconfig 扫描」，而 resolution 语义换实现
属于**静默失效**的高风险面（别名解析错不会报错，只会 import 到错文件或走到 node_modules）。
必须先有「三条配置各自的解析结果与现插件逐条一致」的对照，再谈替换。

**若要做**：先只改 `apps/server/apps/api/vitest.config.ts`，跑全量 server 用例；
再改 `vitest.config.e2e.ts` / `vitest.config.integration.ts`（后两者要真实 PG/Redis 才能验收）。
最后才动 `apps/server/package.json` 与 catalog 里的依赖条目。

## 5. P2 vitest 4.1.2 → 5.1.2（已落地）

**目标**：把测试框架挪到与 Vite 8 / Oxc 同一条维护线上，顺带吃掉 5.x 的调度改进。

**改动面**：`pnpm-workspace.yaml` 的 catalog 两行（`vitest`、`@vitest/coverage-v8`）+ 锁文件。
**没有**改任何包的 `package.json`、没有改共享预设、没有改各包的配置。

**为什么不需要改配置**：逐条对过调研 §4.2 的 breaking 表 —— 本仓不碰 `test.sequential`、
不 import 已移除的入口、`vi.mock` 都在模块顶层、覆盖率 `include` 是目录形态、`-t` 没有固定写法。
`clearMocks` 默认变 `true` 是唯一有实质影响的一条，全量跑绿说明没有用例依赖跨用例的 mock 调用累积。

**验收（硬性）**：

1. `pnpm peers check` 里 vitest 相关的 peer 不新增未满足项（存量项是别的包的历史问题）。
2. `pnpm exec turbo run test --force` 15 个 task 全绿，用例数与升级前一致。
3. `pnpm exec turbo run lint types:check --force` 全绿。
4. 覆盖率冒烟：在任意一个有覆盖率的包上跑 `vitest run --coverage`，报告能出。
5. 记下同机对照（P0 的读数 vs 升级后），**并写明方差**。

**回滚**：catalog 两行改回 `4.1.2`，`pnpm install`。不需要动其它文件 —— 这正是「只动 catalog」的价值。

**风险与已知未决**：

- 5.x 是 major，若后续新增用例依赖 `clearMocks: false` 的旧语义，会**静默**改变行为。
  处置：新写用例时不要依赖跨用例的调用累积（这与本仓「显式优于隐式」的既有纪律同向）。
- 官方 bench 对「forks + isolated + node」这一档只承诺 ±3%~−19%；本仓中位数约 −6%。
  **不要把这次升级当成绩效项目汇报**。

## 6. P3 `isolate: false`（需拍板）

**目标**：拿回调研 §9.3 里最大的一块单点提速（实测 88.7s → 25.1s）。

**为什么不能直接做**：`isolate: false` 让同一 worker 里的多个测试文件共享模块图，
**这正是它的提速来源**，也正是它的危险来源。实测有 3 个文件 / 7 条用例红，性质都是隐式全局状态：

| 文件 | 症状 | 根因（待确认） |
|------|------|----------------|
| `apps/server/libs/cookie/src/__tests__/cookie.service.spec.ts` | `defaultCookieOptions` 少一个键 | 该 spec 改 `NODE_ENV` 类环境读数的时机与别的文件相互影响 |
| `apps/server/libs/guards/src/interceptors/response/__tests__/success.interceptor.spec.ts` | `Cannot read properties of undefined (reading 't')` | i18n 的全局实例被别的文件替换后未恢复 |
| `apps/server/libs/auth/src/modules/opaque/core/__tests__/opaque.core.service.handshake-undefined.spec.ts` | `vi.fn()` 调用 0 次 | 该文件靠「文件级 `vi.mock` 不污染别人」的隔离假设；共享模块图下假设不成立 |

**前置条件**：先把这三处的隐式全局改成显式注入（环境读数从被测函数入参传入、i18n 实例由用例自建、
`vi.mock` 的作用域假设改成显式依赖注入）。**这是一个独立的、有自己风险的批次**，不该和框架升级混做。

**改动面（若拍板）**：`apps/server/apps/api/vitest.config.ts` 的 `test.isolate`；以及上面三处被测代码/用例。

**验收**：`pnpm exec turbo run test --force` 全绿**且连跑 3 次全绿**（共享状态的问题常常是概率性复现）；
`apps/server` 单跑时长与 P0 基线对照。

**回滚**：删掉 `isolate` 那一行。

**风险**：共享模块图会让「本该独立的用例」互相污染，症状是**偶发假绿**（比假红更坏）。
只有「三处修完 + 连跑 3 次全绿」才允许合并；任何一次偶发红都退回。

## 7. P4 Playwright 1.59 → 1.65.1（需拍板）

**目标**：跟上 6 个 minor 的安全与报告能力（`onlyFailures` 对 CI 报告有用）。

**为什么需要拍板**：改动面横跨「编排脚本 + 6 个 profile 的基线」，且验收必须整栈
（PG + Redis + dist-stage 前后端 + `playwright install`）。本机不具备条件，**本 agent 无法给出绿证据**。

**改动面**：`pnpm-workspace.yaml` 的 `@playwright/test` 一行 + 锁文件；若有 breaking 命中，
再动 `apps/e2e/playwright.config.ts` 或对应 spec。

**逐条要过的 breaking**（调研 §6.2）：`inert` 元素上的动作会等超时、cookie 匹配按 RFC 6265、
`useDefineForClassFields` 生效、空 shard 失败、`params` 追加语义。

**验收**：`pnpm walnut e2e:doctor` 通过；至少 `smoke` + `risk` 两个 profile 全绿；
基线机制在 `--rebuild-baseline` 与否两种模式下都符合预期；`e2e` 编排的三条安全闸
（UA 只一份、XFF 只加 `/api/`、不 FLUSH Redis）不动。

**回滚**：catalog 一行改回 `1.59.0` + `pnpm install` + `playwright install`（浏览器修订号会回退）。

**风险**：`inert` 等待会让「覆盖层没关就点下面」的用例从静默通过变成超时 —— 这是**修好**而不是回归，
但会让一批用例先红，需要先分清「真 bug」与「用例假设过时」。

## 8. P5 Oxc 元数据实证门（观望）

**目标**：给「server 测试能否弃 SWC」一个**机械判据**，而不是靠「跑起来没报错」。

**为什么现在不做**：Vite 8 的 Oxc transform 明确不降级 legacy 装饰器；`oxc-transform` 的
`emitDecoratorMetadata` 与 `tsc` 有已登记偏差（类型别名退化 `Object`、可空联合不收敛、跨文件 enum
退化、前向引用静默 `Object`）。这三类偏差正好打在 DI / TypeORM / Swagger 上。

**实证门（通过才允许往下走）**：准备一个**真实形态**的 server 用例，至少包含

1. 一个 `@Injectable()` + 构造参数带 `@Inject()` 的 service；
2. 一个 class-validator DTO（`@IsString()` 之类）；
3. 一个 TypeORM 实体（至少一列带 `@Column()` 且类型是联合或类型别名）；
4. 断言 `Reflect.getMetadata('design:paramtypes')` 与 `design:type` 的**具体值**，不是「存在」。

在候选 transform（`oxc-transform` 的 napi 包，或 Vite 的 oxc 配置）下跑通，且**逐条断言值与 SWC 一致**。
任何一条不一致 ⇒ 结论是「不可换」，写回调研。

**改动面**：只加一个 PoC 用例（在 server 的测试目录里，默认跳过，用环境变量显式打开）。

**验收**：PoC 在 SWC 下绿、在 Oxc 下红/绿给出明确结论；结论写进调研。

**回滚**：删掉 PoC 文件。

**风险**：PoC 绿不等于全量绿 —— 元数据的偏差是**按类型形态**分布的，PoC 只能证明「这条路可能通」，
不能证明「可以切」。真要切，验收是「全量 server 用例 + 至少一个 integration 用例在 Oxc 下全绿」。

## 9. P6 `pool: threads`（观望）

**目标**：再挤一档 worker 启动开销（实测 80.4s vs forks 的 83–90s）。

**为什么观望**：本仓在 Windows 上有 Node 原生崩溃回归带的先例（高并发 Node 进程偶发 `0xC0000005`），
而 threads + 原生 SWC 的组合恰好落在那个风险面里。一次全绿不足以说明问题。

**前置条件**：在 CI（Linux）上连续多轮绿，且本地连续多轮无崩溃 —— 建议至少各 5 轮。

**验收 / 回滚**：改 `apps/server/apps/api/vitest.config.ts` 的 `test.pool`，删掉即回滚。

## 10. P7 否决项（否决）

这些不是「以后再说」，是**已经用证据否掉**的，避免下一轮重复调研。

| 项 | 否决理由（证据） |
|----|------------------|
| `deps.optimizer`（Rolldown/esbuild 预打包） | 实测 −4%（噪声内）但 10 文件 / 13 条红，破坏 DI 与 i18n。见调研 §9.3 |
| node:test + 类型剥离替换 tooling 小包 | Node 不读 tsconfig（无 `paths`）、不支持 enum/参数属性/装饰器、模块 mock 仍 experimental；改造面是重写断言，省下的只是启动开销。见调研 §5 |
| Rust e2e（chromiumoxide / fantoccini / playwright-rust） | Rust 侧提供的是**驱动**不是**测试运行器**；换过去等于自研 Playwright，而本仓 e2e 的资产在编排与基线。见调研 §6.1 |
| `turbo-test`（Rust + V8 + Oxc 的 vitest 替身） | 0.8.x 单人项目、bench 自报；**自述**装饰器元数据要回落到 `ts.transpileModule`、Node 内建模块是部分 shim、Vue SFC 默认关闭。对 Nest 后端不适配。见调研 §7 |
| unplugin-swc 1.5.9 → 2.0.0 | 2.0.0 的唯一实质变化是 Node 下限（本仓早已高于），无收益。可在下次批量升级时顺带 |

## 11. P8 升级判据表（已落地）

任何**测试框架 major** 的升级，按这张表走；P2 就是按它执行的。

| 步 | 判据 | 不满足时 |
|----|------|----------|
| 1 | 记 P0 基线（同机、同条件、至少 3 次单跑中位数） | 不许开始 |
| 2 | 官方 migration guide 的 breaking **逐条**对代码核对，写下「受影响/不受影响 + 依据」 | 表格不完整就不许改 catalog |
| 3 | 只动 catalog 两行 + 锁文件，不动包配置 | 改动面变大 ⇒ 先拆阶段 |
| 4 | `peers check` 无新增未满足项 | 有 ⇒ 停，先解决 peer |
| 5 | 全量 `test --force` 绿、用例数与升级前一致 | 少一条都要查清是「合并」还是「不再被收集」 |
| 6 | `lint` / `types:check` 绿 | 停 |
| 7 | 覆盖率冒烟（任一带覆盖率的包能出报告） | 停 |
| 8 | 同机对照 + **方差**一起写进文档；只报中位数，不报最好那一次 | —— |

## 12. 剩余项与依赖关系

```
P0 基线 ──► P2 vitest 5 ──► （无后续依赖）
P1 竞态修复 / P1b 调试脚本 ──► 无
P3 isolate:false ── 需先做「三处全局状态显式化」（未立项）
P4 Playwright 1.65 ── 需完整 E2E 栈（需拍板）
P5 Oxc 元数据 ── 需上游修 #21922 或接受偏差（观望）
P6 threads ── 需多轮无崩溃证据（观望）
P4c 换掉 vite-tsconfig-paths ── 需三条配置的解析结果对照（观望）
```

**本轮没有做、也不该顺手做的事**：

- 不动 e2e 编排的三条安全闸（UA 只一份、XFF 只加 `/api/`、不 FLUSH Redis）与「一台机器一个全量 run」；
- 不动 server 的 `emitDecoratorMetadata` 约束（`unplugin-swc` 在有实证前不动）；
- 不把 `turbo test` 的缓存策略、`outputs` 声明、`concurrency` 一起改（那些属于 turbo 轨道）。
