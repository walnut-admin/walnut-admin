# apps/e2e 改造优化方案：从「能跑通」到「可运营」

> 状态：草案（2026-11-25）。本篇是 [E2E 沙盒测试计划](./e2e-sandbox-plan.md) **Phase 2 / Phase 3 的工程细化与扩展**，不另立路线、不推翻已拍板的决策。计划页管分期与验收口径，本篇管「每一项具体改哪个文件、怎么验、碰不碰不变量」。
> **定位**：把 `apps/e2e` 从「本机能跑绿的全链路测试」推进成「有 CI 证据、失败可诊断、时长可扩展、断言可信」的长期工程。
> **读者**：实施 Phase 2 / Phase 3 的人与 agent；评审 E2E 改造的人。
> **权威边界**：现状与操作面以 [`apps/e2e/AGENTS.md`](https://github.com/walnut-admin/walnut-admin/blob/main/apps/e2e/AGENTS.md)、[`apps/e2e/README.md`](https://github.com/walnut-admin/walnut-admin/blob/main/apps/e2e/README.md) 为准；为什么这么定以[计划页](./e2e-sandbox-plan.md)与 [ADR 0009](../adr/0009-ci-quality-gates.md) 为准。与代码冲突时以代码为准，并把差异记进本篇第 7 节。

**调查基线**：本页的现状证据来自 2026-11-25 的只读调查，行号以提交 `b21ac118` 为准（调查期间 `apps/e2e/lib/ui.ts`、`apps/e2e/tests/risk/device.spec.ts`、`turbo.json` 的未提交改动被提交为 `b21ac118`）。**定稿时 HEAD 已前进到 `d720c0d3`**，其间三个提交已消化一部分改造项（契约 bridge / 常量收口、CAP PoW 上界与静态代理加固、慢用例 `test.slow()`）；相关条目已按现状改写，未消化的仍保留。行号会漂移，引用以文件路径为锚。调查时点套件规模是 5 个 project、15 个用例、单 worker；后续新增用例后数字会变，**判断口径看结构，不看数字**。

---

## 0. 与计划页的关系与需要先知道的事实漂移

### 0.1 本篇在计划体系里的位置

| 文档 | 回答什么 | 本篇如何使用 |
|---|---|---|
| [E2E 沙盒测试计划](./e2e-sandbox-plan.md) | 分几期、每期的目标 / 改动清单 / 完成判据 | 本篇按它的 Phase 2 / 3 展开，每个改造项标注对应关系 |
| 本篇 | 每一项改哪些文件、怎么改、怎么验、风险是什么 | 实施时的操作蓝图 |
| [`apps/e2e/AGENTS.md`](https://github.com/walnut-admin/walnut-admin/blob/main/apps/e2e/AGENTS.md) | 改这一层代码必须守住的不变量 | 每个改造项都要过「不变量兼容性」一栏 |
| [行业调研：E2E 与沙盒](../industry-research/08-e2e-and-sandbox-testing.md) | 外部世界的做法与证据 | 差距矩阵的参照系 |

### 0.2 事实漂移（如实记录，不悄悄修正）

1. **Phase 2 状态滞后于代码**：计划页篇头与阶段总览仍写「Phase 2 未开始」，但 U8 / U9 flake 的核心修复（删 `waitForLoadState('networkidle')`、新增 `waitForDeviceHealSettled`、CAP 识别与关闭、`:visible` 选择器、点击补 30s 上限）已在 `b21ac118` 落地，第 7 节原把这条列为待修。本篇已在计划页加最小追记（§7.1），状态仍保持「未开始」——CI 与 risk 矩阵确实没做。
2. **离线口径不成立**：计划页 §2.5 与 README 写「离线环境里 `e2e:risk` 仍应全绿」，但 `apps/e2e/tests/risk/device.spec.ts` 的 Phase0-4 用公网 XFF `1.1.1.1`，后端会调 api.ip.sb 做定位；UI 登录用例又依赖 jsDelivr 上的 CAP WASM。离线时这两类都会红。本篇 P0-2 给出修正方案。
3. **耗时数字已漂移**：计划页记 5.4 分钟，调查时点实测全量 4.3–6.8 分钟。本篇用「实测区间 + 目标预算」表述，不把任何一次读数当作稳定常数。
4. **计划页 §8.1 的 artifact 草案与不变量冲突**：草案写「失败时上传 `playwright-report/` 与 `test-results/`」，而不变量 8 写「trace / 截图 / HTML 报告含 token、cookie，只留本机，不许上传任何公开位置」。私有仓库的 artifact 不是公开位置，但也不是「只留本机」。本篇按**更严格的默认**给方案（只上传不含敏感值的 junit 与脱敏日志），并把「要不要上传 trace」列为需要所有者拍板的口径问题（§5.4）。
5. **调查之后已有三项落地**（HEAD `d720c0d3`，均在 2026-11-25）：
   - `5067b4aa`：契约 bridge（`apps/e2e/lib/protocol/contract.ts`）、cookie / 业务码 / 路由常量收口、knip 的未使用导出清理。→ 本篇 P1-4 的「bridge 二选一」与 P2-11 已消化。
   - `18dcc9c6`：CAP PoW 求解上界（每问尝试上限 + 30 秒墙钟 + challenge 形态校验）与静态代理加固（`decodeURIComponent` 捕获、流错误处理、TOCTOU）。→ 本篇 P2-3 已消化。
   - `d720c0d3`：DEVICE_NEW / DEVICE_RECENT 两条慢用例标 `test.slow()`。→ 本篇 P2-1 的一部分已消化。
   这些提交**没有**改变不变量，也没有改变本篇的 P0 判断（CI 仍未接入、离线口径仍未修、UI 登录仍未瘦身）。

---

## 1. 现状架构总览

### 1.1 编排顺序（硬约束）

入口只有一个：`apps/e2e/scripts/run.ts`。顺序是硬约束，每一步都在解决下一段的时序问题：

1. **抢 run 级 PostgreSQL advisory lock 并整轮持有**（`apps/e2e/scripts/pg-lock.ts`）。restore / prepare-db 的 `DROP DATABASE` 与随后所有用例都假设「这个库此刻只属于我」；锁只罩准备阶段时，两个并发 run 的后一个会把前一个正在用的库删掉。抢不到锁 120s 后报持锁者并退出，不静默排队。
2. **preflight**（`apps/e2e/scripts/preflight.ts`）。检查 stage env、两处 stage 产物、chromium、PG / Redis TCP、3001 / 3002 / 4173 空闲。失败统一退出码 2，此时库还没被碰过。
3. **基线决策**（`apps/e2e/scripts/baseline.ts` 的 `ensureTestDatabase`）。基线有效且 HEAD 一致 ⇒ restore；没有基线 ⇒ 全量 prepare 后自动封板；漂移或基线文件对不上 ⇒ 退出码 2；`--rebuild-baseline` ⇒ 强制全量 prepare + seal；`E2E_SKIP_BASELINE=1` ⇒ 忽略基线、全量 prepare、不封板。整段在锁内。
4. **stack-info**（`apps/e2e/scripts/stack-info.ts`）。写 `.e2e/stack.json`：runId、commit、URL、PG / Redis、产物路径与真实 mtime。
5. **`playwright test`**。参数原样透传（`e2e:smoke` 就是 `--project=smoke`），退出码原样返回。webServer 由 Playwright 起。

```text
抢锁（整轮持有）
  → preflight（失败退 2，库未被碰）
  → 基线决策 ensureTestDatabase（restore / prepare + seal / 漂移退 2）
  → stack-info（写 .e2e/stack.json）
  → playwright test（webServer 起后端 3001 + 静态代理 4173）
```

### 1.2 端口与进程拓扑

| 用途 | 端口 | 启动方 | 备注 |
|---|---|---|---|
| 后端 dist-stage | 3001 | Playwright `webServer`（`pnpm run start:stage`，cwd `apps/server`） | `/health/ready` 探针并发探 PG / Redis |
| 后端 socket.io | 3002 | 同上（进程内） | 与 dev 的 3000 分开 |
| 静态代理 | 4173 | 第二个 `webServer`（`apps/e2e/scripts/static-server.ts`） | 伺服 dist-staging，`/api` 与 `/socket` 反代，保留浏览器请求头 |
| PostgreSQL | 5433 | WSL 常驻栈或通用 compose | 库名必须逐字 `walnut_e2e` |
| Redis | 6380 | 同上 | `FLUSHDB` / `FLUSHALL` 已被 compose 重命名禁用 |

静态代理的三个行为必须记住：`/api/**` 转发到后端 `/w/v1/**`；`/socket/**` 同时接 HTTP 轮询与 WebSocket upgrade；**不改写 XFF**（客户端给什么就传什么，没给就让后端看到 127.0.0.1）。浏览器侧的 XFF 注入只发生在同源 `/api/` 请求上（`installRealIpRoute`）。

### 1.3 数据封板机制

| 层次 | 内容 | 何时重做 |
|---|---|---|
| 快照（库内数据） | 迁移 + seed + 提升 root + CAP 节流放宽 | seal 一次 |
| 运行时状态（库外） | `walnut_app` 角色口令、Redis 应用设置缓存、`.auth/credentials.json` | 每轮（restore 或 prepare 都做） |
| 测试期状态（更外层） | MFA TOTP 绑定（`sys_user_mfa` 行 + `credentials.json` 的 `totpSecret`） | 每轮（seal 发生在 `stack.setup` 之前，快照里没有 MFA） |

封板清单（`baseline.manifest.json`）记 `manifestVersion`、`sealedAt`、`gitCommit`、`migrationsHead`、`dumpSha256`、`dumpBytes`、`menuRows`。restore 前先比 HEAD，再比大小与 sha；restore 后用 `current_database()`、admin 存在、菜单行数、迁移头做 sanity 断言。

实测耗时（调查时点）：`pg_dump` 约 2.4 秒；整轮 restore 1.5–3.5 秒；从零全量 prepare 2–7 秒。**数据重置不是时长瓶颈**，这是判断优化优先级的关键事实。

### 1.4 不变量清单（改造的硬边界）

以下十条来自 [`apps/e2e/AGENTS.md`](https://github.com/walnut-admin/walnut-admin/blob/main/apps/e2e/AGENTS.md)。**任何改造项都不得破坏它们**；每个改造项后面会单独写「不碰哪些」。

1. **`SIGN_USER_AGENT` 只有一份**（`apps/e2e/lib/protocol/sign.ts`）。`apps/e2e/playwright.config.ts` 的 `use.userAgent` 与 `apps/e2e/lib/device-fixtures.ts` 的 `newBrowserContext` 都必须 import 它；签名原文取 `navigator.userAgent`，请求头必须逐字一致。另抄一份会 40112「签名无效」。
2. **XFF 只加在同源 `/api/` 请求上**（`installRealIpRoute`）。整包 `extraHTTPHeaders` 会让 cap.js 从 jsDelivr 拉 WASM 的请求也带自定义头 → CORS 预检失败 → cap-widget 进错误态。
3. **库准备（restore / prepare-db）必须在 `playwright test` 之前**。Playwright 的 webServer 先于 globalSetup 启动，而 webServer 里的后端一连库就要有库；别把建库 / 恢复挪进 globalSetup。
4. **`POST /system/device/initial` 是 4 次 / 60 秒 per realIp**。每条用例、每个协议客户端都要一个独立的 127/8 地址（`uniqueLocalIp()`）；共用 127.0.0.1 会让第 5 台设备登记撞 42900。
5. **Redis 只按 deviceId 精确删**（`deleteDeviceScopedKeys`），**绝不 FLUSHDB / FLUSHALL**。键形对齐 `apps/server/libs/const/src/app/cache.ts`；服务端改键形时这里要同步。
6. **一台机器同一时间一个全量 run**。锁在 `apps/e2e/scripts/pg-lock.ts`，由 `run.ts` 整轮持有；两个 worktree 并发时第二个等锁，120s 抢不到就报持锁者退出。
7. **storageState 不可复用**（IndexedDB 里的 AES `CryptoKey` 恢复不了，Phase 0 gate 已判死）。别再加 `auth.setup` 的写盘、别在 project 上挂 `storageState`；坏状态会把应用卡在 splash。
8. **trace / 截图 / HTML 报告含请求头与响应体（token、cookie）**：只留本机，不许上传任何公开位置。
9. **CAP 节流与设备目录的「放宽」只改库**。全量 prepare 时把 `capjs.config.throttleLimit` 调大（仅本栈库的设置行），restore 继承快照里的这个值；别把测试专用放宽写进源码。
10. **设备清理归 fixture**（`apps/e2e/tests/fixtures.ts` 的两个 auto fixture）。新造的设备要 `trackDevice`，别在用例末尾手写 `cleanupDevices(...)` —— 断言失败时手写清理不会执行。

> 这十条不是「风格建议」，是已经用真实故障换来的边界。改造项如果必须碰其中一条，只能走「所有者拍板 + 改 AGENTS.md + 改计划页」三件套，不能在本篇里悄悄放行。

---

## 2. 差距分析矩阵

参照系是[行业调研：E2E 与沙盒](../industry-research/08-e2e-and-sandbox-testing.md)。优先级沿用调查的 P0 / P1 / P2：P0 = 不解决就无法把 E2E 当长期工程运行；P1 = 显著影响效率 / 可诊断性 / 数据可信度；P2 = 局部健壮性与体验。

| 行业模式（锚点） | 本仓现状（证据） | 差距 | 优先级 |
|---|---|---|---|
| [CI 分层](../industry-research/08-e2e-and-sandbox-testing.md#ci-layers)：PR smoke → merge queue → post-merge → nightly | `.github/workflows/` 只有 ci / deploy / release / workflow-lint 四份，全文检索 e2e / playwright 零命中；`apps/e2e/package.json` 刻意没有 `test` 脚本 | 没有任何 e2e 触发、artifact、失败可见性；E2E 的稳定性与时长无法被观测 | **P0** |
| [执行架构](../industry-research/08-e2e-and-sandbox-testing.md#execution-architecture)：认证复用、每测试唯一数据、shard | 单 worker、`fullyParallel: false`、`retries: 0`；每条 UI 用例重走 CAP + MFA；调查时点全量约十一次 UI 登录 | 时长随用例数线性增长；慢用例阻塞后续；无分片 | **P0**（瘦身）/ P1（隔离后并行） |
| [沙盒粒度](../industry-research/08-e2e-and-sandbox-testing.md#sandbox-patterns)与外部依赖 | 本地专用 PG / Redis + dist-stage + 静态代理；但 Phase0-4 依赖 api.ip.sb、UI CAP 依赖 jsDelivr WASM | 「离线可跑」的声明不成立；外部依赖是 flake 源 | **P0**（口径与用例标记） |
| [可观测性](../industry-research/08-e2e-and-sandbox-testing.md#execution-architecture)：trace、JUnit、artifact、失败归属 | reporter 只有 list + html；后端 webServer `stdout: 'ignore'`；无 junit / json；无 artifact | CI 无法机器解析结果；后端日志看不到；失败现场不可带走 | P1 |
| [契约测试](../industry-research/08-e2e-and-sandbox-testing.md#contract-testing)：OpenAPI 为真源 + 生成类型 | `5067b4aa` 已落地 contract bridge 与常量收口（断言不再用裸业务码）；`@walnut/api-types` 仍未使用 | 类型层没有生成物约束；响应体字段改名只能靠断言碰巧失败发现 | P1（剩余部分） |
| [测试数据管理](../industry-research/08-e2e-and-sandbox-testing.md#test-data)：基线 + 每测试唯一数据 + 重置 | 基线 sha + 迁移头 + 菜单行数；每设备唯一 IP；用户 CRUD 用唯一前缀 | 基线按整个 HEAD 判漂移；Redis 没有每轮对账；封板三件套非原子 | P1 |
| [选择性执行](../industry-research/08-e2e-and-sandbox-testing.md#ci-layers)：affected + 安全网 | 只能 `--project` / `-g`；只有 `@network` 一个标签 | 无法按改动选择；没有 `@smoke` / `@slow` / `@quarantine` | P1 |
| [Flaky 治理](../industry-research/08-e2e-and-sandbox-testing.md#metrics)：quarantine、p95 预算、失败归属 | `retries: 0`；`d720c0d3` 已给两条慢用例 `test.slow()`；仍无 quarantine 列表与等待总预算 | 有 flake 时只能人工看日志；没有「隔离—修复—恢复」流程 | P2 |
| [每 worker 隔离](../industry-research/08-e2e-and-sandbox-testing.md#execution-architecture) | 整库共享、单 Redis、单个后端进程 | 直接开 workers > 1 或 `--shard` 会互相污染 | P1（设计）/ P2（实施） |
| [环境粒度选择矩阵](../industry-research/08-e2e-and-sandbox-testing.md#sandbox-patterns) | 单机 compose + 一份 dist-stage；无 preview、无 namespace | 对「单体 + 单机 run」这是合理选择；差距不在能力，而在**别把微服务方案照搬进来** | 见第 4 节「不建议做」 |

---

## 3. 改造项

分期原则：**P0 先让 E2E「有证据、说真话」**；P1 修隔离、诊断、契约；P2 做健壮性与体验。每一项都给出动机（证据）、改法、验收、不变量兼容性、工作量级（S < 半天，M 1–3 天，L 一周以上）。

### 3.1 P0：先让它可运营

#### P0-1 接入 CI：nightly 全量 + 手动 dispatch

**对应**：计划页 §8.1。

**动机**

- `.github/workflows/` 下四份 workflow 全文检索 e2e / playwright 零命中；`apps/e2e/package.json` 没有 `test` 脚本，`turbo test --affected` 扫不到它（这是刻意的，见计划页 §2.1）。
- 于是当前 E2E 的稳定性、时长、失败原因**没有任何机器可读的记录**；U8 / U9 的 flake 只能靠本机日志（`apps/e2e/.e2e/` 下的一批 log）人工判断。
- 没有 artifact 就没有「失败现场可带走」；没有定时运行就没有「这套东西还在工作」的证据。

**改法**

1. 新增工作流文件 .github/workflows/e2e.yml（目标路径尚不存在，所以正文不加反引号）。触发条件只放 `schedule`（nightly）与 `workflow_dispatch`，**不加 `pull_request`**。
2. runner 用 `ubuntu-latest`，`timeout-minutes` 设 60（全量实测 4–7 分钟，留足 webServer 180s 与 install 时间；job timeout 必须明显大于 Playwright 的 `globalTimeout`）。
3. 数据栈用 job 级 `services`：`postgres:18-alpine` 发布 5433、`redis:8-alpine` 发布 6380，凭据与 `apps/e2e/scripts/env.ts` 逐字一致。service 容器在 ubuntu runner 上通过 localhost 可达，不需要 WSL 形态。
4. 步骤顺序：checkout（`fetch-depth: 0`，基线要读 git HEAD）→ setup node / pnpm → `pnpm install --frozen-lockfile` → 解密 env（复用仓库现有的 `ENV_KEYS` secret 写 `.env.keys`，再 `pnpm setup-env`）→ `pnpm build`（`@walnut/utils` 与 contract 的 CJS 产物，见 P1-2）→ `pnpm walnut build:stage` → `pnpm --filter @walnut/server build:stage` → `playwright install --with-deps chromium` → `pnpm walnut e2e`。
5. `concurrency` 用固定 group、`cancel-in-progress: false`：同一时间只允许一份 e2e 在跑，不取消在途。
6. **浏览器不缓存**：每次 `playwright install`。缓存坏了导致假红的排查成本高于下载时间。
7. 失败时上传 **junit** 与**脱敏后的后端日志**；trace / 截图 / HTML 报告默认不上传（§5.4）。
8. `secrets` 不写进 step / job 的 `if`（会被判 `Invalid workflow file`、启动即 0 job）；绑定到 job 级 `env`，在 step 里用 `env.XXX != ''` 判断。写法见 [env-management](../monorepo/env-management.md)。

workflow 骨架（占位符由实施时替换；`<...>` 是说明，不是可运行值）：

```yaml
name: E2E
on:
  schedule:
    - cron: '0 19 * * *'      # UTC 19:00 ≈ 北京时间 03:00
  workflow_dispatch:

concurrency:
  group: e2e-nightly
  cancel-in-progress: false

jobs:
  e2e:
    runs-on: ubuntu-latest
    timeout-minutes: 60
    env:
      ENV_KEYS: <从 secrets 绑定的 job 级 env，复用仓库现有的 ENV_KEYS>
    services:
      postgres:
        image: postgres:18-alpine
        env:
          POSTGRES_USER: walnut
          POSTGRES_PASSWORD: e2e_dev_only
          POSTGRES_DB: walnut_e2e
        ports: ['5433:5432']
        options: >-
          --health-cmd "pg_isready -U walnut"
          --health-interval 5s --health-timeout 5s --health-retries 10
      redis:
        image: redis:8-alpine
        command: ['redis-server', '--requirepass', 'e2e_redis_only']
        ports: ['6380:6379']
        options: >-
          --health-cmd "redis-cli -a e2e_redis_only ping"
          --health-interval 5s --health-timeout 5s --health-retries 10
    steps:
      - uses: actions/checkout@v5
        with: { fetch-depth: 0 }
      - uses: pnpm/action-setup@v5
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: Decrypt env
        run: |
          printf '%s' "$ENV_KEYS" > .env.keys
          pnpm setup-env
      - run: pnpm build
      - run: pnpm walnut build:stage
      - run: pnpm --filter @walnut/server build:stage
      - run: pnpm --filter @walnut/e2e exec playwright install --with-deps chromium
      - run: pnpm walnut e2e
      - name: Upload junit
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: e2e-junit
          path: apps/e2e/test-results/junit.xml
          retention-days: 7
```

**验收标准**

- 手动 dispatch 一次：job 全绿，junit artifact 可下载且能被 CI 的测试面板解析。
- 一次定时触发同样全绿；job 总时长记录在 run summary 里（作为后续时长预算的基线）。
- `pnpm walnut lint:workflows` 与 `pnpm walnut lint:workflows-shell` 通过。
- 失败注入一次（例如临时把某个断言改错）能拿到红色 junit 与后端日志；不需要登录 runner 复现。

**不变量兼容性**

- 不碰 1 / 2 / 3 / 4 / 5 / 7 / 9 / 10。
- 与 6 的关系：CI 每个 job 在独立 runner 上，天然一台机器一个 run；`concurrency` 固定 group 保证同一仓库不会并发两份。**不改变**「一台机器一个全量 run」的语义。
- 与 8 的关系：默认不上传 trace / 截图 / HTML，见 §5.4。

**工作量级**：M（工作流 + 首次跑通 + artifact 验证）。

**落地记录（2026-11-25）**：工作流落地为 `.github/workflows/e2e.yml`（`schedule` 每日 UTC 19:00 ≈ 北京 03:00 + `workflow_dispatch`，`concurrency` 固定 group、不取消在途，`ubuntu-latest`、`timeout-minutes: 60`；job 级 `services` 起 `postgres:18-alpine` / `redis:8-alpine`，端口 5433 / 6380、凭据与 `apps/e2e/scripts/env.ts` 逐字一致）。与草案的三处**事实修正**（实施时读代码 / 过 actionlint 才发现，均已写进 workflow 文件头注释）：

1. **services 不支持 `command:`**（GitHub 的 services 只认 image / env / ports / volumes / options，actionlint 判非法）—— 草案里的 `command: ['redis-server', '--requirepass', …]` 用不了，官方 redis 镜像也没有「env 设密码」的入口。做法：多一步 `docker exec <service 容器> redis-cli CONFIG SET requirepass e2e_redis_only`（容器名由 runner 生成，按镜像名定位）；health check 写成 `redis-cli -a … ping || redis-cli ping`，设密码前后都成立。
2. **CI 上必须 `E2E_SKIP_BASELINE=1`**：封板 / 恢复的 `pg_dump` / `pg_restore` 在本机是 `wsl -e bash -c "docker exec e2e-wsl-postgres …"`（`apps/e2e/scripts/baseline.ts` 的 `PG_CONTAINER`），而 runner 上既没有 WSL、也没有这个容器名。所以「无基线 → 自动全量 prepare + seal」这条路径**在 GitHub 上不成立**：seal 那一步必然失败。工作流显式跳过基线、每轮全量 prepare（测试栈秒级）；把容器名参数化是 P1-1 的范围，本工作流不越界。
3. **artifact 严格口径**（所有者 2026-11-25 拍板）：只上传 junit / results.json / 脱敏 backend.log / stack.json / 基线清单五样，一个 `upload-artifact@v4` 步骤、`retention-days: 7`、`include-hidden-files: true`（`stack.json` 与基线清单在 `.e2e/` 点目录里，默认会被跳过）；trace / 截图 / HTML 报告**一律不上传**。上传前另有 `apps/e2e/scripts/redact-log.ts` 兜底脱敏（`if: always()`）。

步骤顺序按草案：checkout（fetch-depth 0）→ pnpm/action-setup + setup-node 24（cache pnpm）→ `pnpm install --frozen-lockfile` → env 解密（secret 绑 **job 级 env**，step 里 `printf` 写 `.env.keys` → `pnpm setup-env` → 立即 `rm`）→ `pnpm build`（utils / contract 的 CJS dist 是硬前置）→ 两处 stage 构建 → `playwright install --with-deps chromium`（**不缓存**）→ `CONFIG SET` 设 redis 口令 → `pnpm walnut e2e`。`pnpm walnut lint:workflows`（actionlint）与 `lint:workflows-shell`（逐块 `bash -n`）在本地跑绿。**本机没有 GitHub runner，工作流尚未做过真实首跑**；首跑前按可能性排序的已知风险：

1. **`pnpm build` 的时长**：它会连文档站一起构建（VitePress 死链门禁），install + build 可能占掉预算的一大半；若 job 接近上限，先把 docs 排除出这条路径，而不是抬 `timeout-minutes`。
2. **services 镜像 tag**：`postgres:18-alpine` / `redis:8-alpine` 必须仍可拉取；镜像大版本更新后健康检查命令与初始化行为可能变。
3. **`CONFIG SET requirepass` 那一步**：依赖 runner 上 `docker ps` / `docker exec` 可用，且本 job 只有一个 `redis:8-alpine` 容器；它排在 e2e 之前，坏了会先红、定位直接。
4. **`setup-env` 对 secret 的依赖**：`ENV_KEYS` 必须与本地 `.env.keys` **全文一致**（多行、含各环境密钥行）；轮换密钥后忘记同步 secret 会在这里失败（`::error::` 文案已指向它）。
5. **首轮必然全量 prepare**（没有基线）：`E2E_SKIP_BASELINE=1` 与 `--rebuild-baseline` / `E2E_REBUILD_BASELINE=1` 互斥，别在 workflow 里同时给。
6. **`@network` 用例依赖 api.ip.sb**：runner 出网策略变化会让 U1b 红 —— 那是这条用例的设计意图（证明真实定位），不是 flake；离线 / 内网 runner 上才考虑只跑 `--project=risk`。

---

#### P0-2 修正离线口径：把外部依赖从默认路径里拿掉

**对应**：计划页 §2.5、§7；调查的 P0-3。

**动机**

- `apps/e2e/tests/risk/device.spec.ts` 的 Phase0-4 用 XFF `1.1.1.1` 打 `/api/system/device/initial`，注释写「本机离线时这条仍应成立（只查库与缓存）」。但后端 `IpMiddleware` 把 XFF 当 `realIp`，非 local IP 会走 `getLocationInfoFromFreeAPI` → `https://api.ip.sb/geoip/1.1.1.1`；失败被 `device.service.initial` 的 catch-all 映射成 40605，用例期望 20000 ⇒ **离线必红**。
- risk 的 UI 登录用例（U8 / U9 / ban / lock / DEVICE_NEW / DEVICE_RECENT）都要过 CAP，而 `apps/admin/src/store/modules/component/comp-capjs.ts` 把 `CAP_WASM_URL` 指向 `https://fastly.jsdelivr.net/npm/@cap.js/wasm@0.0.6/browser/cap_wasm.min.js`；断网时 cap-widget 进错误态，`solveCapIfPresent` 等不到可点 widget。
- 结论：当前「`e2e:risk` 离线全绿」的声明与事实不符。这不是小瑕疵 —— 它会让「本地没网也能跑」的承诺在 reviewer 那里失去可信度。

**改法（推荐：两条都修，让 risk 真离线）**

1. **Phase0-4 改成离线可跑**：XFF 从 `1.1.1.1` 换成 `uniqueLocalIp()`（127/8）。后端对 local IP 跳过 geo 查询，但仍会把 XFF 写进 `sys_device.ip`、仍会按该 IP 记 `risk:rate:ip:*` —— 这正是这条用例要证明的「静态代理保留 XFF」，且不依赖外网。
   - 原来的公网 IP + 真实定位场景已经由 U1b（`@network`）覆盖，不需要在 risk 里重复。
   - 用例注释同步改写，别再写「仍应成立」这种与实现矛盾的句子。
2. **CAP WASM 本地化**：把 `@cap.js/wasm` 固定到与 CDN 同一版本（catalog 增加一项），在 `apps/e2e/lib/ui.ts` 的 `loginViaUI` 之前用 `page.route` 拦截 jsDelivr URL，从本地安装包的 `browser/cap_wasm.min.js` `route.fulfill({ path })`。
   - 这是**测试侧的请求重定向**，不改 admin 源码、不改生产行为；跨域请求本来就不带 XFF（`installRealIpRoute` 只对同源 `/api/` 生效），不会碰不变量 2。
   - 如果所有者不接受新增一个依赖：退路是把口径改成「离线只保证 protocol-only 子集」，并在 README / 计划页写明哪些用例需要外网 —— **但不建议**，因为 CAP 是登录链路的核心，长期依赖 CDN 会给 nightly 引入一个不可控的 flake 源。
3. README 与计划页的离线表述同步成事实：离线跑 `e2e:risk`（CAP WASM 本地化后成立）；`e2e:network` 需要外网，离线必红是预期。

**验收标准**

- 断网（或屏蔽 api.ip.sb / jsdelivr）后 `pnpm walnut e2e:risk` 全绿；`pnpm walnut e2e:network` 红且失败信息能指出外网不可达。
- Phase0-4 的断言仍然证明「静态代理保留 XFF」：把 `apps/e2e/scripts/static-server.ts` 改成覆盖 XFF（故意破坏）后该用例必须红（负对照）。
- 恢复网络后全量 `pnpm walnut e2e` 全绿。

**不变量兼容性**

- 不碰 1（UA 唯一）、3（库准备时序）、4（4/60s per realIp）、5（Redis 精确删）、6（单 run）、7（storageState 判死）、8（trace 不上传）、9（CAP 放宽只改库）、10（设备清理归 fixture）。
- 2（XFF 只加同源 `/api/`）：`page.route` 拦截的是跨域 WASM 请求，**不加 XFF**；`installRealIpRoute` 保持只匹配 `WEB_ORIGIN + /api/`。
- 注意：本地化 WASM 不是「改 CAP 难度」，不涉及不变量 9 的「放宽只改库」。

**工作量级**：S–M（Phase0-4 改动小；WASM 本地化需要加依赖 + 路由 + 验证）。

**落地记录（2026-11-25）**：改法的第 2 条按**所有者决策**替换 —— 不用 e2e 侧 `page.route` 拦截 jsDelivr，改为 **admin 自托管 WASM**（生产行为变更，所有者已批准；自托管后登录链路根本不请求外网，测试侧无需任何拦截）。落地：`@cap.js/wasm@0.0.6` 的 `browser/cap_wasm.js` + `cap_wasm_bg.wasm` 逐字节 vendor 到 `apps/admin/public/vendor/cap/`（同目录 README 记版本 / 上游 / 日期 / sha256，并写明升级时两个文件必须一起换）；`CAP_CUSTOM_WASM_URL` 改为 `${location.origin}/vendor/cap/cap_wasm.js`（blob worker 要求绝对 URL，同源即可）。第 1 条 Phase0-4 改用 `uniqueLocalIp()`，断言不弱化：`sys_device.ip` 逐字等于注入的 127.0.0.x（代理丢头会退化成 127.0.0.1 ⇒ 必红）、定位走 LOCAL 分支、rate 按归一后的 127.0.0.1 记账。实测：断网负对照（浏览器侧 abort `*.jsdelivr.net` / `api.ip.sb`，服务端 `HTTP(S)_PROXY` 指向死端口）下 `e2e:risk` **9/9 全绿、2.1 分钟**，浏览器侧命中拦截的请求 **0 次**；同条件 `e2e:network` 红（U1b 的 `device/initial` 因定位不可达返回 40605），证明外网依赖只剩 `@network`。恢复网络后全量（`--rebuild-baseline`，13 例）**2.8 分钟全绿**。提交 hash 见 `git log`（本行随该提交入库，无法自引用自身的提交 hash）。

---

#### P0-3 UI 登录瘦身：把重复登录压掉

**对应**：计划页 Phase 2 的「执行时长」隐含目标；调查的 P0-2 / P1-3。

**动机**

- 调查时点全量约十一次 UI 登录（auth-setup 一次、home 一次、login 一次、U8 一次、U9 一次、ban 一次、lock 一次、DEVICE_NEW 两次、DEVICE_RECENT 两次），每次 15–25 秒。UI 登录（CAP + MFA）是第一大瓶颈；数据库准备只占 1.5–3.5 秒，**优化 DB 重置对总时长几乎没有帮助**。
- `apps/e2e/tests/setup/auth.setup.ts` 与原 smoke 的 login.spec（P0-3 已合并删除）的断言高度重叠：都验证离开登录页、sidebar、CAP 解出、MFA 通过、cookie 形态、localStorage 一致；login.spec 额外验证 `device/initial` 20000、`/auth/permissions` 20000、PG 行。
- `apps/e2e/tests/smoke/home.spec.ts` 用 `ensureLoggedIn` 再登录一次，只为做只读断言（菜单项、标题、权限请求、cookie 存在）。

**改法（按收益排序，逐条可独立落地）**

1. **合并 auth-setup 与 login.spec**：把 login.spec 独有的断言（`device/initial` 20000、`/auth/permissions` 20000、PG 行 active / banned / locked）并进 `auth.setup.ts`，删除 login.spec。auth-setup 继续作为 smoke 的 dependency，只做一次完整 UI 登录。省一次 15–25 秒。
2. **只读 smoke 共享一个 worker 级已登录 context**：给 smoke 增加一个 worker-scoped fixture（在 `apps/e2e/tests/fixtures.ts` 扩展），worker 启动时登录一次，提供 `authedPage`；home 这类只读用例用它，不再各自 `ensureLoggedIn`。
   - 这不是 storageState 复用：**不落盘、不跨进程**，只是同一 worker 内复用内存中的 browser context；不碰不变量 7。
   - 约束：共享 context 的用例必须是只读的；有写操作或需要「全新设备」语义的用例不要挂它。失败时仍能定位到具体断言。
3. **DEVICE_NEW / DEVICE_RECENT 从两次 UI 登录降到一次**：用协议客户端创建并登录设备（拿到服务端签发的 `DEVICE_ID` cookie 值），把该 cookie 注入浏览器 context，再回填 `created_at`、走一次 UI 登录触发 `DEVICE_NEW` / `DEVICE_RECENT`。省一次 15–25 秒 / 条。
   - 风险：cookie 注入要确认 stage 形态无前缀、`Secure` 在 `http://127.0.0.1` 可用的既有结论不变；如果注入后 UI 登录行为与「全新 context」不一致，退回两次登录，不要为了快伪造设备身份。
4. **ban / lock 合并为一条参数化或串行用例**：同一台 victim 设备先 ban 再 lock（顺序与清理在 `finally` 中做），省一次登录。若合并后失败定位变差，保持两条。
5. **协议优先**：能在 `WalnutProtocolClient` 完成的断言不要开浏览器（user-crud 已是范本）。浏览器只留给 CAP / MFA / 自愈 / 跳转 / 渲染这些必须 UI 的链路。

**验收标准**

- 同一台机器连跑 20 次全量，p95 从调查基线的 4.3–6.8 分钟降到 **≤ 3 分钟**；smoke 从约 1.3 分钟降到 **≤ 60 秒**（目标值按实测校准，不为了好看写死）。
- 每条被合并 / 瘦身的用例仍保留明确的失败判据；对关键断言做一次负对照（故意破坏被测行为必须红）。
- `pnpm --filter @walnut/e2e lint`、`types:check` 通过。

**不变量兼容性**

- 7（storageState 判死）：新增的 worker context 是**内存复用**，不写盘、不挂 project `storageState`；`auth.setup` 仍不产出可复用登录态。
- 4（4/60s per realIp）：合并后仍要为每个新设备 / 协议客户端分配独立 `uniqueLocalIp()`；共享 context 的只读用例不新增设备。
- 10（设备清理归 fixture）：注入 cookie 的设备也必须 `trackDevice`，由 fixture 清理。
- 1 / 2 / 3 / 5 / 6 / 8 / 9 不动。

**工作量级**：M（合并 + worker fixture + 两条 DEVICE 用例的改造；每步都可单独验证）。

**落地记录（2026-11-25）**：四步全部落地（`login.spec` 并入 `auth.setup` 并删除；worker 级共享只读 `authedPage`；DEVICE_NEW / DEVICE_RECENT 改为协议客户端预置设备 + 注入 `DEVICE_ID` cookie + 一次 UI 登录；ban / lock 合并为同一台 victim 的串行用例）。提交为本页所在提交（`test(e2e): P0-3 …`；hash 见 `git log` —— 本行随该提交入库，无法自引用自身的提交 hash）。实测单次读数：全量 **2.9 分钟**（13 例；改造基线 4.3–6.8 分钟）、smoke **54.5 秒**（4 例；基线约 1.3 分钟）、risk **2.1 分钟**；UI 登录约 **11 次 → 7 次**。与验收标准的差距：单次读数已达到「全量 ≤ 3 分钟、smoke ≤ 60 秒」，但 **p95 需要 20 次循环**，本轮未做；DEVICE_NEW / DEVICE_RECENT 的 cookie 注入实测沿用预置设备（UI 登录后 `resolveDeviceId` 与预置 id 一致），未退回两次登录。

---

### 3.2 P1：隔离、诊断与契约

#### P1-1 基线漂移降噪、封板原子化与容器参数化

**对应**：计划页 §8.4；调查的 P1-1 / P2-1。

**动机**

- `apps/e2e/scripts/baseline.ts` 的 `baselineUsable()` 把 `gitCommit` 与当前 HEAD 比较，**任何提交（包括只改文档）都会让本地基线失效**，下次 run 退出码 2。调查时点就出现了「HEAD 前进到 `b21ac118`、manifest 仍是 `4ca33123`」的现成例子。
- 漂移只比 HEAD，未提交的迁移 / seed 改动判不出来；反过来，与数据无关的提交又会让基线失效 —— 两个方向都不精确。
- `sealBaseline()` 先原子 rename dump，再写 credentials，再写 manifest；中途失败可能留下「新 dump + 旧清单」或「新凭据 + 旧清单」。sha 校验大概率能发现，但仍是可改进点。
- `PG_CONTAINER = 'e2e-wsl-postgres'` 写死，通用 compose 用户只能 `E2E_SKIP_BASELINE=1`。

**改法**

1. **把漂移判据从「整个 HEAD」换成「数据树哈希」**：对 `apps/server/db/seed/`、迁移目录、`apps/e2e/scripts/prepare-db.ts` 求树哈希（`git rev-parse HEAD:<path>` 组合后 sha256），写进 manifest 的新字段 `dataKey`；`gitCommit` 保留作展示。
   - 同时检查这些路径的**工作区脏状态**（`git status --porcelain -- <paths>`）：脏 ⇒ 退出码 2 并提示 `--rebuild-baseline`（因为「用旧数据跑新 schema」比多跑一次 prepare 更危险）；只改文档 / 前端 ⇒ 不触发漂移。
   - 这是对「数据版本变了必须是显式动作」的加强，不是放宽。
2. **封板原子化**：把 dump 的 sha、credentials 的 sha、manifest 字段收进**一个** meta 文件，先写临时文件再 `rename`；restore 时只认 meta 且逐个校验 sha。manifest 版本号 +1，旧版本直接判「不可用」并提示重新封板。
3. **容器名参数化**：`E2E_PG_CONTAINER`（默认 `e2e-wsl-postgres`）；preflight 增加 `docker inspect` 可读性检查，失败信息给出两种 compose 的启动命令。
4. **可选**：`run.ts` 检测到 drifted 时打印一行「一条命令重建」的提示（不自动 rebuild，保持显式动作语义）。

**验收标准**

- 只改文档提交后，`pnpm walnut e2e` 直接 restore，不退出 2。
- 改一条 seed 行（不提交）后，run 退出 2 并明确提示 `--rebuild-baseline`。
- 在 seal 过程中 `kill -9`（或用测试注入在写 meta 前抛错），下一次 run 拒绝使用半成品，且给出可操作提示；不存在「新 dump 配旧凭据」的组合。
- 通用 compose 下设置 `E2E_PG_CONTAINER` 后能封板 / restore。

**不变量兼容性**

- 3（库准备时序）：不变，仍在 playwright 前。
- 5（Redis 精确删）：不变。
- 6（单 run）：不变，锁仍整轮持有。
- 9（CAP 放宽只改库）：不变，快照内容不变。
- 其余不碰。

**工作量级**：M。

**落地记录（2026-11-25）**：四条改法全部落地（提交 `test(e2e): P1-1 基线 dataKey 漂移判据、封板原子化与 PG 容器参数化`，hash 见 `git log`）。口径与关键读数：

1. **漂移判据 = dataKey + 数据路径脏**：`apps/e2e/scripts/data-key.ts` 对 `DATA_PATHS`（seed 目录、迁移目录、`apps/e2e/scripts/prepare-db.ts`、`tooling/scripts/src/db` 下的 seed / 口令 / app_key 工具）按路径排序后逐行 `<path>\t<treeHash>` 求 sha256；`gitCommit` 降级为展示字段。只改文档 / 前端 / 后端源码不再触发；数据路径有未提交改动（含未跟踪文件）⇒ 退出 2 并提示 `--rebuild-baseline`。封板时脏 ⇒ 清单记 `dataDirty=true`，之后永远判不可用（那份数据无法证明与仓库一致）。
2. **封板原子化（manifest v2）**：`baseline.manifest.json` 收进 `dataKey` / `dataDirty` / `dumpSha256` / `dumpBytes` / `credentialsSha256` / `credentialsBytes` / `migrationsHead` / `menuRows`；dump / credentials / 清单先各写 `.tmp`，提交时**先撤旧清单、再逐个 rename**。**v1 清单不迁移**：版本不符直接判不可用并提示重封板（旧清单没有 dataKey 与 credentials 的 sha，无法安全恢复）；「有 dump 没清单」的半成品同样拒绝。
3. **容器参数化**：执行层抽到 `apps/e2e/scripts/pg-container.ts` —— `E2E_PG_CONTAINER`（默认 `e2e-wsl-postgres`）、`E2E_PG_EXEC_MODE=wsl|docker|auto`（win32 默认经 `wsl -e bash -c "docker exec …"`，其它平台直接 `docker exec`）；preflight 增加 `docker inspect` running 检查，失败给两种 compose 的启动命令。CI 在 `CI=true` 且非 WSL 投递时按镜像 `postgres:18-alpine` 解析 service 容器。
4. **单测**：`data-key.test.ts` / `baseline-manifest.test.ts` / `pg-container.test.ts` 覆盖树哈希组合、清单形态、平台判断、WSL 路径换算与容器名校验。

**实测（2026-11-25 本机 WSL 栈）**：全量两轮 **244s / 227s**；restore **1.5–2.3s**（相对 4 分钟量级的总时长仍是噪声，§1.3 的优先级判断不变）。只改文档后直接 restore、不退出 2；改一条 seed 行（不提交）⇒ 退出 2 并明确提示 `--rebuild-baseline`。

**CI 切回基线路径的前置条件**（`.github/workflows/e2e.yml` 文件头已写）：删掉 `Run full e2e` 一步的 `E2E_SKIP_BASELINE: '1'` 即可 —— 执行层可移植（容器解析 / 平台判断 / postgres 官方镜像自带 `pg_dump` 与 `pg_restore`）已由本条落地。**注意 `.e2e/` 不跨 run 缓存**：切回后每轮都是「无基线 → 全量 prepare + seal」，想验证 restore 路径要另加 cache / artifact 步骤。本条只把「能切」变成事实；切不切是单独的决策。

---

#### P1-2 前置一致性：`E2E_REUSE_SERVER`、隐藏的 `pnpm build`、文件权限

**对应**：调查的 P1-2 / P1-7 / P2-5。

**动机**

- `apps/e2e/scripts/preflight.ts` **无条件**检查 3001 / 3002 / 4173 空闲；而 `E2E_REUSE_SERVER` 只在 `apps/e2e/playwright.config.ts` 读取。结果：`E2E_REUSE_SERVER=1 pnpm walnut e2e` 在 preflight 就退出 2，文档里的逃生口经 `run.ts` 不可用。
- `apps/e2e/lib/protocol/sign-raw.ts` 明确要求 `@walnut/utils` 的 CJS dist（`pnpm build` 的产物）；`5067b4aa` 新增的 `apps/e2e/lib/protocol/contract.ts` 又要求 `@walnut/contract` 的 `dist/index.cjs`。README 的四步前置里没有 `pnpm build`。新机器按文档操作会在 webServer 启动时 `require` 失败，Playwright 报 webServer 超时（180 秒），而不是 preflight 的退出码 2。
- `apps/e2e/scripts/prepare-db.ts` 写 `apps/server/env-local/.env.e2e` 时没有 `mode: 0o600`，文件含 DB 口令且会留在盘上。

**改法**

1. **preflight 尊重复用开关**：`E2E_REUSE_SERVER=1` 时跳过三个端口的「空闲」检查，改为「可达 + 身份」检查（后端 `/health/ready` 200、4173 返回 index.html），并打印一条警告：本轮可能连到旧产物 / 旧库，仅本地调试用。
2. **把 `pnpm build` 变成显式前置**：
   - README 的前置命令加 `pnpm build`（或 `pnpm --filter @walnut/utils --filter @walnut/contract build`；contract bridge 已在 `5067b4aa` 落地，两个 dist 都是硬前置）。
   - preflight 增加产物检查：`packages/platform-any/utils-core/dist/sign-raw.cjs` 与 `packages/platform-any/contract/dist/index.cjs` 存在。缺了就给退出码 2 与修复命令。
   - 更彻底的做法：根 `turbo.json` 的 `build:stage` 任务 `dependsOn` 增加 `^build`，让 stage 构建自动产出依赖包的 CJS dist。改之前先确认不会让 admin 的 stage 构建重复构建依赖（用 `--dry=json` 看任务图）。
3. `.env.e2e` 写 `{ mode: 0o600 }`；如果 typeorm CLI 每次重建都会写，就在 prepare 完成后也删掉（与 `.e2e/e2e.env` 同处置）。
4. **可选**：新增 `pnpm walnut e2e:doctor`（命令表 `tooling/scripts/src/lib/commands.ts` 加一项），把 preflight 的全部检查 + 修复命令一次打印，不抢锁、不动库。

**验收标准**

- `E2E_REUSE_SERVER=1 pnpm walnut e2e:smoke` 能在已起后端 / 静态代理的机器上跑完，且打印复用警告。
- 干净检出按 README 前置执行后，第一次 run 不会卡在 webServer 超时；缺 `@walnut/utils` dist 时 preflight 以退出码 2 明确报出。
- `.env.e2e` 权限为 0600（Windows 上至少记录「该文件含口令，勿提交」的说明；POSIX 平台用 `stat` 验证）。

**不变量兼容性**

- 6（单 run）：复用模式下仍持有 advisory lock，不并发。
- 3（库准备时序）：不变。
- 其余不碰。

**工作量级**：S。

**落地记录（2026-11-25）**：1–4 全部落地（提交 `test(e2e): P1-2 preflight 尊重复用开关、build 产物前置与 .env.e2e 权限`，hash 见 `git log`）。

- **`E2E_REUSE_SERVER` 可用**：`apps/e2e/scripts/preflight.ts` 读同一个开关 —— 打开时跳过三个端口的「空闲」检查，改为「可达 + 身份」（后端 `/health/ready` 200、4173 返回含 `<div id="app">` 的 index.html、3002 可达）并打印复用警告。经 `apps/e2e/scripts/run.ts` 的路径与直接 `playwright test` 的路径口径一致；缺任一服务时 preflight 按退出码 2 失败并给出手动启动命令。
- **`pnpm build` 从隐式前置变成显式检查**：preflight 检查 `@walnut/utils` 的 `dist/sign-raw.cjs` 与 `@walnut/contract` 的 `dist/index.cjs`，缺任一 ⇒ 退出码 2 并给出 `pnpm build` 修复命令（之前缺了只在 webServer 启动时报 180s 超时）。README 的四步前置同步补上 `pnpm build`。
- **`.env.e2e` 权限**：prepare-db 写 `apps/server/env-local/.env.e2e` 用 `{ mode: 0o600 }`，文件头写「勿提交」，迁移一结束（含失败路径）即删。**Windows 上 Node 的 `mode` 基本不生效**（NTFS 不以 POSIX mode 表示权限），所以 Windows 上靠「gitignored + 生命周期极短」兜底，POSIX 上用 `stat` 核对（README 已写）。
- **`pnpm walnut e2e:doctor` 已建**：命令表条目 + `preflight.ts --doctor`；只做前置自检（不抢锁、不动库、不起服务），失败仍按退出码 2，并在结果列表里就地打印每条失败的处置 —— 适合排障时反复跑。

---

#### P1-3 失败可诊断性：junit / json、后端日志、现场 attach、产物新鲜度

**对应**：调查的 P1-5 / §9.6。

**动机**

- reporter 只有 `list` + `html`（`apps/e2e/playwright.config.ts`）；CI 无法机器解析，失败只能人工看 HTML。
- webServer 的后端 `stdout: 'ignore'`、静态代理同样 `stdout: 'ignore'`；后端启动日志、请求日志基本看不到，排障只能靠手工捕获的 `.e2e/backend-*.log`。
- `stack.json` 记了产物真实 mtime，但 preflight 只 `existsSync`，不比较新旧；调查时点 `server/main.js` 比 `admin/index.html` 旧一天也没有告警。
- 失败用例不会自动 attach `stack.json`、基线清单、最近的业务响应（envelope），「这一轮用的是哪个 commit / 哪个数据版本」不可追溯。

**改法**

1. **reporter 增加 junit 与 json**：
   ```ts
   reporter: [
     ['list'],
     ['html', { outputFolder: 'playwright-report', open: 'never' }],
     ['junit', { outputFile: 'test-results/junit.xml' }],
     ['json', { outputFile: 'test-results/results.json' }],
   ],
   ```
   junit / json 不含请求头与响应体，可上传；HTML / trace / 截图仍只留本机。
2. **后端日志落盘**：新增一个启动包装脚本 apps/e2e/scripts/start-backend.ts（目标路径尚不存在，正文不加反引号），spawn `pnpm run start:stage`，把 stdout / stderr tee 到 `test-results/backend.log` 与控制台；`webServer.command` 改指向它。日志写入前做一次脱敏（`Authorization`、`Cookie`、`x-sign`、`CAPJS_TOKEN`、`DEVICE_ID` 的值替换为 `<redacted>`）。
3. **失败现场 attach**：在 `apps/e2e/tests/fixtures.ts` 的 test-scoped auto fixture 里，`testInfo.status !== 'passed'` 时 attach：
   - `stack.json`（不含密钥；`credentialsFile` 只记路径）；
   - `baseline.manifest.json`（sha、迁移头、菜单行数）；
   - 最近若干条业务响应（`captureEnvelopes` 的 entries，已在 `apps/e2e/lib/ui.ts` 采集；需要把它暴露成可读结构）。attach 前对 `data` 里疑似 token 的字段做白名单化，或只 attach `code / msg / url / status`。
4. **产物新鲜度检查**：preflight 计算 `git log -1 --format=%ct -- apps/admin/src apps/server/apps apps/server/libs packages` 的时间，与 `dist-staging/index.html` / `dist-stage/apps/api/src/main.js` 的 mtime 比较；产物更旧 ⇒ 警告（不退出），并在 `stack.json` 里记 `artifactAgeMinutes`。
5. **`loginViaUI` / `waitForEnvelope` 失败上下文**：超时错误里带当前 URL、标题、最近 N 条 envelope、CAP widget 状态、localStorage 设备 id；不要只抛「等不到」。

**验收标准**

- 故意让一条用例失败：`test-results/junit.xml` 与 `results.json` 生成；失败用例的附件里有 stack / baseline / 最近响应；`backend.log` 有该轮后端输出且敏感值已脱敏。
- 产物过期时 preflight 打印明确警告；`stack.json` 里有 `artifactAgeMinutes`。
- junit 能被 GitHub Actions 的测试结果面板或 `dorny/test-reporter` 解析。

**不变量兼容性**

- 8（trace / 截图 / HTML 不上传）：junit / json / 脱敏日志不含 token，可上传；trace / 截图 / HTML 仍只留本机。**脱敏脚本必须默认失败即不上传**（宁可少 artifact，不可泄露）。
- 其余不碰。

**工作量级**：M。

**落地记录（2026-11-25）**：五项全部落地（提交 `test(e2e): 可诊断性——…`，hash 见 git log）。逐项口径：

1. **reporter**：`playwright.config.ts` 的 reporter 现在是 `list` + `html`（`open: 'never'`，只留本机）+ `junit`（`test-results/junit.xml`）+ `json`（`test-results/results.json`）；三处路径都从 `apps/e2e/scripts/env.ts` 的 `TEST_RESULTS_DIR` 派生（`outputDir` 同源），不再各写一遍。
2. **后端日志落盘**：新增 `apps/e2e/scripts/start-backend.ts` 作为后端 `webServer.command`（`cwd` 用 `apps/e2e`，脚本自己把子进程 cwd 设成 `apps/server`）。它 spawn `pnpm --silent run start:stage`，把 stdout/stderr **按整行** tee 到控制台与 `test-results/backend.log`，写入前过 `lib/redact.ts` 的 `redactText`（Authorization / Cookie / Set-Cookie / x-sign / 密码 / token / session / `d1_` 设备 id / JWT / `s:` 签名 cookie）。按整行处理是关键：值不跨换行，半个 token 落在两次 chunk 里就匹配不到。**静态代理不套包装**：它只打印一行启动日志、不含请求头与响应体，失败走 stderr（本来就 `stderr: 'pipe'` 转给 reporter）；给它单开日志只会多一个「要不要上传」的口子。
3. **失败现场 attach**：`tests/fixtures.ts` 的 test 作用域 auto fixture 在 `testInfo.status` 不是 `passed` / `skipped` 时 attach 三份：`stack.json`（字段白名单 + `credentialsFile` 只留路径）、`baseline-manifest.json`（sha / 迁移头 / 菜单行数）、`recent-envelopes.json`（最近 20 条，只取 url/status/code/msg，无响应体）。**按 `path` attach**（先写进用例 output 目录）而不是 `body`：body 只活在 reporter 内存里，junit 不列、盘上没有文件，取证与负对照都无从谈起。内容统一过 `redactDeep`（字符串值走文本规则、敏感 key 的值整段丢弃，输出仍是合法 JSON）。
4. **产物新鲜度**：新增 `apps/e2e/scripts/freshness.ts`（`git log -1 --format=%ct -- apps/admin/src apps/server/apps apps/server/libs packages` vs 两处产物 mtime）。preflight 只**警告**（存在「故意验证旧产物」的合法用法），`stack.json` 增加 `freshness`：`sourceCommitAt` / `artifactAgeMinutes`（now − mtime）/ `artifactLagMinutes`（落后源码多少分钟，> 0 才告警）。实测本机旧产物场景（server `main.js` 比 admin 产物旧一天）现在会打 WARN。
5. **失败上下文**：`waitForEnvelope` 超时、`loginViaUI` 失败、`ensureLoggedIn` 的等待超时、`waitForDeviceHealSettled` 的两处硬失败都带：当前 URL、页面标题、cap-widget 状态（不在 DOM / 可见未解出 / 不可见）、localStorage 设备 id、最近 12 条业务响应（method/url/status/code/msg，URL 与 msg 过脱敏）。取值全部尽力而为：page 已关闭只让对应行退化成「不可读」，绝不让取证本身抛错。顺带修正 `captureEnvelopes` 的采集面：**只收同源 `/api/` 的 JSON**（Sentry / iconify 这类第三方 JSON 会把「最近 12 条」挤成它们的请求序列）。

**新增单测**（仓库纪律：新增纯函数必须补测试）：`lib/redact.test.ts`（11 条：各类敏感值 / 不误杀 / 幂等 / `redactDeep` 不改入参）与 `apps/e2e/scripts/freshness.test.ts`（4 条）。e2e 包因此新增了**最小 vitest 配置**（`vitest.config.ts`，共享预设 + `coverageInclude: false`，只收 `*.test.ts`）与 `test` 脚本 —— Playwright 的 `*.spec.ts` 仍只经 `run.ts` 跑，两者发现规则物理分开；§2.1 说的「e2e 刻意没有 `test` 脚本」现在精确化为「**没有会跑 Playwright 的 test 脚本**」。

**实测（2026-11-25，本机 WSL 栈）**：负对照 —— 把 `tests/smoke/home.spec.ts` 的 `waitForEnvelope` 判据临时改成不存在的业务码 + 1s 超时 → `junit.xml`（4 用例、1 error）与 `results.json`（`stats.unexpected = 1`）生成且可解析；junit 的 `<error>` 里是完整失败上下文（URL / 标题 / cap-widget / 设备 id / 11 条业务响应）；用例 output 目录下 `stack.json` / `baseline-manifest.json` / `recent-envelopes.json` 三个附件与 `attachments/` 副本都在，junit 的 `[[ATTACHMENT|…]]` 也列全；`backend.log` 41 处 `<redacted>`，用失败消息里的**真实设备 id** grep 该日志 **0 次**，JWT / `d1_` 形态各 0 次。还原后 `e2e:smoke` 4/4 绿（52s）。全量 `--rebuild-baseline` **13/13 绿、3.5 分钟**（wall 221s，Playwright 自报 209.7s）；紧接着的 restore 轮 **13/13、202s**。最终提交后又复跑两轮：restore 轮 **13/13、237s**、`--rebuild-baseline` 轮 **13/13、305s**（后者是当天连续第三轮全量、机器负载偏高）。读数区间 **202–305s**；单条 UI 登录（CAP + MFA）仍是绝对大头（21–57s）。与 P0-3 那次 2.9 分钟读数的差异落在真实外网（`@network` / Sentry / iconify）与 UI 登录耗时上，**不是** reporter 或日志 tee：reporter 只多出 junit 3.6KB + results.json 22KB 的收尾序列化，backend.log 是 700KB 量级、按行同步写入。

---

#### P1-4 契约断言的剩余面：`@walnut/api-types` 泛型与关键端点结构断言

**对应**：计划页 §8.3 的 P2-9 / P2-10；调查的 P1-6。**状态：bridge 与常量收口已由 `5067b4aa` 落地**（`apps/e2e/lib/protocol/contract.ts`；cookie / 业务码 / 路由常量改从 contract 的 CJS 产物引入，knip 的未使用导出同步清理）。本条只剩「生成类型」这一半。

**动机**

- 断言侧的裸业务码已经收口；现在仍缺的是**响应体结构**的约束：`apps/e2e/lib/protocol/client.ts` 的 `request<T>` 用调用方手写的泛型，`@walnut/api-types`（openapi-typescript 生成物）完全未使用。
- 后果：后端给 `device/initial`、`user/list`、`auth/permissions` 的响应体改名 / 改嵌套时，E2E 的类型检查不会红；只有某条字段断言碰巧失败才会暴露。
- 已经有 `openapi:check` 零 diff 门禁保证「生成物与 server 一致」，所以这里只差「让 E2E 消费生成物」这一步。

**改法**

1. `apps/e2e` 增加 `@walnut/api-types` devDependency（纯类型、零运行时；不新增构建步骤）。
2. 给协议客户端的 `request<T>` 增加按路径 / 方法推导的泛型约束，例如用 `paths['/system/device/initial']['post']` 的响应体作为默认 `T`；调用点可以显式覆盖，但默认值来自生成物。
3. 对关键端点（device initial、user list、permissions）补字段级断言（`typeof data.id === 'string'`、数组长度、关键枚举），让「字段缺失」在断言层可读，而不只是类型层。
4. 不引入重型运行时 schema 校验：本仓已有 `openapi:check` 与 contract 快照测试；E2E 侧只做「关键字段存在 + 类型」级别，不加 zod / ajv 运行时依赖。
5. 不在 contract 里为 E2E 顺手加常量（会触发契约快照 diff）；contract 没有的前端页面路径 / 方法级后缀继续留在 E2E 侧组合。

**验收标准**

- `pnpm --filter @walnut/e2e types:check` 通过；把 `apps/server/openapi.json` 的一个响应字段改名并重新生成后，E2E 的类型检查能指出受影响的调用点。
- 关键端点的字段级断言存在，且故意删掉一个字段时用例会红。
- `rg "@walnut/api-types" apps/e2e` 命中 package.json 与至少一个类型导入点。

**不变量兼容性**

- 全部十条不碰。`@walnut/api-types` 是纯类型包，运行时零影响。

**工作量级**：S。

**落地记录（2026-11-25）**：改法 1–5 落地（提交 `test(e2e): P1-4 协议客户端接入 @walnut/api-types 生成类型与关键端点字段断言`，hash 见 `git log`）。

- **接入**：`apps/e2e` 增加 `@walnut/api-types` devDependency（纯类型、零运行时、不新增构建步骤）；`rg "@walnut/api-types" apps/e2e` 命中 `package.json`、`lib/protocol/api-types.ts` 与 `tests/system/user-crud.spec.ts`。
- **默认泛型来自生成物**：新增 `lib/protocol/api-types.ts` 的 `EndpointData<P, M>`（取 `paths[路径][方法]` 的 200 响应壳里的 `data`，去掉生成侧的可选）；`request` / `root` 改为重载 —— 路径是契约里的字面量常量时默认推导，动态拼接（含运行时 id）或需要覆盖时仍由调用方手写泛型。
- **三端点字段断言**：`device/initial`（`bootstrap()` 校验 `deviceId` 是非空 string）、`auth/permissions`（`permissionMenuTree` / `permissionRouteTree` / `permissionStrings` 为非空数组、`indexMenuName` 为 string、首条路由的 `path/name/component` 为 string）、`user/list`（`total` number、`data` 数组、行内 `id/userName/nickName/status/roles_count` 的存在与类型）。
- **负对照**：把生成物里的一个响应字段临时改名后跑 `pnpm --filter @walnut/e2e types:check` —— **三处报错**（`lib/protocol/client.ts` 的推导消费点、`tests/setup/stack.setup.ts`、`tests/system/user-crud.spec.ts`）；还原后全绿。这证明「字段改名」在类型层就能被指出来，不必等某条断言碰巧失败。
- **bridge 的两处显式补偿**（写进 `lib/protocol/api-types.ts` 注释，**不在 E2E 侧放宽断言**）：list 的路径级响应被 server swagger 多包了一层数组，所以 `SystemUserListPage` 显式取组件 `SysUserDTOSafeListResponse`；生成物把 list 行标成完整 `SysUserDTOSafe` 而真实行是字段子集，断言只碰实际下发的字段。偏差本身见 §3.3 的 P2 候选。

---

#### P1-5 选择性执行与标签：`@smoke` / `@risk` / `@slow` / `@quarantine`

**对应**：调查的 P1-8 / §9.8。

**动机**

- 目前只能按 project（`--project=smoke|risk|network`）或 `-g` 标题过滤；除了 `@network` 没有别的标签。
- 没有「改了 admin 登录页 → 跑 smoke；改了 server guards → 跑 risk；改了 seed / migrations → 强制 rebuild + 全量」的映射。nightly 只能全量，PR 侧没有任何轻量入口。
- Playwright 官方与 Meta / Datadog 的经验都指向「选择性执行 + 安全网」；本仓的判据是：**未知改动一律回退全量**。

**改法**

1. **补标签**：用例标题或 `test.describe` 上增加 `@smoke` / `@risk` / `@slow` / `@quarantine`；`@network` 保持现状。playwright 的 tag 选项与 `--grep` 二选一，实施时统一种写法。
2. **改动映射脚本**：新增 apps/e2e/scripts/affected.ts（目标路径尚不存在，正文不加反引号），读 `git diff --name-only <base>...HEAD`，按目录映射：
   - `apps/admin/src/views/auth/**`、`apps/admin/src/store/modules/**auth**` → smoke；
   - `apps/server/libs/{guards,system,ip}/**`、`apps/server/apps/api/src/middleware/**` → risk；
   - `apps/server/db/seed/**`、迁移目录、`apps/e2e/scripts/prepare-db.ts` → rebuild + 全量；
   - `apps/e2e/**` → 全量；
   - 只改 `apps/docs/**` / `*.md` → 跳过（打印理由）；
   - **其他任何路径 → 全量**（安全网）。
3. **命令入口**：命令表加 `e2e:affected`（或环境变量 `E2E_AFFECTED=1`），只打印计划并执行对应 project；**不进 PR 门禁**，先作为本地与 nightly 的辅助。
4. **定期全量校验**：nightly 永远全量；每周至少一次「affected 计划 vs 全量结果」的人工对账，记录漏测。

**验收标准**

- 改一条 admin 登录相关文件，脚本给出 smoke；改一条 seed，脚本给出「rebuild + 全量」；改一个未知路径（如根 `package.json`），脚本回退全量。
- 只改文档时脚本打印「跳过 E2E」且退出 0。
- 脚本的映射表有单测（纯函数，符合仓库「新增纯函数必须补测试」的纪律）。

**不变量兼容性**

- 6（单 run）：affected 仍走 `run.ts`，锁不变。
- 其余不碰。

**工作量级**：S–M。

**落地记录（2026-11-25）**：1–4 落地（提交 `test(e2e): P1-5 用例标签体系与 e2e:affected 选择性执行`，hash 见 `git log`）。

- **原生 tag 体系**：统一用 Playwright 原生 tag（`test(...)` / `test.describe(...)` 的 `{ tag: '@…' }`），不写标题文字 —— tag 在 junit / JSON report 里是独立字段，`--grep` 也按它匹配。落点：`@smoke`（首页只读、用户 CRUD）、`@risk`（设备生命周期整组，挂在 `test.describe` 上）、`@slow`（两条回填 `created_at`，同时有 `test.slow()`）、`@network`（U1b，仍由 network project 的 `grep` 选中、risk 的 `grepInvert` 排除）、`@quarantine`（**只建机制**：挂上即可用 `--grep @quarantine` 单独选中；不建列表、不自动从全量剔除 —— 列表与流程属 P2-1）。
- **`e2e:affected` 映射与安全网**：`apps/e2e/scripts/affected.ts`（git 读取 + 打印计划 + 经 `apps/e2e/scripts/run.ts` 执行）与 `apps/e2e/scripts/affected-plan.ts`（纯映射，单测 `affected-plan.test.ts` 钉住每条判定与路径归一）。判定顺序：数据路径 ⇒ `--rebuild-baseline` + 全量；`apps/e2e/**` ⇒ 全量；只改文档 ⇒ 跳过（退出 0）；admin 登录 / auth ⇒ smoke；server guards / system / ip / middleware ⇒ risk；**其它任何路径 ⇒ 全量**。base 默认 `origin/main`，可 `--base` / 位置参数；base 不存在按退出码 2 并给修复建议。执行仍经 `apps/e2e/scripts/run.ts`，抢锁 / 基线决策 / 单 run 不变量不变，**不进 prepush 与 PR 门禁**。
- **实测（2026-11-25 本机）**：`--grep @smoke` 命中 **4 例**（含 `stack-setup` / `auth-setup` 两个 dependency）、**49.2s**；`--project=risk --grep @slow` 可单独选中两条慢用例（`@risk` 挂在 `describe` 上、`@slow` 挂在用例上，两者叠加不影响 `--grep` 命中）。

---

#### P1-6 并行隔离设计：先设计，不急着开 workers

**对应**：计划页 Phase 2 的「逐 worker 账号」与 Phase 3 的「worker 账号池」；调查的 §9.1 / §11。

**动机**

- 当前整库共享、单 Redis、单个后端进程；`workers: 1` 是**正确**的现状选择。直接开 `workers > 1` 或 `--shard` 会让设备 ban / lock、risk rate、app setting、MFA trusted 互相污染。
- 调查时点 15 个用例已经 4–7 分钟；Phase 2 要加 U11–U16、Phase 3 要加菜单 / 角色 / 设置等模块，线性增长会到十几分钟。nightly 能接受，但 PR 侧若要 smoke 就必须先把「可并行」的结构设计出来。
- 并行的前置不是「多开 worker」，而是**隔离边界**：每个并行单元要有自己的库、Redis 命名空间、后端进程与端口。

**改法（设计稿，分两步）**

1. **Phase A：stack-per-project（推荐先做）**
   - 为 smoke / risk / network 各定义一份 stack profile：库名 `walnut_e2e_smoke` / `walnut_e2e_risk` / `walnut_e2e_network`，后端端口 3101 / 3102 / 3103，静态代理 4181 / 4182 / 4183，socket 3011 / 3012 / 3013。
   - 每份 profile 有自己的 baseline 文件与锁 key（同一台机器上仍只允许一个全量 run；CI matrix 的每个 job 在独立 runner 上，天然隔离）。
   - `apps/e2e/scripts/env.ts` 的 `assertE2eDatabase` 从「必须等于 `walnut_e2e`」扩展成严格正则（如 `^walnut_e2e(_[a-z]+)?$`），并保留 `SELECT current_database()` 真断言。
   - CI 用 matrix 跑三个 project，每个 job 自己 restore + 起后端；总 wall-clock 取最慢的 project。
2. **Phase B：per-worker（暂不做）**
   - 每个 worker 一个 DB / schema + 一个后端进程 + Redis 前缀；需要 Playwright 之外的生命周期管理（webServer 是 per-run 的，不能 per-worker 起）。
   - 只有 Phase A 仍不够、且用例数增长到单 project 超过 ~10 分钟时才考虑。

**验收标准**

- Phase A 的设计文档（ADR 或计划页附录）写清：profile 命名、端口分配、锁 key、baseline 文件、CI matrix、失败隔离、清理责任。
- 实施后：CI 上三个 project 并行，任一 job 失败不影响其他 job；本地 `pnpm walnut e2e` 仍是一条串行全量（行为不变）。
- 不出现跨 profile 的库 / Redis 串写（用真断言证明）。

**不变量兼容性**

- 6（一台机器一个全量 run）：本地不变；CI 每个 runner 一个 run，不违反。
- 4（4/60s per realIp）：每个 profile 的 `uniqueLocalIp` 在自己的 127/8 段内分配，冲突风险不变；如果多 profile 同机并行，需要按 profile 偏移网段（设计时写明）。
- 9（CAP 放宽只改库）：每个 profile 的库各自放宽。
- 7（storageState 判死）：不变，并行不靠复用登录态。
- 其余不碰。

**工作量级**：Phase A 设计 M，实施 L；Phase B 暂不排期。

**落地记录（2026-11-25，设计阶段）**：本条本批只交付下面的 Phase A 设计稿，**未实施**（没有改 `apps/e2e` 代码）；Phase B 显式暂缓、不排期。设计稿的验收物就是本文档本身。

##### 附录：Phase A「stack-per-project」设计稿（2026-11-25 定稿，未实施）

**边界先钉死**：并行单元是 **stack profile**（本地一次一个 profile；CI 一个 job 一个 profile），**不是 worker**。本设计不放松不变量 6 —— 本地默认仍是**一条串行全量**（`pnpm walnut e2e` 行为不变），`workers: 1` / `fullyParallel: false` 也不动。Phase B（per-worker）见本节末尾。

###### 1. profile 定义与配置载体

| profile | 库名 | 后端 / socket / 静态代理 | IP 段（`uniqueLocalIp`） | 基线三件套目录 | 锁 key |
|---|---|---|---|---|---|
| `default`（现状，本地全量） | `walnut_e2e` | 3001 / 3002 / 4173 | `127.0.{1,2}.*` | `.e2e/` | 2026112401 |
| `smoke` | `walnut_e2e_smoke` | 3101 / 3011 / 4181 | `127.0.{11,12}.*` | `.e2e/smoke/` | 2026112402 |
| `risk` | `walnut_e2e_risk` | 3102 / 3012 / 4182 | `127.0.{21,22}.*` | `.e2e/risk/` | 2026112403 |
| `network` | `walnut_e2e_network` | 3103 / 3013 / 4183 | `127.0.{31,32}.*` | `.e2e/network/` | 2026112404 |

- **载体**：新增 apps/e2e/scripts/stack-profiles.ts（目标路径尚不存在，正文不加反引号）作为单一真源；`apps/e2e/scripts/env.ts` 的全部派生常量（库名 / 三个端口 / 两个 origin / 基线三件套路径 / `.auth/<profile>/credentials.json` / `.e2e/<profile>/e2e.env`）从它读取，`backendEnvOverrides()`、`pg-lock.ts`、`baseline.ts`、`prepare-db.ts`、`runtime-reset.ts`、`preflight.ts`、`static-server.ts`、`stack-info.ts`、`playwright.config.ts` 一律不各自拼。
- **选择方式**：环境变量 `E2E_STACK_PROFILE`（不设 = `default`）。**只选 profile，不开放端口 / 库名的独立覆盖** —— 任意覆盖会让 `assertE2eDatabase` 那层安全闸失去意义；已有的 `E2E_PG_CONTAINER` / `E2E_PG_EXEC_MODE` 保持（它们说的是「怎么连数据栈」，不是「连哪个库」）。
- **默认 profile 的值与今天逐字相同**：这是第一步「抽表」零行为变化的判据。命名 profile 才用子目录与偏移端口。
- **profile 与 Playwright project 同名 1:1**（`smoke` / `risk` / `network`），不维护第二张映射表；`default` 没有同名 project（它就是本地全量）。
- `test-results/` 可按 profile 分目录（避免 CI artifact 同名覆盖）；各 job 是独立 checkout，所以这是可选项，不是隔离的必要条件。

###### 2. 隔离边界逐项

**库（安全闸）**：`assertE2eDatabase` 从「逐字等于 `walnut_e2e`」扩成两条 —— 形状正则 `^walnut_e2e(?:_[a-z]+)?$`（挡住 dev 库与注入形态）**且**必须等于当前 profile 的库名（挡住 `walnut_e2e_foo` 这类拼错）。所有动库路径（prepare / dump / restore / `runtime-reset` / `lib/pg.ts`）保留连上之后的 `SELECT current_database()` **真断言**，期望值改成当前 profile 的库名；`assertE2ePgPort` / `assertE2eRedisPort` 不变（所有 profile 共用同一个 5433 / 6380 实例 —— 隔离靠库名与 IP 段，不靠端口）。

**基线**：每个 profile 一套三件套（`.e2e/<profile>/baseline.dump` / `baseline.manifest.json` / `baseline.credentials.json`），credentials 每轮写到 `.auth/<profile>/credentials.json`。清单升到 **v3**，新增 `database` 与 `profile` 两个字段 —— restore 前断言「清单里的 `database` 等于当前 profile 的库名」，所以即使把 smoke 的 dump 拷进 risk 目录也恢复不了（先 sha 校验、再库名字段）。**v2 → v3 不迁移**（与 v1 → v2 同口径：缺字段就无法安全证明配对），升级后首次运行会自动全量 prepare + seal 一次；默认 profile 的文件位置不变，但这一次重封是预期成本。

**锁（两把，都是 PG advisory lock，作用域 = 同一个 PG 实例）**：

- **全局 run 锁**（现有 key `2026112401`）：每条 run 先抢，语义是「这台机器的这个数据栈上同时只有一个 E2E run」——**不变量 6 原样保留**；
- **profile 锁**（`2026112401 + profile 序号`）：拿到全局锁之后再抢，语义是「这个库此刻只有一个 owner」。CI 每个 job 是独立 PG 实例，全局锁天然无竞争，profile 锁的价值是日志归属（报持锁者时能看出是哪个 profile）与同 profile 重入保护。
- 本地多 profile 仍**串行**：第二个 profile 会在第一步等全局锁，120s 内抢不到就报持锁者退出。profile 锁不是并发通行证；放开本地并行需要所有者拍板改写不变量 6，并且先解决下面 Redis 的全局键共享面。

**IP 段（127/8）**：`uniqueLocalIp()` 的第三段按 profile 偏移 —— 公式 `127.0.<slot × 10 + 1 + floor(seq / 200)>.<10 + seq>`，`seq` 仍在 0..239 回绕，即每个 profile 两个 /24、240 个地址；`default` 的 slot = 0，产出 `127.0.1.10..209` 与 `127.0.2.210..249`，与现状逐字一致。必要性在 **Redis**：`device/initial` 的 4 次 / 60 秒是 `@nestjs/throttler` 的**进程内**桶（每个 profile 一个后端进程，本来就不共享），但风控的 `risk:rate:ip:<ip>:<分钟>` 是 Redis 键（`rate.service` 的 `buildKey`）—— 同机共享 Redis 时，只有 IP 段不相交才不会串桶。per-profile 240 个地址按当前每轮设备量级足够；超出回绕是 P2-3 已记录的既有行为。

**Redis**：结论是**不加 profile 前缀，也不换逻辑库**。理由：

1. 键形由 server 拥有（`apps/server/libs/const/src/app/cache.ts` 与各 `*.cache.ts`），E2E 只是逐条对齐的消费者（不变量 5）；加前缀要么改 server，要么让 E2E 的删除 / 断言键形与服务端漂移 —— 后者正是「精确删」最怕的；
2. 现有清理是 **deviceId 精确删**（`deleteDeviceScopedKeys` / `deleteRiskDeviceState`），deviceId 每轮随机（`d1_` + 32 hex），跨 profile 撞不上；fixture 只删**本进程登记过**的 id，物理上删不到别的 profile；
3. 会跨 profile 共享的只有全局键（`WALNUT_CACHE_APP:SETTING` / `APP:SETTING`）。它们的值由**同一份基线数据**派生（各 profile 的库都来自同一 dataKey 的 prepare），本地又串行，CI 每个 job 一个独立 Redis service —— 当前不存在「两个 profile 同时写一个 Redis」的场景；
4. 若将来要本地并发 profile，先加**每 profile 一个 Redis 实例**（端口再分配），而不是键前缀 —— 服务端没有逻辑库配置项（`APP_REDIS_*` 只到 host / port / pass），改键形或加配置都是 server 侧改动，比多起一个 Redis 贵得多。

**`.env.e2e` 的已知约束**：`apps/server/env-local/.env.e2e` 是 typeorm CLI 的**固定通道**（CLI 用 `process.cwd()/env-local` 定位，没有 `--env-file` 参数，文件里也没有 profile 名的位置）——因此**同一个 checkout 上不能并发两个 profile 的 prepare**。本设计的本地串行与 CI 独立 checkout 都满足这一点；不要为了「并行」去猜 CLI 的其它路径。

###### 3. CI matrix 草案（演进现有 e2e.yml，不另起工作流）

`jobs.e2e` 从单 job 改成 matrix：

```yaml
jobs:
  e2e:
    strategy:
      fail-fast: false            # 一个 profile 红，其余 job 照跑（失败隔离）
      matrix:
        profile: [smoke, risk, network]
    env:
      ENV_KEYS: ${{ secrets.ENV_KEYS }}
      E2E_STACK_PROFILE: ${{ matrix.profile }}
      E2E_SKIP_BASELINE: '1'      # 与现状一致：.e2e/ 不跨 run 缓存
    services: <与现单 job 相同：postgres:18-alpine / redis:8-alpine，5433 / 6380>
    steps: <与现单 job 相同；最后一步跑用例换成下面这条>
    # 跑用例：pnpm --filter @walnut/e2e e2e -- --project=${{ matrix.profile }}
```

- **跑什么**：`--project` 与 profile 同名，且会带自己的 setup dependencies（`stack-setup`，smoke 还带 `auth-setup`）。三个 job 的并集就是现有 `pnpm walnut e2e` 的覆盖面（`@network` 的 grep / risk 的 grepInvert 都不变，U1b 只由 network job 跑）。
- **演进，不并存**：保留同一工作流、同一 `concurrency`（固定 group、不取消在途）、同一严格 artifact allow-list、同一 `fetch-depth: 0` 与 env 解密步骤；**不再保留单栈全量 job** —— CI 的价值是墙钟，单栈全量在 CI 上没有额外覆盖；需要单栈全量时本地 `pnpm walnut e2e` 仍是入口（将来若要 dispatch-only 的 `full` job 再单独立项）。
- **setup 复用口径**：Linux runner 上 `E2E_PG_EXEC_MODE` 默认 `docker-cli`；`E2E_PG_CONTAINER` 不设时，`CI=true` 按镜像 `postgres:18-alpine` 解析 service 容器（P1-1 已落地，每个 runner 只有一个该镜像的容器）。`E2E_SKIP_BASELINE=1` 保持现状；切回基线路径的前置条件与 P1-1 那条相同，只是**每个 profile 有自己的一套三件套**，将来加 cache 时 cache key 必须带 profile。
- **artifact**：名字带 profile（如 `e2e-diagnostics-<profile>`）；`stack.json` 与基线清单的路径进 `.e2e/<profile>/`；junit / json / 脱敏 backend.log 各 job 独立 checkout，天然隔离。trace / 截图 / HTML 仍不上传。
- **代价（写进 job 注释）**：三个 job 各跑一遍 install / `pnpm build` / 两处 stage / playwright install，**总机器时间约 3×**，墙钟从「串行全量」降到「最慢的 profile + 固定开销」。这是用 CI 时长换反馈速度，nightly 场景可接受。
- **与 `e2e:affected` 的映射（P1-5 现状）**：`mode=projects` 的 `projects` 直接作为 matrix 列表（当前只有 `smoke` / `risk`）；`mode=all` ⇒ `[smoke, risk, network]`；`mode=skip` ⇒ 不跑。`affected.ts` 目前只有人读输出，实现时需要加一个 `--json` 输出模式（只多一个输出口，不改映射规则）。`rebuild=true` 与 CI 的 `E2E_SKIP_BASELINE=1` **互斥**（`ensureTestDatabase` 会拒），所以 prepare job 不要转发 `--rebuild-baseline`。

###### 4. 失败隔离与清理责任

- **跨 profile 不串写的真断言**（不是口头约定）：
  1. 每个动库连接在 connect 后 `SELECT current_database()`，期望值 = 当前 profile 的库名（现有机制，只改期望值）；
  2. 基线清单的 `database` / `profile` 字段必须与 restore 目标一致（跨 profile 的 dump 恢复不了）；
  3. 每个 profile 的 fixture 只删**本进程登记**的 deviceId（PG 行 + Redis 键），登记集合在进程内存里，天然不含别的 profile；
  4. 收尾探针（建议随实施加进 `run.ts`）：把本 profile 的设备 id 列表拿到**其它 profile 的库**上 `SELECT count(*) FROM sys_device WHERE device_id = ANY(...)`，必须为 0 —— 这就是「串写 ⇒ 红」的机械判据。
- **清理责任**：设备 / Redis 清理仍归 `tests/fixtures.ts` 的两个 auto fixture（不变量 10）；profile 只影响连接目标，不改变归属。运行时重置按 profile 作用：credentials 路径 per profile；`walnut_app` 口令是**集群级角色**，所有 profile 写同一个固定值，不冲突。
- **崩溃残留的 GC**：归 **P2-2 redis-gc**（尚未实施）。profile 化之后它的口径是「按当前 profile 的库查 `sys_device`，清该库对应设备的孤儿键」，仍是精确删、不 FLUSH；各 profile 的孤儿由各自 restore 后的 GC 负责。本设计不重做 P2-2。

###### 5. 落地顺序与验收（每步独立可回滚）

1. **抽出 profile 表，默认 profile 零行为变化**：新增 scripts/stack-profiles.ts（同前，未存在的目标路径不加反引号），env.ts 从它派生；不设 `E2E_STACK_PROFILE` 时库名 / 端口 / 路径 / 锁 key / IP 段与今天逐字相同。
   - 验收：`pnpm walnut e2e` 全绿；日志里的库名 / 端口 / 基线路径与改前一致；已有基线直接 restore（不触发重封）；`e2e:doctor` 除多一行 profile 外输出不变。
   - 负对照：把默认 profile 的库名临时改成别的 → `assertE2eDatabase` 在动库之前退 2。
2. **加命名 profile 与隔离件**：`E2E_STACK_PROFILE=smoke|risk|network`；per-profile 基线目录与 credentials；清单 v3（`database` / `profile`）；严格正则；IP 段偏移；profile 锁。
   - 验收：本地依次跑 `E2E_STACK_PROFILE=smoke pnpm walnut e2e:smoke` 与 `E2E_STACK_PROFILE=risk pnpm walnut e2e:risk`，各自封板、第二轮各自 restore，两套基线互不影响。
   - 负对照（必须红）：(a) `E2E_STACK_PROFILE=risk` 但库名指到 smoke → 动库前退 2；(b) 把 smoke 的 `baseline.dump` 拷进 risk 目录 → sha / `database` 字段不匹配，restore 拒绝；(c) 跑完 smoke 后拿它的 deviceId 去 risk 库查 → 0 行，反向同理；(d) 同一 profile 两个进程并发 → 全局锁 120s 内报持锁者退出。
   - 一次性成本：清单升 v3 后默认 profile 首次运行会提示重封板（与 v1 → v2 同口径，显式动作）。
3. **CI 切 matrix**：按上面的草案改 `.github/workflows/e2e.yml`（`fail-fast: false`、artifact 名带 profile、`.e2e/<profile>/` 路径）。
   - 验收：dispatch 一次三 job 全绿；人为让一个 job 红，其余 job 仍跑完；artifact 三份按 profile 命名；墙钟 ≤ 最慢 profile + 固定开销；`pnpm walnut lint:workflows` / `lint:workflows-shell` 通过。
   - 回滚：matrix 去掉、`E2E_STACK_PROFILE` 不设即回到单栈全量；profile 抽象本身不需要回滚。

###### 6. Phase B（per-worker）显式暂缓

- **触发条件**：单个 project 的用时稳定超过 **~10 分钟**（nightly 预算内仍可接受的上限）；或 PR / merge queue 需要 < 5 分钟的子集证据而 Phase A 已经到墙。
- **前置（缺一不可，且全部在 Playwright 之外）**：
  1. worker 级生命周期管理 —— Playwright 的 `webServer` 是 **per-run** 的，不能 per-worker 起后端；需要外部编排（预起 N 套后端 + 库 + 端口，再把 `baseURL` 分给 worker）；
  2. 每 worker 一个库 / schema、一个后端进程、一套端口；Redis 每 worker 一个命名空间 —— 现有键形由 server 拥有，且 server 没有逻辑库配置项，所以现实路径是**每 worker 一个 Redis 实例**，不是键前缀；
  3. 账号池（计划页 Phase 3 的 worker 账号池）与每 worker 的 MFA trusted 状态；
  4. `uniqueLocalIp` 按 worker 再分段，fixture 清理与 GC 按 worker 归属。
- **不排期**：Phase A 落地并有真实时长数据之前，不开 Phase B 的工单。**当前 `workers > 1` 仍是禁止项**（见 §4「不建议做」最后一行）。

---

### 3.3 P2：健壮性、治理与体验

#### P2-1 Flaky 治理制度化

**动机**：`retries: 0` 是刻意的（要看真话），且 `d720c0d3` 已给 DEVICE_NEW / DEVICE_RECENT 标了 `test.slow()`；但仍缺 quarantine 列表、CAP / MFA 等待总预算、失败现场采集。U8 / U9 修复后调查仍见到一次 1.2 分钟的异常值，说明「修好了」不等于「稳定了」。

**改法**

- 慢用例继续按需 `test.slow()` / `test.setTimeout`，全局 120s 只作兜底；**不要**给 U8 / U9 加宽 —— 修好后的 flake 应在 120s 内红。
- 给 CAP / MFA 等待设**总预算**（如 90s），超时输出当前 URL、最近 12 条 envelope、CAP widget 状态、localStorage 设备 id。
- 新增 quarantine 列表 apps/e2e/quarantine.json（目标文件尚不存在，正文不加反引号），记录测试名、issue、owner、加入日期、复查日期；`@quarantine` 用例在 nightly 跑但不作为门禁。
- 修复 flake 必须有「20 次循环无复现」证据（计划页 Phase 2 完成判据）。
- 月度 flaky Top 10 与失败分类（产品 / 测试 / 环境 / 基础设施）。

**验收**：quarantine 流程有文档与列表；每条 flake 有 owner；20 次循环证据贴进结果记录。
**不变量**：不碰；尤其不用 retries 掩盖问题。
**工作量**：M（`test.slow()` 已落地，剩余部分是预算 + 列表 + 流程）。

#### P2-2 Redis 对账与残留清理

**动机**：restore 只清两个 app setting 键；崩溃 / 中断的 run 留下的设备作用域键会跨轮存活（Phase 1 首跑清掉过一批遗留键）。没有 FLUSH 的前提下，需要一个「按 deviceId 精确删」的对账机制。

**改法**：新增 apps/e2e/scripts/redis-gc.ts（目标路径尚不存在，正文不加反引号）：在锁内、restore 之后，扫描 E2E 命名空间下的设备键，提取 deviceId，查 PG `sys_device`；设备不存在的键按前缀精确删；同时清 `risk:device:*` / `risk:challenge:device:*` / `AUTH:SESSIONS:*` 的孤儿。只在 `walnut_e2e` 上跑，绝不 `FLUSHDB` / `FLUSHALL`。
**验收**：人为造 3 个孤儿键，GC 后只剩有效设备键；compose 里的 `FLUSHDB` / `FLUSHALL` 仍被禁用。
**不变量**：5（精确删，不 FLUSH）是这条的核心；不碰其他。
**工作量**：S–M。

#### P2-3 局部健壮性（`18dcc9c6` 已落地，保留回归验证）

**动机**：`apps/e2e/scripts/static-server.ts` 曾对 URL 直接 `decodeURIComponent`，畸形 `%` 会抛异常；`apps/e2e/lib/protocol/sign.ts` 的 PoW 求解曾是 `for (;;)`，难例可能长时间占用单 worker；`uniqueLocalIp()` 在 240 个地址后回绕，且两处用例硬编码 `1.1.1.1`。

**现状**：`18dcc9c6` 已做两件事 ——
- CAP PoW：challenge 形态校验（`c` 1..50、`d` 1..8）、每问尝试上界 `max(1_000_000, 16^d × 32)`、30 秒墙钟上界，失败时报 index / c / s / d / attempts；
- 静态代理：`decodeURIComponent` 捕获并返回 400、文件流 `error` / `close` 处理（不再让读失败打崩进程）、`statSync` 的 TOCTOU 兜底。

**改法（剩余）**：`uniqueLocalIp` 用 run 前缀或 127.8/8 段分配，避免跨 run 撞桶；Phase0-4 的硬编码 `1.1.1.1` 按 P0-2 改成 `uniqueLocalIp()`（公网定位留给 U1b `@network`）。
**验收**：畸形 URL 请求返回 400 且静态服务仍存活；构造一个超难 challenge 能在预算内失败并给出可读错误；连续两轮全量不撞 42900。
**不变量**：2（XFF 只加 /api/）、4（每设备独立 IP）是重点；不碰其他。
**工作量**：S（剩余部分）。

#### P2-4 `data-testid` 与页面对象

**动机**：`apps/e2e/lib/ui.ts` 的选择器依赖 CSS 类 / placeholder / 组件标签；admin 源码里 `data-testid` 零命中。Slack 的经验是稳定选择器能显著降低 flake。

**改法**：登录表单、侧边栏、MFA 卡片三处加 `data-testid`（改 admin 源码要过 lint / types）；`lib/ui.ts` 改用 testid 优先、文案兜底；用例增长后再考虑按组件而非页面建模的 POM。
**验收**：改 CSS 类名 / 文案不导致 E2E 红；三处 testid 有注释说明用途。
**不变量**：不碰。
**工作量**：S（三处）–M（POM）。

#### P2-5 本地 DX 与卫生

**动机**：前置多（setup-env、两处 build:stage、playwright install、WSL 隐藏会话、数据栈、三个端口空闲）；`.e2e/` 下堆积调试文件；`.auth/admin.json` 是遗留 storageState（含 `DEVICE_ID` cookie，无代码引用）；退出码 2 经 pnpm 递归会被折成 1。

**改法**：命令表加 stack up / down / status（自动探测 WSL 与通用 compose）；`.e2e` 清理脚本（保留 baseline 三件套与 stack.json）；删除遗留 `.auth/admin.json` 并在 `.gitignore` 注释「不产出 storageState」；README 补 `--ui` / `--debug` / 单用例 `-g` / 三个 `E2E_*` 开关的用途与风险；退出码说明前置到 README 顶部。
**验收**：一条命令看数据栈状态；清理脚本 dry-run 列出将删文件；仓库内无遗留 storageState。
**不变量**：7（storageState 判死）——删除遗留文件正是强化它。
**工作量**：S–M。

#### P2-6 OpenAPI 三处 schema 偏差（候选）

**动机（现象，2026-11-25 核实）**：server 生成的 `apps/server/openapi.json` 有三处与真实 wire 不一致，全部来自 `apps/server/libs/crud/src/list.ts` 的列表装饰器与 user 的 DTO：

1. **分页壳被标成数组**：`WalnutAdminDecoratorList` 的 `ApiOkResponse` 写成 `data: { type: 'array', items: { allOf: [分页壳, …] } }` —— 生成物里 `/system/user/list` 的 `data` 是「分页壳的数组」（`data: [ { data: [...], total } ]`），真实响应 `data` 是**单个**分页壳对象。所有走 `WalnutAdminDecoratorList` 的 `POST */list` 端点都受影响。
2. **list 行标成完整 DTO**：user controller 用 `WalnutCrudDecorators({ DTO: SysUserDTOSafe })`，于是分页壳里的行 schema 是完整 `SysUserDTOSafe`；实际响应是 `SysUserDTOListResponse`（`RealPickType(RealPartialType(SysUserDTOSafe), ['id', 'userName', 'nickName', 'status', 'createdAt', 'updatedAt', 'roles_count'])` 的**字段子集**）。
3. **`nickName` 可为 null 却标 string**：`SysUserDTOBase.nickName` 声明为 `string`、swagger `default: null` 但**没有 `nullable`**；`sys_user.nick_name` 与实体都是 nullable ⇒ 生成类型是 `string`，运行时可以是 `null`（新建用户不传 nickName 的 list 行就是 null）。

**建议**：修 **server 的 swagger / DTO**，不要放宽 E2E 断言。具体方向（实施时按 openapi 生成物核对）：列表 `ApiOkResponse` 的 `data` 改成单个分页壳对象（不要 `type: 'array'`），行 schema 用 controller 实际响应的 DTO（或给装饰器加一个「行 DTO」参数，user 传 `SysUserDTOListResponse`）；`nickName` 补 `nullable: true` / 类型改成 `string | null`（同时确认 `WalnutAdminDecoratorFieldString` 对 `default: null` 的 swagger 表达）。改完重新生成 `openapi.json` 并过 `openapi:check` 零 diff 门禁。

**与 E2E 的关系**：`apps/e2e/lib/protocol/api-types.ts` 的 `SystemUserListPage` 已把两处 list 偏差显式记成注释（桥接层对着真实 wire，字段改名照样会让 `types:check` 红）；修完后这里应回到路径级默认推导并删掉补偿注释。**不建议**把 E2E 的字段级断言改成迁就错误 schema —— 那会把「server 与真实响应漂移」这个信号藏起来，正好与本条的目的相反。

**验收**：`pnpm --filter @walnut/e2e types:check` 与全量套件保持全绿；生成物里不再出现「分页壳数组」与缺失的 nullable；`openapi:check` 零 diff。**工作量**：S–M（改装饰器 + DTO + 重新生成；跨端点影响面要逐个看生成物 diff）。

#### 文档同步

不单列为改造项（它没有代码验收面，也不该和上面的工程项抢优先级）；逐条见第 7 节。工具：`pnpm walnut lint:docs-refs`、`lint:doc-ts`、`lint:doc-budget`、`build:docs`。

---

## 4. 不建议做（以及为什么在本仓库收益低）

这一节和改造项同等重要：**不做什么，决定了复杂度不会提前引入**。

| 不做 | 为什么在本仓库收益低 |
|---|---|
| **请求级沙盒 / namespace-per-PR** | 那是为「几十到上百个微服务、全量复制不现实」设计的（Uber BITS / Signadot）。本仓是单体：一个 NestJS 进程 + 一个 Vue SPA + 一套 PG / Redis，没有「只 fork 变更服务、其余共享生产」的对象。引入流量路由、租户头传播、消息隔离的复杂度，换不到任何本仓需要的保真度。 |
| **每 PR 临时环境（Preview / Review App）** | 本仓部署单元是单机 compose（TCR 镜像 + 证书 + 不发布 DB 端口），每个 PR 起一套完整环境需要主机 / 域名 / 证书 / 清理编排。PR 的 quality 已约 30 分钟，再加环境启动与 E2E 会把反馈时间推得不可接受。真正需要的是 nightly 全量 + 手动 dispatch（P0-1），不是 PR 环境。 |
| **每个 PR 跑全量 E2E** | 与上一条同因：全量 4–7 分钟只是测试本身，前面还有 install / 两处 stage 构建 / 数据栈 / 浏览器安装。fork PR 没有 secrets，也拿不到 stage env。计划页 §2.8 已拍板「不进 PR 门禁」，本篇不翻案。 |
| **全量复制生产库** | 本仓没有合规 / 性能场景需要生产数据形态；E2E 的数据需求是「覆盖边界状态的少量 seed」，不是「生产规模」。复制生产库只会引入 PII 风险与脱敏成本（Salesforce Full Copy 是给上线前性能验证用的，不是日常测试）。 |
| **数据库分支 / Neon / ZFS 快照** | 本仓已有 PG `pg_dump -Fc` + restore，实测 1.5–3.5 秒；prepare 2–7 秒。分支 / COW 能把重置降到毫秒级，但相对 4–7 分钟的总时长是 <1% 的优化，收益被噪声淹没。现有基线机制的真正价值是「数据版本可控」，不是速度。 |
| **多浏览器 / 多设备 profile 矩阵** | 设备身份是服务端签发的 `DEVICE_ID` signed cookie，不消费浏览器指纹；同一套逻辑换浏览器只会多跑几遍，抓不到新缺陷。视觉回归是另一层的事，不放在这里。 |
| **storageState 复用登录态** | 已判死：`storageState({ indexedDB: true })` 恢复不了 IndexedDB 里的 AES `CryptoKey`，坏状态会让应用卡在 splash。这是不变量 7，不因「省几秒」而绕过。 |
| **把 E2E 放回 apps/admin/e2e** | 旧建议（行业调研 04 的早期版本）假定「E2E 只关心 admin」。现在这一层明确测跨端：设备身份、CAP、签名握手、风控，必须同时有前端与后端。放回 admin 会让「库被重建过」这个判据失效。 |
| **用 mock 替代真实后端** | E2E 的价值就是验证真实后端 + 真实 PG / Redis + 真实浏览器。要 mock 的是第三方（支付、邮件、地图、OAuth），不是自己的服务。 |
| **先开 `workers > 1` 或 `--shard`** | 当前整库共享、单 Redis、单后端进程；直接并行会让设备 ban / lock、risk rate、MFA trusted 互相污染。并行的前置是 P1-6 的隔离设计，顺序不能反。 |

---

## 5. 与 CI 的衔接

### 5.1 分层：PR 不跑，nightly 全量，手动可触发

| 阶段 | 跑什么 | 为什么 |
|---|---|---|
| PR | **不跑 E2E**；只跑现有 quality（lint / types / affected unit / boundaries / docs 门禁） | 计划页 §2.8：PR quality 已约 30 分钟，fork PR 无 secrets；E2E 的前置（数据栈、stage 产物、chromium）也不该进每个 PR |
| merge queue | 可选：`@smoke` 子集（需要先做 P0-3 与稳定的 runner） | 现阶段不强求；等 nightly 稳定运行一段时间、smoke 时长 ≤ 60s 再评估 |
| post-merge（可选） | `@smoke` + 契约 | 同上；先有数据再决定 |
| nightly | 全量 `pnpm walnut e2e`（含 `@network`） | 长尾与真实外网都需要周期性证据 |
| 手动 dispatch | 全量或指定 project | 修 flake、验证新用例、发版前验收 |

这个分层与 [ADR 0009](../adr/0009-ci-quality-gates.md) 的既有口径一致：PR 门禁只放「快而可靠」的检查；全量回归是 post-merge / nightly 的职责，不阻塞合并。

### 5.2 runner 上的数据栈

- **推荐**：job 级 `services`（PG 18 / Redis 8），端口映射到 localhost，凭据与 `apps/e2e/scripts/env.ts` 逐字一致。service 容器是临时的，跑完即销毁，天然满足「不碰 dev 库」。
- **备选**：runner 上跑 `apps/e2e/docker-compose.yml`（通用栈）。需要 runner 有 Docker；比 services 多一步 `docker compose up -d --wait`。
- **禁止**：改 `deploy/docker-compose.yml` 来迁就测试。部署形态是 TCR 镜像 + 证书 + 不发布 DB 端口，参数化到能跑测试就等于另建一份。

### 5.3 workflow 草案

见 P0-1 的骨架。补充三条硬约束：

1. **`secrets` 不进 `if`**：绑定 job 级 `env`，用 `env.XXX != ''` 判断；否则 GitHub 判 `Invalid workflow file`，启动即 0 job。
2. **浏览器不缓存**：`playwright install --with-deps chromium` 每次装。缓存收益小于「缓存坏了导致假红」的成本。
3. **`concurrency` 固定 group、不取消在途**：同一时间只允许一份 e2e；nightly 与手动 dispatch 撞车时排队，不互相杀。

### 5.4 artifact / junit / trace 上传策略（含一处口径冲突）

**默认策略（本篇推荐）**：

| 产物 | 是否上传 | 理由 |
|---|---|---|
| junit XML | 上传 | 机器可解析，不含请求头 / 响应体 |
| json reporter | 上传 | 同上；用于统计 p50 / p95、flaky 状态 |
| 后端日志（脱敏后） | 上传 | 排障必需；写入前把 `Authorization` / `Cookie` / `x-sign` / `CAPJS_TOKEN` / `DEVICE_ID` 的值替换为 `<redacted>` |
| `stack.json` | 上传 | runId / commit / 端口 / 产物 mtime；`credentialsFile` 只记路径 |
| baseline manifest | 上传 | 纯元数据（sha / 迁移头 / 菜单行数） |
| `playwright-report/`（HTML） | **不上传** | 不变量 8：报告含请求头与响应体（token、cookie） |
| `test-results/`（trace / 截图 / 视频） | **不上传** | 同上 |
| blob report（分片用） | 暂不涉及 | 本仓还没做 shard |

**口径冲突（需要所有者拍板）**：计划页 §8.1 的草案写「失败时上传 `playwright-report/` 与 `test-results/` artifact（私有仓库保留 7 天）」，与 [`apps/e2e/AGENTS.md`](https://github.com/walnut-admin/walnut-admin/blob/main/apps/e2e/AGENTS.md) 不变量 8 的「只留本机，不许上传任何公开位置」不完全一致。私有仓库 artifact 不是公开位置，但也不是「只留本机」。本篇的建议是：

- **默认按严格读法**：只上传 junit / json / 脱敏日志 / stack / manifest；trace 与 HTML 留在 runner 或本机。
- 如果确实需要 trace：先做**脱敏脚本**（解压 trace zip，删除或替换 `network` 条目里的 `Authorization` / `Cookie` / `x-sign` 值，删除截图？截图可能包含页面上的 token 文本），并在私有仓库设置短保留期 + 访问审计；做完之后**改 AGENTS.md 的不变量 8**，把「只留本机」改成「脱敏后可上传到私有 artifact」。没有这一步，就不要上传。

这条冲突不解决，P0-1 的 artifact 步骤就只能按严格读法实现；不要为了「方便排障」悄悄放宽不变量。

---

## 6. 度量与验收

### 6.1 指标

| 指标 | 口径 | 目标（先定基线，再收紧） |
|---|---|---|
| 单次通过率 | 首次运行通过 / 总运行 | 先记录，nightly 稳定后 ≥ 95% |
| Flaky 率 | flaky 测试数 / 有运行的测试数（按周） | 新仓库 < 2%，成熟后 < 0.5%；关键旅程 0 容忍 |
| 全量时长 p50 / p95 | `run.ts` 从抢锁到 playwright 退出 | 先记录 4–7 分钟基线；P0-3 后 p95 ≤ 3 分钟 |
| smoke 时长 p95 | `e2e:smoke` | ≤ 60 秒 |
| 失败归属 | 产品 / 测试 / 环境 / 基础设施 | 每次失败必须有分类，否则不计入改进 |
| 基线 restore 时长 | restore 日志 | 1.5–3.5 秒（不是优化目标，是回归哨兵） |

### 6.2 采集方式

- junit / json 是唯一机器可读来源；本地先写一个轻量汇总脚本（读 `test-results/results.json` 的 `status` 与 duration），输出周报。
- `stack.json` 与 baseline manifest 让「这一轮用了哪个 commit / 哪个数据版本 / 哪个产物」可追溯；失败用例 attach 之后，排障不需要登录 runner。
- CI 的 run summary 记录总时长与 job 时长；不追求复杂仪表盘，先做到「一页纸看清五件事」（时长、flaky Top、失败分类、关键旅程通过率、变更失败率）。

### 6.3 分阶段验收

| 阶段 | 验收 |
|---|---|
| P0 完成 | nightly / dispatch 首跑全绿且 junit 可下载；离线 `e2e:risk` 全绿、`e2e:network` 按预期红；全量 p95 ≤ 3 分钟、smoke p95 ≤ 60 秒（20 次循环记录） |
| P1 完成 | 只改文档不触发基线漂移；脏 seed 触发退出 2；`E2E_REUSE_SERVER=1` 可用；缺 `@walnut/utils` / `@walnut/contract` 的 dist 时 preflight 退 2；失败用例有 stack / baseline / 最近响应附件；`@walnut/api-types` 泛型与关键端点字段断言落地 |
| P2 完成 | quarantine 流程有 owner 与复查日期；Redis GC 能清孤儿且不 FLUSH；畸形 URL 返回 400（`18dcc9c6` 已做，补回归用例）；三处 `data-testid` 生效；`.e2e` 有清理命令、无遗留 storageState |

### 6.4 负对照（防止「改完看起来绿」）

- P0-2：故意让静态代理覆盖 XFF → Phase0-4 必须红。
- P0-3：故意让 auth-setup 少断言一项 → 合并后的门禁必须红。
- P1-1：故意改一条 seed 行不提交 → 必须退出 2；只改文档 → 必须不退出 2。
- P1-4：把 `apps/server/openapi.json` 的一个响应字段改名并重生成 → E2E 的类型检查必须指出受影响调用点。
- P2-2：人为造孤儿 Redis 键 → GC 必须删掉且不碰有效键。

**没有负对照的「通过」不算验收** —— 这是本仓文档反复强调的口径，也适用于 E2E 自己。

---

## 7. 文档同步与本次已做的最小修正

### 7.1 本次已做的事实修正（最小 diff）

- [E2E 沙盒测试计划](./e2e-sandbox-plan.md) 篇头与阶段总览：补「2026-11-25 追记」——`b21ac118` 落地 U8 / U9 flake 核心修复（P2-7），`5067b4aa` 落地契约 bridge 与常量收口（P2-9 / P2-10 / P2-11），`18dcc9c6` 落地 CAP PoW 上界与静态代理加固（P2-16 / P2-17），`d720c0d3` 落地慢用例 `test.slow()`（P2-15）；Phase 2 的 CI 与 risk 矩阵仍未开始，状态不改成「已完成」。第 7 节的对应观察项加一句「已修，待 20 次循环复核」。不重排分期。
- [行业调研：测试体系](../industry-research/04-testing-strategy.md) 的 §6.2：原文建议 E2E 放 apps/admin/e2e、并称「与 server 无关」，与现状冲突；改成指向本篇与 [E2E 与沙盒调研](../industry-research/08-e2e-and-sandbox-testing.md) 的更新说明，保留 §6.1 的工具选型表。

### 7.2 仍需同步的文档（按优先级）

1. `apps/e2e/README.md`：CI 形态、离线口径、`pnpm build` 前置、artifact 策略。
2. [ADR 0009](../adr/0009-ci-quality-gates.md)：CI 表补一行 e2e 工作流（带日期追记，不改原文）。
3. [CI 与部署](../monorepo/ci-cd.md)：加「E2E 不在 PR、nightly 计划」的段落。
4. [环境变量与密钥管理](../monorepo/env-management.md)：加 E2E 的 env 与 secrets 绑定说明。
5. [Knip 死代码检测](../monorepo/knip.md)：补 `apps/e2e` 的 entry / project 配置说明。
6. [架构待办](../monorepo/architecture-todo.md)：P3 的 E2E 行指向本篇与计划页。
7. 侧边栏 `apps/docs/.vitepress/config/zh.ts` 已与本次改动一并登记本篇与行业调研新页（en 站点没有对应分段，保持不动）。

### 7.3 与计划页的对应关系

| 计划页 | 本篇 |
|---|---|
| Phase 2 §8.1 CI 接线 | P0-1 |
| Phase 2 §8.2 risk 矩阵 U11–U16 | 不在本篇展开（用例表已在计划页定稿）；P1-5 提供标签与选择机制 |
| Phase 2 §8.3 P2-5 永真 / 时序断言 | P1-4（生成类型）+ P0-2 / P0-3 的负对照 |
| Phase 2 §8.3 P2-7 CAP / MFA 等待与 U8 / U9 flake | 核心修复已随 `b21ac118` 落地；P2-1 补 quarantine、等待总预算与 20 次循环证据 |
| Phase 2 §8.3 P2-8 `data-testid` | P2-4 |
| Phase 2 §8.3 P2-9 裸常量收口 | 已落地（`5067b4aa`） |
| Phase 2 §8.3 P2-10 契约 bridge 二选一 | 已落地（`5067b4aa`）；剩余为 P1-4 的 `@walnut/api-types` 部分 |
| Phase 2 §8.3 P2-15 慢用例 `test.slow()` | 已落地（`d720c0d3`）；P2-1 保留 flake 预算与 quarantine |
| Phase 2 §8.3 P2-16 static-server 加固 | 已落地（`18dcc9c6`）；P2-3 保留回归验证 |
| Phase 2 §8.3 P2-17 CAP PoW 上界 | 已落地（`18dcc9c6`）；P2-3 保留回归验证 |
| Phase 2 §8.3 P2-11 knip 余项 | 已落地（`5067b4aa`） |
| Phase 2 §8.4 封板配套 | P1-1 |
| Phase 3 其余模块 / auth 面 / profile / 账号池 | 本篇不展开；P1-6 为「账号池 / 并行」提供前置设计 |

---

## 8. 相关文档

- [E2E 沙盒测试计划](./e2e-sandbox-plan.md) —— 分期、决策与完成判据
- [行业调研：E2E 与沙盒](../industry-research/08-e2e-and-sandbox-testing.md) —— 外部实践与证据
- [ADR 0009 CI 质量门禁](../adr/0009-ci-quality-gates.md) —— 门禁分层与 playwright 沙盒退役追记
- [架构待办](../monorepo/architecture-todo.md) —— 测试目录约定与 P3 的 E2E 行
- [CI 与部署](../monorepo/ci-cd.md) —— 现有 CI 全貌
- [环境变量与密钥管理](../monorepo/env-management.md) —— secrets 不进 `if` 的写法
- [`apps/e2e/AGENTS.md`](https://github.com/walnut-admin/walnut-admin/blob/main/apps/e2e/AGENTS.md) —— 必须守住的不变量
- [`apps/e2e/README.md`](https://github.com/walnut-admin/walnut-admin/blob/main/apps/e2e/README.md) —— 操作手册与排障
- Playwright：[CI](https://playwright.dev/docs/ci) · [Sharding](https://playwright.dev/docs/test-sharding) · [Auth](https://playwright.dev/docs/auth) · [Trace Viewer](https://playwright.dev/docs/trace-viewer) · [Retries](https://playwright.dev/docs/test-retries)
