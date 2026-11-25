# apps/e2e — 全链路 E2E 的包级指引

> 先读根 `AGENTS.md`。**人看的操作手册是 [`README.md`](./README.md)（怎么跑）**，
> 本文件只写「改这里的代码时必须守住什么」——按 agents.md 的「最近的赢」约定，不重复根文件。

## 这一层是什么

真实浏览器 × 真实后端进程（stage 产物）× **独立** PostgreSQL / Redis 栈（5433 / 6380）。不测单元逻辑（各包 vitest 的事），只测跨端链路：设备身份签发与续期、CAP、
签名握手、风控拦截、登录 / 首页 / 用户 CRUD。

**stack profile（P1-6 Phase A）**：库名 / 后端·socket·静态代理端口 / 基线目录 / IP 段由
`scripts/stack-profiles.ts` 的 profile 表决定（单一真源，`default` 与改造前逐字相同）：

| profile | 库 | 后端 / socket / 静态代理 | IP 段 | 基线目录 |
|---|---|---|---|---|
| `default`（不设 `E2E_STACK_PROFILE`） | `walnut_e2e` | 3001 / 3002 / 4173 | `127.0.{1,2}.*` | `.e2e/` |
| `smoke` / `risk` / `network` | `walnut_e2e_<p>` | 3101–3103 / 3011–3013 / 4181–4183 | `127.0.{11,21,31}.*` 与 `{12,22,32}` | `.e2e/<p>/` |

`E2E_STACK_PROFILE` **只选 profile 名**，不开放端口 / 库名覆盖（任意覆盖会让安全闸失去意义）；
未知值 fail-fast（退出码 2）。profile 与 Playwright project 同名 1:1：命名 profile 跑别的
project 会被 `run.ts` 拒绝。本地多 profile 仍串行（全局锁），CI 每个 job 独立 runner / checkout。

编排入口只有一个：`scripts/run.ts`（包脚本 `e2e` / `e2e:smoke` / `e2e:risk` / `e2e:network`
都走它）。顺序是**硬约束**：抢 run 级锁 → `scripts/preflight.ts` → 基线决策（`ensureTestDatabase`，
在 `scripts/baseline.ts`：restore 或全量 prepare + seal）→ `stack-info` → `playwright test`。

## 前置命令（缺一项就按退出码 2 失败）

```bash
pnpm setup-env                                   # apps/server/env-local/.env.stage（seed 要 AUTH_OPAQUE_SECRET）
pnpm build                                        # @walnut/utils / @walnut/contract 的 CJS dist（lib/protocol 经 require 消费）
pnpm walnut build:stage                          # admin → apps/admin/dist-staging
pnpm --filter @walnut/server build:stage          # 后端 → apps/server/dist-stage
pnpm --filter @walnut/e2e exec playwright install chromium
```

数据栈（本机是 WSL 常驻栈，四条 compose 命令见 README「WSL 常驻栈」）。**跑之前必须维持一个
隐藏的 WSL 会话**，否则发行版会被空闲关机、容器随之中断：

```bash
powershell -NoProfile -Command "Start-Process wsl.exe -ArgumentList @('-d','Ubuntu-24.04','--','sleep','infinity') -WindowStyle Hidden"
```

**本机禁止弹任何可见窗口**：WSL 里的进程天然无窗口；Windows 侧的子进程一律 `windowsHide`
（`scripts/pnpm.ts` 已统一设置），别再 `start` 一个终端。

## 命令

```bash
pnpm walnut e2e           # 全量（含 @network）；默认从基线 restore，没有基线时全量 prepare 并封板
pnpm walnut e2e:smoke     # 冒烟：setup + UI 登录 / 首页 / 用户 CRUD
pnpm walnut e2e:risk      # 设备生命周期（不含 @network）
pnpm walnut e2e:network   # 只跑 @network（依赖真实外网）
E2E_STACK_PROFILE=smoke pnpm walnut e2e   # 在 smoke profile（独立库 / 端口 / 基线）上跑同名 project
pnpm walnut e2e:report    # 打开上一轮 HTML 报告（常驻本地服务）
pnpm walnut e2e:stack:status   # 数据栈状态（容器 / PG·Redis / 端口 / 基线；只读，--strict 供门禁）
pnpm walnut e2e:stack:up       # 起数据栈（自动选 WSL / 通用 compose；不碰 Playwright）
pnpm walnut e2e:stack:down     # 停数据栈（默认保留数据卷；--volumes 连卷删）
pnpm walnut e2e:clean          # 清 .e2e 调试残渣（dry-run 默认；保留基线三件套与 stack.json）
pnpm --filter @walnut/e2e e2e -- --rebuild-baseline  # 强制全量 prepare + 重新封板 + 跑用例
node apps/e2e/scripts/preflight.ts   # 只查前置，不动库
node apps/e2e/scripts/prepare-db.ts  # 只重建库（自己抢锁、只罩这一段；不封板）
pnpm --filter @walnut/e2e lint && pnpm --filter @walnut/e2e types:check
```

