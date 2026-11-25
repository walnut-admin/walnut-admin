# E2E 沙盒测试工程：分阶段实施计划

> 状态：【进行中——Phase 1 已完成并通过 review 修复，Phase 2/3 未开始】2026-11-24 立项。前期设计与可行性结论记录在本文；**前期设计稿本身未入库**（对话产物），本文是它入库后的唯一真源。
> **定位**：把全链路 E2E 从一次性可行性验证推进成一个长期能跑的测试工程 —— 独立 workspace 包、独立数据栈、可复现的测试数据版本，以及后续的 CI 接线与用例矩阵。本篇是执行蓝图，也是 Phase 1 的实施记录。
> **读者**：执行 Phase 2/3 的人与 agent；评审 E2E 设计的人。
> **权威边界**：**为什么这么定**在第 2 节的决策记录与 [ADR 0009](../adr/0009-ci-quality-gates.md) 的 playwright 退役追记；**现在是什么样、怎么跑**在 [`apps/e2e/AGENTS.md`](https://github.com/walnut-admin/walnut-admin/blob/main/apps/e2e/AGENTS.md) 与 [`apps/e2e/README.md`](https://github.com/walnut-admin/walnut-admin/blob/main/apps/e2e/README.md) —— 本篇**不重复**它们的操作细节与不变量；**怎么验**在本篇。与代码冲突时以代码为准。

## 0. 怎么用这份计划

- 阶段**串行**：Phase 2 开工前先读第 7 节（Phase 2 的输入）与第 6 节（已抓到的 bug 形态）。
- 派发时给实施 agent「第 4 节通用纪律 + 该阶段的全部内容」。一个阶段只有在「验证」里的命令**全部跑过**之后才算完成。
- 汇报时把通过、失败、没验证到**分开写**；「环境原因」要给证据（端口、报错原文），不是结论。
- **尚不存在的目标路径不加反引号**：`pnpm walnut lint:docs-refs` 会校验反引号里的仓库路径是否真实存在。所以 Phase 2 才建的工作流文件在正文里用普通文字写。
- 每完成一个阶段：把第 3 节状态表对应行改掉状态，在该阶段末尾追加「结果记录」，并同步第 7 节（哪些观察项已经消化、哪些还在）。
- **复核纪律**：实施 agent 的汇报不等于结论。阶段结束后由编排者亲自复跑关键验证、看 diff；与事实不符的说法记进结果记录。

## 1. 背景与已查实的事实

### 1.1 为什么要有这一层（以及旧沙盒为什么退役）

- 旧的 apps/server/playwright 手工沙盒是一个 demo：**四个月零改动、跑不完整、被 lint / knip / Dockerfile 三套检查忽略** —— 也就是没有任何东西在看着它。它已于 2026-11-25 退役（`3bb90d03` 等 4 个提交，含 lint 豁免、knip 忽略、Dockerfile 与镜像清理）。
- 但它的**设计意图是对的**：批量浏览器、每台设备独立身份。本工程用 `@playwright/test` 把这部分继承下来，不再手写驱动。
- 退役不等于删除历史：旧 demo 的手写数据**不迁移**，需要时从合并提交 `b63ec42a` 取回（[ADR 0009](../adr/0009-ci-quality-gates.md) 已留追记）。

### 1.2 设备身份的真实机制（纠正旧 demo 的假设）

旧 demo 对「设备身份」的假设与真实机制不同。要写进背景的是这几条事实：

- 设备 = **服务端签发的 `DEVICE_ID` signed cookie**。唯一签发点是 `POST /system/device/initial`（`apps/server/libs/system/src/device/device.service.ts`），形态是 `d1_` + 32 位小写 hex（`apps/server/libs/const/src/app/device.ts` 是形态判据的真源）。
- `X-Forwarded-For` 只决定 **IP 维度**：IP 黑名单、限流桶、失败登录计数、定位。它不构成设备身份。
- 所以**全新浏览器 context 天然就是一台新设备** —— 用例不需要（也不应该）伪造指纹；每台设备一个 context 才有确定的身份。
- 反过来的坑也要记住：`POST /system/device/initial` 是 4 次 / 60 秒 **per realIp**，每条用例、每个协议客户端都要一个独立的 127/8 地址，否则第 5 台设备登记就撞限流。这条不变量写在 [`apps/e2e/AGENTS.md`](https://github.com/walnut-admin/walnut-admin/blob/main/apps/e2e/AGENTS.md)。

### 1.3 两条被判死的路线

| 路线 | 判死证据 |
|------|----------|
| 用 `storageState` 复用登录态 | Playwright 的 `storageState({ indexedDB: true })` **恢复不了 IndexedDB 里的 AES `CryptoKey`**（Phase 0 gate 实测）。把坏状态灌进 context 会让应用卡在 splash（模块顶层 await 解密抛错、永不 mount）。结论：登录态逐条用例经 UI 重建 |
| 直接复用 `deploy/docker-compose.yml` | 部署形态是 TCR 镜像 + 证书 + **不发布 DB 端口**；本地要把它参数化到面目全非，才等于自建一份。结论：自建 `apps/e2e/docker-compose.wsl.yml` 与 `apps/e2e/docker-compose.yml` 两份同源 compose |

### 1.4 封板（baseline）的定位

测试库每轮都从零 drop → 迁移 → seed，意味着「这一轮用的测试数据是什么版本」没有记录，而且每次准备都要把迁移与 seed 的每一步重新跑对。现在的默认是 **seal 一次、restore 每轮**：

- **seal**：完整 prepare（迁移 + seed + 提升 root + 放宽 CAP 节流）之后 `pg_dump`，同时写封板清单 —— 当前 HEAD、迁移头、dump 的 sha256、`sys_menu` 行数。
- **restore**：每轮默认动作，先与当前 HEAD 比对，一致才恢复；随后只重做**不在快照里**的运行时状态（`walnut_app` 口令、Redis 设置缓存、`.auth/credentials.json`）。
- **漂移拒绝**：HEAD 相对封板时变化 ⇒ 退出码 2，提示 `--rebuild-baseline`。**「数据版本变了」必须是显式动作。**
- **价值不是提速**：实测全量 prepare 本身只有 2–7 秒。封板换来的东西是**测试数据版本显式可控**。

## 2. 已拍板的决策（2026-11-24）

### 2.1 运行器：新增 `apps/e2e` 独立包

新增独立 workspace 包 `@walnut/e2e`，用 `@playwright/test`。包脚本名统一 `e2e` 前缀（`e2e` / `e2e:smoke` / `e2e:risk` / `e2e:network` / `e2e:report`）—— **刻意避开 `test` 这个名字**：PR CI 跑的是 `turbo test --affected`，包一旦声明 `test` 任务，E2E 就会在每次 PR 上被要求一堆只有本机才有的前置（数据栈、stage 产物、浏览器）。

### 2.2 环境：本地专用栈

独立库 `walnut_e2e` + 独立 Redis；后端跑 `dist-stage`、前端跑 `dist-staging`，中间隔一层**保留 XFF 的测试静态代理**（`apps/e2e/scripts/static-server.ts`，默认 4173）。`deploy/docker-compose.yml` 不直接复用，理由见 1.3。数据栈与 dev 物理隔离：端口 5433 / 6380，dev 是 5432 / 6379。

### 2.3 数据栈宿主：WSL Docker

`apps/e2e/docker-compose.wsl.yml`：PG 18 / Redis 8，只发布到 `127.0.0.1:5433` / `127.0.0.1:6380`（仅回环）。教训写在这里，因为它是被投诉出来的：Windows 便携二进制 + `cmd start` 会经 Windows Terminal 弹**可见窗口**（仓库所有者两次投诉）；WSL 侧进程天然无窗口。**E2E 相关任务一律禁止可见窗口。**

### 2.4 账号：先修 seed，再谈用例

修 `db:seed:pg --admin` 的 OPAQUE identifiers（提交 `7961dc48`；修复前 `--admin` 的口令**登不进 UI** —— 注册与登录的 identifiers 不一致，已用真实库探针证实）。起步只用单个 root 账号；risk 用例的**逐 worker 账号从 Phase 2 起**（并发用例不能共用一台设备、一个用户）。

### 2.5 外网：允许真实外网，但用例隔离

api.ip.sb（定位）与 jsDelivr（CAP 的 WASM）都需要真实外网。用例标题带 `@network` 标记：默认套件不含，`pnpm walnut e2e:network` 单独跑。离线环境里 `e2e:risk` 仍应全绿。

### 2.6 storageState：判死

**不再尝试**保存 / 复用浏览器登录态（证据见 1.3）。不在 project 上挂 `storageState`，不加 `auth.setup` 写盘 —— 坏状态会把应用卡在 splash。代价是每条冒烟用例自己走 UI 登录，慢但确定。

### 2.7 封板：快照恢复 + 封板清单

2026-11-25 拍板「快照恢复 + 封板清单」，实施 `5c2e2b89`：seal 一次（完整 prepare 后 `pg_dump` + 清单），每轮 restore（实测 1.4–3.5s）；HEAD 相对封板时变化 ⇒ 退出码 2 并提示 `--rebuild-baseline`；`E2E_SKIP_BASELINE=1` 退回全量 prepare（实测 2.4–6.8s）。定位见 1.4 —— **测试数据版本显式可控**，不是提速。

### 2.8 CI：不进 PR 门禁

PR 的 quality 已经约 30 分钟，且 fork PR 没有 secrets。做法：**nightly 全量 + 手动 dispatch**（Phase 2 实施）；部署之后只做匿名只读的浏览器 smoke，**不在生产做认证写入**。

## 3. 阶段总览

| 阶段 | 内容 | 依赖 | 本地能否完整验证 | 状态 |
|------|------|------|------------------|------|
| 1 | 包与数据栈、设备生命周期用例、封板、命令表入口 | 无 | 能（WSL 常驻栈） | 已完成（2026-11-25） |
| 2 | CI 接线、risk 矩阵补全、review 暂缓项 | 1 | **部分**：nightly 与 artifact 的行为要等 GitHub runner 首跑 | 未开始 |
| 3 | 其余模块 spec、设备 profile 矩阵、部署后 smoke | 2 | **部分**：独立 sandbox 部署要主机 / 域名 / 证书 | 未开始 |

## 4. 通用纪律（每个实施 agent 必读）

1. **不提交、不推送由仓库所有者掌控。** 实施 agent 只改工作区；提交与推送按所有者的指示执行。
2. **禁止可见窗口。** WSL 里的进程天然无窗口；Windows 侧的子进程一律 `windowsHide`（`apps/e2e/scripts/pnpm.ts` 已统一设置）。不许 `start` 终端、不许 `cmd start`。
3. **数据栈只动 `walnut_e2e` / 5433 / 6380。** dev 库（5432 / 6379）与生产**绝不触碰**；破坏性操作之前过 `apps/e2e/scripts/env.ts` 的 `assertE2e*` 安全闸，别绕开它。
4. **E2E 的密钥级文件不上传任何公开位置**：`credentials.json`、`storageState`、trace、截图、HTML 报告里含 token 与 cookie。
5. **改 server / admin 源码的用例必须能过退出码口径**：0 成功、1 跑起来了但结果不对、2 环境没准备好（详见 README）。「2」不该被写成用例失败。
6. **Redis 只按 deviceId 精确删**，绝不 FLUSHDB / FLUSHALL；键形对齐 `apps/server/libs/const/src/app/cache.ts`。
7. **汇报里的事实要能被复核**：说某个文件 / 端口 / 库的状态之前先实测一次；贴命令与输出摘要，不许把没验证说成通过。
8. **遇阻先停**：与本计划不符的事实（某条不变量已变、某个路径不存在）在汇报里说明，不自行扩大范围。
9. 文档改动照根 `AGENTS.md` 纪律 11：过文档门禁、不写会腐烂的计数、不写原始的双花括号 GitHub 表达式。

## 5. Phase 1：包、用例与封板（已完成）

### 目标

`apps/e2e` 能从零跑起一条完整链路：真实浏览器 × 真实后端进程（dist-stage）× 独立 PG / Redis 栈，覆盖设备身份签发与续期、CAP、签名握手、风控拦截、登录 / 首页 / 用户 CRUD。跑一轮的数据准备要可复现、可判漂移。

### 改动清单（已完成）

1. **包**：`apps/e2e`（`@walnut/e2e`，private）—— `@playwright/test`、`apps/e2e/scripts/run.ts` 编排入口、`apps/e2e/playwright.config.ts` 的 project 划分（stack-setup / auth-setup / smoke / risk / network）。
2. **数据栈**：`apps/e2e/docker-compose.wsl.yml`（本机采用，WSL 常驻）与 `apps/e2e/docker-compose.yml`（Docker 在 Windows 或原生 Linux 的通用形态）—— 内容同源，差别只有端口发布与命名。
3. **编排**：`apps/e2e/scripts/run.ts` 的顺序是硬约束 —— 抢 run 级锁 → preflight → 基线决策 → stack-info → `playwright test`。相关脚本：`apps/e2e/scripts/baseline.ts`（封板 / 恢复）、`apps/e2e/scripts/preflight.ts`（前置检查）、`apps/e2e/scripts/static-server.ts`（静态代理 + 保留 XFF）、`apps/e2e/scripts/runtime-reset.ts`（快照外的运行时状态）。
4. **用例**：设备生命周期 spec（`apps/e2e/tests/risk/device.spec.ts`）与冒烟面（UI 登录 / 首页 / 用户 CRUD）；`apps/e2e/tests/fixtures.ts` 的两个 auto fixture 负责设备与 Redis 键的清理。
5. **命令表入口**：`e2e` / `e2e:smoke` / `e2e:risk` / `e2e:network` / `e2e:report`（`7057f746`）。**不进 prepush，也不进 PR CI**（理由见 2.1 与 2.8）。
6. **文档**：`apps/e2e/AGENTS.md`（不变量与坑）、`apps/e2e/README.md`（操作手册、退出码、封板与排障）。

### 验证

```bash
pnpm walnut e2e
pnpm walnut e2e:smoke
pnpm walnut e2e:risk
pnpm walnut e2e:network
pnpm --filter @walnut/e2e lint
pnpm --filter @walnut/e2e types:check
```

前置条件（缺一项就按退出码 2 失败）与数据栈操作见 `apps/e2e/README.md`：`pnpm setup-env`、`pnpm walnut build:stage`、`pnpm --filter @walnut/server build:stage`、`playwright install chromium`、数据栈两条容器都 healthy。

### 完成判据

- 全量套件在 WSL 常驻栈上全绿；`e2e:risk` 在**离线**状态下全绿（`@network` 被 project 隔离）。
- 封板清单可判漂移：HEAD 变化时以退出码 2 拒绝，并给出重新封板的处置。
- fixtures 在断言失败时也会清理设备与 Redis 键。
- 命令表入口不进 prepush 与 PR CI（判据：`tooling/scripts/src/ci/prepush.ts` 的 `PREPUSH_GATES` 里没有 e2e 项；`apps/e2e` 的 `package.json` 没有 `test` 任务，PR CI 的 `turbo test --affected` 因此扫不到它）。

### 结果记录（2026-11-25）

- `11f4e712`：新增 `apps/e2e` 包与设备生命周期用例 —— **首轮 15/15 全绿**（全量套件含 setup、冒烟与 risk 三面）。`7057f746`：命令表入口 `e2e` / `e2e:smoke` / `e2e:risk` / `e2e:network` / `e2e:report`。
- 阶段一 review（2026-11-25）：**0 P0 / 6 P1 / 21 P2**。P1 全部修复，另修 10 条 P2（提交 `c60c967c`…`b8a4132d`，5 个）；**其余 P2 暂缓**，逐条列进 Phase 2 的改动清单（第 8.3 节），不另立账。
- review 修复后复跑：全量 E2E 在 WSL 栈 **15/15（5.4m）**、`e2e:network` 2/2、`e2e:risk` 10/10。
- 附带成果（都是「让下一轮不再踩同一个坑」的基础设施）：`apps/e2e/AGENTS.md`、`apps/e2e/README.md`、run 级互斥锁（`apps/e2e/scripts/pg-lock.ts`）、fixtures 自动清理（首跑清掉 113 个遗留的设备作用域键）、preflight、退出码三档口径。
- 记录口径的一处更正：review 的 P2 编号（P2-5 / P2-7 / …）只在本篇与那次 review 记录里有效；不要把它们当成本仓其他文档的通用编号。

## 6. E2E 的第一批战果：三个真 bug

这一层的价值首先在于**它能抓到单元测试与接口测试都看不见的错**。Phase 1 抓到的三个真 bug 都是这个形态：单看某一侧全部正确，只有真实浏览器 × 真实后端 × 真实数据栈串起来才暴露。

### 6.1 前端自愈重放被 HTTP 层去重嫁接到兄弟请求上（`7f23f7f1`）

- **现象**：40605 自愈**成功**的用户被误踢到 `/not-allowed?type=device`。自然复现率 12.5%，放大实验 1/1。
- **根因**：自愈后的重放请求被 HTTP 层的 cache / throttle / merge 去重嫁接到**自愈之前**发出的兄弟请求的响应上 —— 那个兄弟请求的拦截器已经把**共享的同一个 config** 的 `_deviceResetRetried` 置位，重放带着这个 flag 又吃一次 40605。
- **修复**：healed 分支的重放**强制绕开三层去重**（`_cache_force_update` / `_throttle = 0` / `_mergeRequest = false`）。只对这次重放关闭去重，非 GET 或没有 cache/throttle 的请求上这些开关是无操作。
- **守卫**：E2E U8 用例守此行为（`apps/e2e/tests/risk/device.spec.ts`）。

### 6.2 `VITE_SERVER_STATIC_PUBLIC_KEY` 从未设置过（`850f4dcc`）

- **现象**：UI 口令登录必然 `serverStaticKeyMismatch`。
- **证据**：密文从首提交起就是**空串** —— 由历史密文的长度取证，不是推断。
- **修复**：写入派生公钥。**stage / prod 需要重新构建 / 部署才生效**（这条留到 Phase 2 的观察项里）。

### 6.3 `db:seed:pg --admin` 登不进 UI（`7961dc48`）

- **现象**：seed 播出来的 admin 账号口令登录失败。
- **根因**：OPAQUE 注册缺 identifiers —— 注册与登录用的 identifiers 不一致。
- **证据**：真实库探针证实了这处不一致；修复在 `7961dc48`，E2E 的 UI 登录链路是这条链路的第一个真实验证。

## 7. 已知问题与观察项（Phase 2 输入）

1. **U8 / U9 偶发 flake**：自愈后弹出 CAP 对话框（`DEVICE_NEW` / `DEVICE_PRIVATE` 是 critical 因子、CAP token 一次性）撞上 `waitForLoadState('networkidle')` 的**无超时等待** ⇒ 用例在 120s 处超时。修复方向：`networkidle` 加超时 + 自愈后识别 / 关闭 CAP 对话框（review P2-7 一类）。
2. **admin 的 eslint / vite 偶发原生崩溃 `0xC0000005`**：Windows 本机、与负载相关、成因未明（[tooling 计划](./tooling-restructure-plan.md) 第 14 节有排查记录）。处置：重跑；E2E 相关任务一律禁可见窗口。
3. **knip 已让 `apps/e2e` 可见**：`@walnut/contract` 作为 devDep 未被使用（当前 `apps/e2e` 的源码没有 import 它），另有 16 个未使用导出。清理待做（Phase 2 的 P2-10 / P2-11）。
4. **`VITE_SERVER_STATIC_PUBLIC_KEY` 修复后 stage / prod 需要重新构建 / 部署**才生效 —— 环境侧的跟进项，不在代码仓内。

## 8. Phase 2：CI 接线、risk 矩阵与 review 暂缓项（未开始）

### 目标

- 让 E2E 有一份**不阻塞 PR、但每周真的在跑**的证据：nightly 全量 + 手动 dispatch，失败可下载报告。
- 把 review 暂缓的 P2 清掉 —— 尤其是**会制造假红的等待窗口**与**永真断言**。
- 把 risk 矩阵补到「设备身份 + 风控」的完整面：IP 黑名单、失败登录、CAP 重武装、MFA trusted、trust 过期、设备管理页。

### 改动清单

#### 8.1 CI 接线

- **新增工作流**：`.github/workflows/` 下新增一份 e2e 工作流（文件名 e2e.yml）。触发：`schedule`（nightly 全量）+ `workflow_dispatch`。
- **草案要点**（来自设计稿，照抄）：
  - **不把 `secrets` 写进 step / job 的 `if`** —— 会被判 `Invalid workflow file`、启动即失败 0 个 job。写法按 [`env-management.md`](../monorepo/env-management.md) 的硬约束（绑到 job 级 `env`，用 `env.XXX != ''` 判断）。
  - **浏览器不缓存**：`playwright install chromium` 每次装。缓存它的收益不值得多一条「缓存坏了导致假红」的路径。
  - **`concurrency` 防并行**：同一时间只允许一份 e2e 工作流在跑（group 固定、不取消在途）。
  - 跑全量（`pnpm walnut e2e`，含 `@network`）；失败时上传 `playwright-report/` 与 `test-results/` artifact，**私有仓库保留 7 天**。
- **前置**：runner 上怎么起数据栈在实施时定，结论记进结果记录。两种形态都可用：用 job service 容器起 PG / Redis（同版本镜像），或直接在 runner 上跑 compose。**不得**把部署 compose 拿来改。
- **文档**：`apps/e2e/README.md` 加「CI 上的形态」一节（前置、命令、artifact、怎么复现失败）；ADR 0009 的 CI 表补一行 e2e 工作流（带日期追记，不改原文）。注意 `apps/e2e/README.md` 没有字数预算，但仍守住「一条规则只写一次」。

#### 8.2 risk 矩阵补全（用例表在本文定稿）

标题带 `@risk` 标记；project / grep 的具体形态在实施时定，判据是「U11–U16 都真的被执行」（见完成判据，不接受被 grep 静默漏掉）。断言口径统一四类：**响应码**（contract 的 `packages/platform-any/contract/src/response-code.ts`）/ **URL**（`/not-allowed?type=…`）/ **DB 行** / **Redis 键**。

| 编号 | 用例 | 断言面 |
|------|------|--------|
| U11 | IP 永久黑名单：把 realIp 写进永久名单后，请求被拒并跳转 | 响应码 40603（`NOT_ACCEPTABLE_IP_BLOCKED`）；URL `/not-allowed?type=ip`；永久名单住在 `app_setting` 的 `app.global.ipBlackList`（JSON 数组，见 `apps/server/libs/const/src/app/cache.ts`） |
| U12 | 失败登录 5 次 → 临时拉黑 | 响应码按失败第 5 次之后的口径（实施时以服务端实际返回为准，别猜）；Redis 键 `risk:ip_blacklist:<ip>` 存在且带 TTL |
| U13 | post-auth CAP 重武装 | 响应码 40111（`UNAUTHORIZED_BOT_VERIFY_FAILED`）在需要重验的请求上出现；CAP 对话框可见；验证通过后同一请求重放成功 |
| U14 | MFA trusted 后免 user-device CAP | `user_device.trusted` 为 true 且 `trusted_expired_at` 在将来 ⇒ 该设备再登录不弹 user-device CAP（对照：未 trusted 的设备会弹） |
| U15 | trust 过期 → CAP | 把 `user_device.trusted_expired_at` 回填到过去 ⇒ 下次登录重新要求 CAP；DB 行是唯一判据（不靠 UI 文案） |
| U16 | 设备管理页（root） | 页面可达、列表含本条用例造的设备、操作（如 ban / lock）后的状态与 DB 行一致 |

**逐 worker 账号**：并发用例不共用用户与设备 —— 每个 worker 一个账号，避免「上一条用例把设备 ban 了，下一条用例登不上」。账号池的形态在实施时定，但**必须在基线的 seed 里可重复构造**（否则 restore 之后账号就没了）。

#### 8.3 review 暂缓项（逐条）

来自 2026-11-25 review 的 P2，编号只在那份 review 里有效：

1. **P2-5 永真断言与时序断言改造**：把 `expect(x).toBeTruthy()` 这类「只要有值就算过」的断言换成具体判据（响应码、行数、URL），把 `waitForTimeout` 换成条件等待。判据：改完之后故意破坏被测行为，对应用例必须红（负对照）。
2. **P2-7 CAP / MFA 等待窗口 + U8 / U9 flake**：`waitForLoadState('networkidle')` 加超时；自愈后识别并关闭 CAP 对话框；选择器改用 `:visible`。**这是 Phase 2 的验收重点**：flake 修复要有「20 次循环无复现」的证据（见完成判据）。
3. **P2-8 `data-testid`**：登录表单、侧边栏、MFA 卡片三处加 `data-testid`，用例不再按文案或 DOM 结构选元素。改 admin 源码要过 `pnpm --filter @walnut/admin lint` 与 `types:check`。
4. **P2-9 裸常量收口**：用例里散落的端口、库名、超时、响应码收口到已有常量（`apps/e2e/scripts/env.ts`、contract 的 response-code），别在 spec 里重复字面量。
5. **P2-10 契约 bridge 二选一**：`@walnut/contract` 的 cookie / routes / response-code 经 CJS bridge 引入（后端包是 CJS 双模，E2E 是 ESM —— 需要一层薄的 bridge），**或者**删掉这个 devDep、把用例里的对应字面量收口到 E2E 自己的常量。**二选一，不许两边都留**。
6. **P2-15 慢用例 `test.slow()`**：明确标记慢用例，超时预算按用例给，不用全局放宽掩盖问题。
7. **P2-16 static-server 加固**：`decodeURIComponent` 的异常处理、响应流的错误处理（客户端中途断开不该把进程打崩）。
8. **P2-17 CAP PoW 求解上界**：求解循环要有上界与明确报错，避免难例把用例拖到超时（与 P2-7 一起验收）。
9. **P2-11 余项**：knip 报出的未使用导出与依赖清理（与 P2-10 的结论一致时一并处理）。

#### 8.4 封板配套（可选）

- 基线机制的**通用栈参数化**：容器名可配置，让非 WSL 的通用栈也能封板（目前是本机路径写死）。
- 漂移检测加**工作区脏检查**（可选）：HEAD 不变但迁移 / seed 有未提交改动时给出提示。**注意**：这是提示不是拒绝 —— 未提交改动本来就判不出漂移（[`apps/e2e/AGENTS.md`](https://github.com/walnut-admin/walnut-admin/blob/main/apps/e2e/AGENTS.md) 已写明「基线有效」不等于「数据最新」）。

### 验证

```bash
pnpm walnut e2e
pnpm walnut e2e:risk
pnpm walnut e2e:network
pnpm --filter @walnut/e2e lint
pnpm --filter @walnut/e2e types:check
pnpm walnut lint:workflows
pnpm walnut lint:workflows-shell
pnpm walnut lint:docs-refs
pnpm walnut build:docs
```

外加两件只能人工确认的事：

- **nightly 工作流的首跑**：在 GitHub 上手动 dispatch 一次，看 job 全绿、失败时 artifact 真的能下载。本地验证不到（tooling 计划的阶段 8 同款盲区）。
- **flake 的循环证据**：对修过的 U8 / U9 连跑 20 次，记录全绿。**只承认贴在汇报里的原始输出**，不接受「应该好了」。

### 完成判据

- nightly 工作流首跑全绿（dispatch 一次 + 一次定时触发，或所有者接受 dispatch 证据）。
- `pnpm walnut e2e` 全量在 WSL 栈全绿，且**含新增的 risk 用例**（U11–U16 都在跑，不是被 grep 漏掉）。
- `pnpm walnut e2e:network` 单独可跑、2/2。
- flake 修复后有 **20 次循环无复现**的证据。
- review 的 P2 暂缓项全部关闭：要么改掉、要么在本文写下「不改」的理由（不接受悄悄消失）。

## 9. Phase 3：其余模块与更远（未开始）

### 目标

把 E2E 从「设备身份 + 冒烟」扩成「关键业务链路」—— 只在**跨端**才值得测的地方补（判据见 `architecture-todo.md` 的测试目录约定：需要浏览器或需要「库被重建过」才来这一层）。

### 改动清单

1. **其余模块 spec**：菜单 / 角色 / 设置 / i18n / 回收站 / 操作日志 —— 每条先问「它能不能在这一层被测」，能就别只补接口测试。
2. **auth 面**：MFA（绑定 / 解绑 / 恢复码）、会话（多设备在线 / 踢下线）、登出。
3. **设备 profile 矩阵**：**1 个 mobile profile 起步**。本仓的 risk 不消费浏览器指纹（设备身份是服务端 cookie，见 1.2），所以**不铺全矩阵** —— 铺了只是给同一条逻辑多跑几遍。
4. **worker 账号池**：并发用例的账号分配与回收（Phase 2 的最小形态在 Phase 3 收敛成池）。
5. **可选**：L4 独立 sandbox 部署（要主机 / 域名 / 证书）—— 不为它先做任何设计。
6. **可选**：生产部署后的 runner 侧匿名只读浏览器 smoke（**不做认证写入**）。

### 验证

```bash
pnpm walnut e2e
pnpm walnut e2e:risk
pnpm walnut e2e:network
pnpm --filter @walnut/e2e lint
pnpm --filter @walnut/e2e types:check
pnpm walnut build:docs
```

### 完成判据

- 新增模块 spec 全绿，且每条都有明确的失败判据（故意破坏被测行为必须红）。
- 文档同步：`apps/e2e/AGENTS.md` 的不变量、`apps/e2e/README.md` 的操作面、根 `AGENTS.md` 的常用命令（若命令面变化）、`architecture-todo.md` 的 P3 E2E 行。
- 若做了 profile 矩阵或账号池：写下「为什么是这个规模」的判据，不写用例数。

## 10. 相关文档

- [ADR 0009 CI 质量门禁](../adr/0009-ci-quality-gates.md) —— 门禁三层与 playwright 沙盒退役追记
- [架构待办](../monorepo/architecture-todo.md) —— P3 的 E2E 行指向本页
- [环境变量与密钥管理](../monorepo/env-management.md) —— workflow 里 `secrets` 不许写进 `if` 的写法
- [CI 与部署](../monorepo/ci-cd.md) —— 门禁在 CI 里的接线
- [`apps/e2e/AGENTS.md`](https://github.com/walnut-admin/walnut-admin/blob/main/apps/e2e/AGENTS.md) —— 改 E2E 代码必须守住的不变量
- [`apps/e2e/README.md`](https://github.com/walnut-admin/walnut-admin/blob/main/apps/e2e/README.md) —— 操作手册、封板与排障
- [tooling 收束与根脚本改造计划](./tooling-restructure-plan.md) —— 命名规范与「跑到哪算完成」的口径同源；admin 原生崩溃的排查记录在该篇第 14 节
- Playwright 文档：[Best Practices](https://playwright.dev/docs/best-practices) · [Authentication](https://playwright.dev/docs/auth) · [Emulation](https://playwright.dev/docs/emulation) · [CI](https://playwright.dev/docs/ci)