## 封板（baseline）

`scripts/baseline.ts`：**seal 一次、restore 每轮**。封板清单（版本 3）记 `profile` / `database`
（restore 前断言与当前 profile 的库名一致）、`dataKey`（数据树哈希，路径清单在
`scripts/e2e-data-paths.ts` 的 `E2E_DATA_PATHS`）与 dump / credentials 两者的 sha；restore 前
逐个校验，dataKey 变了、数据路径有未提交改动、或清单属于别的 profile 即拒绝（退出码 2，提示
`--rebuild-baseline`）。命名 profile 的三件套在 `.e2e/<profile>/`，凭据在 `.auth/<profile>/`。
改这一块代码时必须守住：

- **快照划界**：快照 = 迁移 + seed + 提升 root + CAP 放宽完成后的**库内数据**。**不在**快照里、
  每轮重做的运行时状态（`walnut_app` 口令 / Redis 设置缓存 / `.auth/credentials.json`）只住在
  `scripts/runtime-reset.ts`。给 prepare 加后置步骤时先判断它属于哪一边 —— 别两边都写，也别漏；
- **dump/restore 只碰 `walnut_e2e`**：沿用 `scripts/env.ts` 的 `assertE2e*`，与 prepare-db 同一口径；
  容器名默认 `e2e-wsl-postgres`（`E2E_PG_CONTAINER` 覆盖），win32 经
  `wsl -e bash -c "docker exec …"`、其它平台直接 `docker exec`（`scripts/pg-container.ts`）；
  Windows 侧一律 `windowsHide: true`；
- **封板原子化**：dump / credentials / 清单先各写临时文件，提交时**先撤旧清单再 rename** ——
  任何时刻都不会出现「新 dump + 旧清单」；中断留下的「没有清单」状态会被下一轮判成半成品并拒绝；
- **基线文件 gitignored**（`apps/e2e/.e2e/`），不入库；换机器 / 清目录后首次运行自动全量 prepare
  并重新封板；
- **漂移判据是 dataKey + 工作区脏**：只改文档 / 前端 / 后端源码**不**触发；改了迁移 / seed
  （无论提交与否）都会退出 2。提交后仍需 `--rebuild-baseline`（旧快照的数据不等于新源码的数据）。
  别把「基线有效」读成「数据一定是最新的」；
- **`E2E_SKIP_BASELINE=1` 是逃生口**（排查基线本身的问题用）：忽略基线、全量 prepare、不封板。
  别把它当日常入口 —— 那样又回到每轮全量重建，并失去「迁移 / seed 变了」的漂移判定。

## 端口与安全闸

| 用途 | 端口 | 备注 |
|------|------|------|
| 后端（dist-stage） | 3001（default） | `webServer.command = node scripts/start-backend.ts`，cwd 是 `apps/server` |
| 后端 socket.io | 3002（default） | 与 3001 分开，避免与 dev 的 3000 混 |
| 静态代理（伺服 dist-staging + `/api` `/socket` 反代） | 4173（default） | `scripts/static-server.ts` |
| PostgreSQL / Redis | 5433 / 6380 | 所有 profile 共用；库名按 profile（`walnut_e2e` / `walnut_e2e_<p>`） |

命名 profile 的端口见文件开头的 profile 表（后端 3101–3103、socket 3011–3013、静态代理
4181–4183）；preflight 的「端口空闲」检查按当前 profile 的三个端口做。

端口 / 库名都来自 `scripts/stack-profiles.ts`（profile 表），别在别的文件里拼。安全闸分两层：
`scripts/env.ts` 的 `assertE2e*`（库名必须同时满足形态正则 `^walnut_e2e(?:_[a-z]+)?$` **且**
等于当前 profile 的库名；实参是常量时是**恒真的机械标记**，防将来把常量换成字面量），以及
`lib/pg.ts` 连上之后 `SELECT current_database()` 的**真断言**。要动「连哪个库 / 哪个端口」的
代码，先读这两处的注释。

## 必须保持的不变量

1. **`SIGN_USER_AGENT` 只有一份**（`lib/protocol/sign.ts`）。`playwright.config.ts` 的
   `use.userAgent` 与 `newBrowserContext` 都必须 import 它 —— 签名原文取 `navigator.userAgent`，
   与请求头必须逐字一致；另抄一份迟早漂移，症状是 40112「签名无效」。
2. **XFF 只加在同源 `/api/` 请求上**（`installRealIpRoute`）。整包 `extraHTTPHeaders` 会让
   第三方跨域资源（如 CDN 上的 WASM）的请求也带上自定义头 → CORS 预检失败 → 依赖它的组件
   进错误态。
3. **库准备（restore / prepare-db）必须在 `playwright test` 之前**：Playwright 的 webServer 先于
   globalSetup 启动，而 webServer 里的后端一连库就要有库。别把建库 / 恢复挪进 globalSetup。
4. **`POST /system/device/initial` 是 4 次 / 60 秒 per realIp**：每条用例、每个协议客户端都要一个
   独立的 127/8 地址（`uniqueLocalIp()`）。共用 127.0.0.1 会让第 5 台设备登记撞 42900。
   **每个 profile 用独立的第三段**（`stack-profiles.ts` 的 `localIpFor`：default 1–2、smoke 11–12、
   risk 21–22、network 31–32）—— 风控的 `risk:rate:ip:*` 是 Redis 键，同机共享 Redis 时只有
   IP 段不相交才不会串桶。改公式要同时改单测的「跨 profile 不重叠」断言。
5. **Redis 只按 deviceId 精确删**（`deleteDeviceScopedKeys`；`scripts/redis-gc.ts` 的跨轮对账
   同样只 SCAN + 精确 DEL），**绝不 FLUSHDB / FLUSHALL**（compose 里这两个命令已被重命名禁用）。
   键形对齐 `apps/server/libs/const/src/app/cache.ts`，服务端改键形时**两张表都要同步**：
   fixture 的 `lib/redis.ts`（`deviceScopedKeyPatterns` / `riskDeviceStatePatterns`）与 GC 的
   `DEVICE_KEY_FAMILIES`；`lib/redis.test.ts` 会拿 GC 表逐族交叉校验，漏一族即红。
   **profile 化不加 Redis 前缀、也不换逻辑库**（P1-6 设计结论，理由见 `stack-profiles.ts` 头注释）：
   键形由 server 拥有；deviceId 每轮随机、跨 profile 撞不上；全局键由同一份基线数据派生，本地
   串行 / CI 独立 Redis。将来要本地并发 profile，先加**每 profile 一个 Redis 实例**，不是键前缀。
6. **一台机器同一时间一个全量 run**：锁在 `scripts/pg-lock.ts`，由 `run.ts` 整轮持有。两个
   worktree 并发时第二个等全局锁，120s 内抢不到就报持锁者并退出（不排队、不静默）。
   **两把锁嵌套**：先全局锁（`2026112401`，不变量 6 的本体），再 profile 锁（基 key + profile
   序号，default 与全局同 key 不重复抢）。profile 锁不是并发通行证 —— 本地多 profile 仍在
   全局锁上串行；CI 每个 job 独立 PG 实例，profile 锁只提供日志归属与同 profile 重入保护。
7. **storageState 不可复用**（IndexedDB 里的 AES `CryptoKey` 恢复不了，Phase 0 gate 已判死）：
   别再加 `auth.setup` 的写盘、别在 project 上挂 `storageState` —— 坏状态会把应用卡在 splash。
8. **trace / 截图 / HTML 报告含请求头与响应体**（token、cookie）：只留本机，**不许上传任何
   公开位置**。
9. **CAP 节流与设备目录的「放宽」只改库**：全量 prepare 时把 `capjs.config.throttleLimit` 调大
   （仅本栈库的设置行），restore 继承快照里的这个值。别把测试专用的放宽写进源码。
10. **设备清理归 fixture**（`tests/fixtures.ts` 的两个 auto fixture）：新造的设备要 `trackDevice`，
    别在用例末尾手写 `cleanupDevices(...)` —— 断言失败时那几行根本不会执行。

## 排障

- **静态代理端口被残留进程占用（实测案例，default 是 4173）**：默认**不复用**已监听的进程
  （`E2E_REUSE_SERVER=1` 才 opt-in，理由见 `playwright.config.ts`），端口被占时 preflight 直接按
  退出码 2 失败。`netstat -ano | findstr :4173`（命名 profile 换成 4181–4183）找到残留的 node
  停掉再跑。确认「后端 / 静态代理上跑的就是本轮产物」时可用 `E2E_REUSE_SERVER=1` —— preflight
  会改查「可达 + 身份」（后端 `/health/ready`、静态代理的 index.html）并打印复用警告；否则别用
  复用绕过去：那会连到旧产物 / 旧库的后端。
- **5433 / 6380 连不上**：`docker compose ps` 看两个容器是否 healthy；再 `wsl -l -v` 看发行版
  STATE（会被空闲关机），必要时重起隐藏会话。
- **登录框等不出来 / 页面停在 `forbidden`**：先看 `.e2e/stack.json` 的 `artifacts.*.mtime`
  （是不是旧产物），再看 4173 是不是被别的静态服务占着。
- **40109「重复认证」**：同设备同用户残留了 active refresh token。重登链路要
  `clearRefreshTokensForDevice` + `deleteAuthSessionsForDevice`（`reloginOnSameDevice` 是范本）。
- **改了服务端缓存键 / 节流参数**：先回 `apps/e2e/lib/redis.ts` 与 prepare-db 的放宽逻辑对一遍，
  两边按键名逐字对应。
