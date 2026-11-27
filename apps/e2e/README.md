# 全链路 E2E（apps/e2e）

真实浏览器 × 真实后端进程（stage 产物）× **独立** PostgreSQL / Redis 栈的跨端测试。
这一层不测单元逻辑（那是各包 vitest 的事），只测跨端链路：设备身份签发与续期、CAP 挑战、
签名握手、风控拦截、登录 / 首页 / 用户 CRUD，以及 Phase 3 起的模块链路（菜单 / 角色 / 设置与
权限生效）、auth 面矩阵（MFA 绑定态 / 会话 / 登出）和 mobile（Pixel 7）布局。扩面批次另有
全站页面可达链（`tests/pages/`）与 socket / 锁屏 / 权限 / 角色 / 回收站 / MFA 强制绑定旅程
（`tests/journey/`，J1–J10）。

数据栈与 dev **物理隔离**：独立端口（5433 / 6380，dev 是 5432 / 6379）+ 独立库（默认
`walnut_e2e`；`smoke` / `risk` / `network` / `pages` / `journey` profile 各用 `walnut_e2e_<profile>`）。
`scripts/env.ts` 的安全闸在任何破坏性操作之前核对库名与端口 —— 配错或 env 读串都在
`DROP DATABASE` 之前当场抛错，而不是在之后。

## stack profile（并行隔离，P1-6 Phase A）

并行单元是 **stack profile**，不是 Playwright worker。profile 表是
`apps/e2e/scripts/stack-profiles.ts` 的单一真源；`E2E_STACK_PROFILE` 只选 profile 名
（不设 = `default`），**不开放端口 / 库名覆盖**（任意覆盖会让安全闸失去意义），未知值
fail-fast（退出码 2）。`default` 的值与改造前逐字相同。

| profile | 库 | 后端 / socket / 静态代理 | IP 段（设备 realIp） | 基线目录 | profile 锁 |
|---|---|---|---|---|---|
| `default`（本地全量） | `walnut_e2e` | 3001 / 3002 / 4173 | `127.0.{1,2}.*` | `.e2e/` | 2026112401（= 全局锁） |
| `smoke` | `walnut_e2e_smoke` | 3101 / 3011 / 4181 | `127.0.{11,12}.*` | `.e2e/smoke/` | 2026112402 |
| `risk` | `walnut_e2e_risk` | 3102 / 3012 / 4182 | `127.0.{21,22}.*` | `.e2e/risk/` | 2026112403 |
| `network` | `walnut_e2e_network` | 3103 / 3013 / 4183 | `127.0.{31,32}.*` | `.e2e/network/` | 2026112404 |
| `pages`（E4 扩面） | `walnut_e2e_pages` | 3104 / 3014 / 4184 | `127.0.{41,42}.*` | `.e2e/pages/` | 2026112405 |
| `journey`（E5 扩面） | `walnut_e2e_journey` | 3105 / 3015 / 4185 | `127.0.{51,52}.*` | `.e2e/journey/` | 2026112406 |

- profile 与 Playwright project 同名 1:1（`default` 没有同名 project，它就是本地全量）；
  命名 profile 只允许跑同名 project —— `run.ts` 会机械拒绝 `E2E_STACK_PROFILE=smoke --project=risk`。
- `pages` / `journey` 是扩面批次（E4 / E5'）的 profile：目录 `tests/pages/`、`tests/journey/` 已落地。
  `pages` 覆盖调研报告 §1.1 的侧边栏业务页全集（按路由分 6 条链；project 依赖 auth-setup，
  复用 worker 级 `authedPage`，不产出 storageState）；`journey` 是锁屏（J1–J4）、socket 强踢、
  WebAuthn、权限可见性、角色切换、回收站、MFA 强制绑定 TOTP（J5–J10）的跨端旅程。
  用例数不写死：**精确数以 `playwright test --list` 为准**，default 面口径是
  `smoke + risk + network + mobile` 四个 project。`pages` 里 `/demo/table/base` 的已知 seed
  漂移用 `test.fixme` 留复现，见该目录 README。
- **本地多 profile 仍串行**（不变量 6）：`run.ts` 先抢全局锁、再抢 profile 锁；第二个 profile
  在第一步等全局锁，120s 抢不到就报持锁者退出。profile 锁不是并发通行证。
- **Redis 不加前缀、也不换逻辑库**（设计结论）：键形由 server 拥有；设备清理按 deviceId 精确删；
  跨 profile 共享的全局键由同一份基线数据派生。**IP 段隔离的真实边界**：它只隔离
  `device/initial` 的 per-realIp 节流桶；风控的 `risk:rate:ip:*` 与 `risk:ip_blacklist` 会被
  `normalizeIp` 把所有 loopback 归一成 `127.0.0.1`（同机共享 Redis 时所有 profile 计入同一组桶），
  **不隔离** —— 所以本地多 profile 仍必须串行；将来要并发，先加**每 profile 一个 Redis 实例**，
  不是键前缀。
- `.env.e2e` 固定路径约束：`apps/server/env-local/.env.e2e` 是 typeorm CLI 的固定通道，同一个
  checkout 上不能并发两个 profile 的 prepare —— 本地靠全局锁串行，CI 每个 job 独立 checkout。
- **`mobile` 不是 stack profile**：它是 Playwright 的 device profile（Pixel 7 视口 / UA），
  共用 default 栈，**不**接受 `E2E_STACK_PROFILE=mobile`、也不在 nightly CI matrix 里；默认全量
  会跑到它（`tests/mobile/`）。业务链路换浏览器不产生新信息，只为响应式几何量留了 1 条用例。

## 退出码（先记住这三档）

| 码 | 含义 | 什么时候出现 |
|----|------|--------------|
| 0 | 成功 | 全部用例通过 |
| 1 | 跑起来了但结果不对 | 用例失败、脚本自身报错、子进程（migration / seed / pg_dump / pg_restore）以其它非零码退出 |
| 2 | **环境没准备好** | 缺 `.env.stage`、缺 workspace CJS dist 或 stage 产物、PG / Redis 连不上、PG 容器不可读、端口被占、没装 chromium、**基线漂移 / 数据路径脏 / 基线文件不可用**；seed 以 2 退出也原样透传 |

看到 2 就不必怀疑用例：按报错里的「处置」把前置补齐再跑。Playwright 自己的退出码原样透传
（它用 1 表示有用例失败）。

**退出码的观测口径**：`pnpm walnut e2e` 与 `pnpm -C apps/e2e run e2e` 会原样传出 2；经
`pnpm --filter @walnut/e2e e2e` 的**递归**形式时，pnpm 会把任何失败统一折成 1 —— 那是 pnpm
外层的行为，不是脚本的行为（要看 2 就用前两种，或直接 `node apps/e2e/scripts/run.ts`）。

## 数据栈的两种形态

两份 compose 的**内容同源**（镜像 `postgres:18-alpine` + `redis:8-alpine`、凭据、健康检查、
卷挂载点逐字一致），差别只有端口发布与命名：

| 形态 | 文件 | 适用 | 端口发布 | compose 项目 |
|------|------|------|----------|--------------|
| WSL 常驻栈 | `apps/e2e/docker-compose.wsl.yml` | Docker 跑在 WSL 里（本机采用） | `127.0.0.1:5433` / `127.0.0.1:6380` | `walnut-e2e-wsl` |
| 通用栈 | `apps/e2e/docker-compose.yml` | Docker 跑在 Windows（Docker Desktop）或原生 Linux | `5433` / `6380` | `walnut-e2e` |

为什么本机放 WSL：Windows 侧直接跑便携二进制会在桌面弹可见终端窗口；WSL 里的进程没有窗口。

### 一条命令（推荐）

`scripts/stack.ts` 按 `E2E_PG_EXEC_MODE` / 平台自动选上面两份 compose（容器名可用
`E2E_PG_CONTAINER` 覆盖），**只管理数据栈**：不抢 run 级锁、不重建库、不启后端 / 静态代理 /
Playwright。

```bash
pnpm walnut e2e:stack:status   # 容器状态 + PG/Redis 可达性 + 当前 profile 的三个端口占用 + 该 profile 的基线状态（只读；-- --strict 供门禁）
pnpm walnut e2e:stack:status -- --strict   # 容器 / PG·Redis 任一 FAIL ⇒ 退出码 1（默认恒 0）
pnpm walnut e2e:stack:up       # docker compose up -d（等 healthy 再用 status 复查）
pnpm walnut e2e:stack:down     # docker compose down（**保留数据卷**，基线仍可用）
pnpm walnut e2e:stack:down --volumes   # 连数据卷一起删：下次 up 是空实例，旧基线随之失效
```

`status` 复用 preflight 的 TCP / 端口探针与 baseline 的判定，不另写一套口径。默认**不是门禁**：
数据栈没起时它只打印 FAIL 行，仍以 0 收场；要交给自动化当判据时加 `-- --strict` —— 容器 /
PG·Redis 任一 FAIL ⇒ 退出码 1（端口占用与基线状态仍是信息项，不参与判定）。下面的原始 compose
命令保留给排障与自定义场景。

### WSL 常驻栈

前提：WSL 发行版里装了 Docker（本机 Ubuntu-24.04，Docker 29 + Compose v5），
且 WSL 用户在 `docker` 组（没有的话 `sudo usermod -aG docker $USER` 后重开 WSL）。
命令从 Windows 侧 `wsl -e bash -c "…"` 发起，不弹窗口：

```bash
# 启动（detached）
wsl -e bash -c "docker compose -f /mnt/d/walnut-admin/walnut-admin/apps/e2e/docker-compose.wsl.yml up -d"
# 查看状态（等两个容器都 healthy）
wsl -e bash -c "docker compose -f /mnt/d/walnut-admin/walnut-admin/apps/e2e/docker-compose.wsl.yml ps"
# 停止（保留数据卷）
wsl -e bash -c "docker compose -f /mnt/d/walnut-admin/walnut-admin/apps/e2e/docker-compose.wsl.yml down"
# 重置：连数据卷一起删（下次启动是全新的空实例）
wsl -e bash -c "docker compose -f /mnt/d/walnut-admin/walnut-admin/apps/e2e/docker-compose.wsl.yml down -v"
```

数据落盘在 WSL 的 Docker 命名卷里：

- `/var/lib/docker/volumes/walnut-e2e-wsl_e2e_postgres_data/`
- `/var/lib/docker/volumes/walnut-e2e-wsl_e2e_redis_data/`

**WSL 的生命周期（最容易踩的一条）**：WSL2 发行版只在一个 `wsl.exe` 会话活着时保持运行 ——
最后一个会话结束后约半分钟，发行版会被关掉。容器带 `restart: unless-stopped`，发行版下次启动
时它们会自动回来；但**跑测试的这段时间**发行版必须是活的，否则 prepare-db / 用例会在中途
碰到连接重置。不必开终端窗口，起一个隐藏的常驻会话即可：

```bash
powershell -NoProfile -Command "Start-Process wsl.exe -ArgumentList @('-d','Ubuntu-24.04','--','sleep','infinity') -WindowStyle Hidden"
```

### 通用栈（Docker 在 Windows / 原生 Linux）

```bash
docker compose -f apps/e2e/docker-compose.yml up -d
docker compose -f apps/e2e/docker-compose.yml ps
docker compose -f apps/e2e/docker-compose.yml down
docker compose -f apps/e2e/docker-compose.yml down -v
```

## 端口与凭据

| 项 | 值 | 说明 |
|----|----|------|
| PostgreSQL | `127.0.0.1:5433`，库 `walnut_e2e`（default profile） | dev 是 5432；库名同时是安全闸的判据（命名 profile 是 `walnut_e2e_<profile>`） |
| PG 管理角色 | `walnut` / `e2e_dev_only` | 迁移、seed、断言；env 键 `DATABASE_PG_USER` / `DATABASE_PG_PASS` / `DATABASE_PG_NAME` |
| PG 运行时角色 | `walnut_app` / `walnut_app_e2e_only` | 后端进程用（RLS）；env 键 `DATABASE_PG_APP_USER` / `DATABASE_PG_APP_PASS` |
| Redis | `127.0.0.1:6380`，密码 `e2e_redis_only` | dev 是 6379；env 键 `APP_REDIS_HOST` / `APP_REDIS_PORT` / `APP_REDIS_PASS` |

端口 / 库名 / 基线目录的唯一真源是 `scripts/stack-profiles.ts`；两份 compose 与它逐字对齐，
改一处必须同时改另外两处。命名 profile 的端口见上面 profile 表。`walnut_app` 的密码不写在 compose
里：迁移建角色时带开发引导密码，prepare-db 在每次重建库之后把它改成上面这个固定值（stage 启动
拒绝开发引导密码）。

## pnpm walnut e2e 的前置条件

1. 数据栈在 `127.0.0.1:5433` / `127.0.0.1:6380` 可达（`docker compose ps` 两个容器都 healthy，
   且跑测试期间 WSL 发行版别被关掉 —— 见「WSL 的生命周期」）。
2. 后端 stage env 已解密：`apps/server/env-local/.env.stage` 存在（`pnpm setup-env`，需要根
   `.env.keys`）。prepare-db 把它整份复制成 seed 的 env（0600、seed 一结束就删）—— OPAQUE 口令
   必须与后端同一把密钥，只给数据库几项不够。
3. **workspace 包的 CJS 产物已构建**：`pnpm build`（`@walnut/utils` 的 `dist/sign-raw.cjs` 与
   `@walnut/contract` 的 `dist/index.cjs`）。`lib/protocol/sign-raw.ts` / `contract.ts` 经
   `require` 消费它们 —— 缺了会在 webServer 启动时炸成 180s 超时；preflight 现在会提前以
   退出码 2 报出并给修复命令。
4. stage 产物已构建：`apps/server/dist-stage`（`pnpm --filter @walnut/server build:stage`）与
   `apps/admin/dist-staging`（`pnpm walnut build:stage`）。
5. Playwright 浏览器已安装：`pnpm --filter @walnut/e2e exec playwright install chromium`。
6. **当前 profile 的三个端口空闲**（default 是 3001 / 3002 / 4173；命名 profile 是 3101–3105 /
   3011–3015 / 4181–4185 —— 后端、socket.io、静态代理）。复用已在监听的进程时见下面
   「复用已在监听的进程」（`E2E_REUSE_SERVER=1`，preflight 会改查「可达 + 身份」）。
7. Node >= 24.15.0、pnpm >= 12（根 `package.json` 的 engines）。

> `apps/server/env-local/.env.e2e`（prepare-db 的迁移通道文件）含数据库口令：写入时是 `0600`，
> 文件头也写了「勿提交」，且迁移一结束就删。**Windows 上 Node 的 `mode` 基本不生效**（NTFS
> 不以 POSIX mode 表示权限），所以那份 0600 只对 POSIX 平台是真保护；Windows 上靠
> 「gitignored + 生命周期极短」兜底。POSIX 上可用 `stat -c %a <file>`（macOS：`stat -f %Lp`）核对。

## 运行

```bash
pnpm walnut e2e         # 全部 5 个 project（default 面 + pages + journey；10 分钟级，启动时会提示）
pnpm walnut e2e:default # 日常验收：smoke + risk + network + mobile 四 project（不让 pages/journey 拖长反馈）
pnpm walnut e2e:smoke   # 冒烟子集（setup + 首页 / 菜单 / 角色 / 设置 / 用户 CRUD）
pnpm walnut e2e:risk    # 设备 ID 全生命周期（不含 @network）
pnpm walnut e2e:network # 只跑依赖真实外网的用例（当前是 U1b：api.ip.sb 的定位）
E2E_STACK_PROFILE=smoke pnpm walnut e2e   # 在 smoke profile（独立库 / 端口 / 基线）上跑同名 project
pnpm walnut e2e:affected # 按 git 改动范围选择子集（默认 base=origin/main，见下；-- --json 输出机器可读计划）
pnpm walnut e2e:report  # 打开上一轮 HTML 报告
pnpm walnut e2e:stack:status # 数据栈状态（容器 / PG·Redis 可达 / 当前 profile 端口 / 该 profile 基线；只读，--strict 供门禁）
pnpm walnut e2e:clean   # 清理 .e2e 调试文件（dry-run 默认，--force 真删；保留各 profile 的基线）
```

包脚本只是把参数交给 `scripts/run.ts`（`e2e:smoke` = `node scripts/run.ts --project=smoke`，
`e2e:default` = `--project=smoke --project=risk --project=network --project=mobile`），
额外参数原样透传给 Playwright，例如 `pnpm --filter @walnut/e2e e2e -g "登录"`。
**裸 `e2e` 是全量 5 个 project**（含 pages / journey），启动时打印耗时提示；日常用 `e2e:default`。
用例数以 `pnpm --filter @walnut/e2e exec playwright test --list` 为准，文档不写死。

依赖外网的用例带 `@network` **tag**（写法见下面「标签与选择性执行」）：`risk` project 用
`grepInvert` 排除它们，`network` project 只收它们。**离线口径（2026-11-25 起成立）**：
`e2e:risk` 不需要外网 —— Phase0-4 用 127/8 的 local IP（后端跳过 geo 查询），CAP 的 widget 与
WASM 都已自托管（同源加载）；`e2e:network`（当前是 U1b：api.ip.sb 真实定位）需要外网，
离线时必红是**预期**。

`run.ts` 的顺序是硬约束：

1. **抢 run 级 advisory lock 并整轮持有** —— 先全局锁（一台机器一个 run），再 profile 锁
   （基 key + profile 序号）。两个 worktree / 两个 profile 同时跑时，第二个在**全局锁**上等待；
   120s 内抢不到就报「谁在持锁」并退出（一轮全量远超这个时长，所以实际表现是第二个直接失败）。
   锁不在 prepare 结束就放：否则后一个 run 的 `DROP DATABASE` 会删掉前一个正在用的库；
2. `scripts/preflight.ts` 查前置（env / **workspace CJS dist** / 两处 stage 产物 / chromium /
   PG·Redis 可达 / **PG 容器可读** / **当前 profile 的三个端口**空闲）——**在动库之前**，失败按
   退出码 2 收场（`E2E_REUSE_SERVER=1` 时端口改成「可达 + 身份」检查，见下）；
3. **基线决策**（`scripts/baseline.ts` 的 `ensureTestDatabase`，整段在同一把锁内）：清单有效、
   `dataKey` 一致且数据路径干净 ⇒ 从基线 `pg_restore` 恢复（不跑迁移 / seed）；没有基线 ⇒ 全量
   prepare 后自动封板；`dataKey` 变了 / 数据路径脏 / 清单对不上 ⇒ **退出码 2** 并提示重新封板；
   `--rebuild-baseline` ⇒ 强制全量 prepare + 重新封板；`E2E_SKIP_BASELINE=1` ⇒ 忽略基线、全量
   prepare（见下面「测试库封板」）；
4. **Redis 设备键对账**（`scripts/redis-gc.ts`，P2-2）：库刚重建完，「不在 `sys_device` 里的
   deviceId」就是确定的孤儿 —— 按 SCAN 到的**精确键名**删掉（绝不 FLUSH）；默认开，
   `E2E_REDIS_GC=0` 关，失败只警告不拦测试（见下面「Redis 设备键对账」）；
5. `stack-info` 写本轮栈信息（含两处产物的**真实 mtime**，用来判断跑的是不是旧产物）；
6. `playwright test`（webServer 由它起；默认**不复用**已在监听的进程 —— 见上面「退出码（先记住这三档）」）。

设备与 Redis 键的清理由 `tests/fixtures.ts` 的 auto fixture 统一做：断言失败时也会执行，
不会因为用例末尾的手写清理被跳过而留下残渣。跨轮残留（崩溃 / 中断的 run 留下的设备键）
由 `scripts/redis-gc.ts` 在每轮库准备之后对账（见下面「Redis 设备键对账」）。

## 调试：`--ui` / `--debug` / 单用例

`run.ts` 只拦截 `--rebuild-baseline`（那是它自己的参数），其余参数**原样透传**给
`playwright test`。所以 Playwright 的调试开关直接用：

```bash
pnpm walnut e2e --ui                       # 交互式 UI：时间线 / 每次动作的 DOM 快照 / 重跑单条
pnpm walnut e2e --debug                    # PWDEBUG：有头浏览器 + Inspector，逐步执行
pnpm walnut e2e:smoke --debug -g "登录"    # 只调一条；-g 是 Playwright 的标题 / tag 匹配
pnpm --filter @walnut/e2e e2e -- --ui      # 等价的包内写法（经 pnpm 递归时退出码会被折成 1）
```

**风险与前提**（三条都不是「别用」，是「知道自己在用」）：

- **它们仍然整轮持有 run 级锁**。UI / Inspector 会一直开着直到你关闭，期间另一台 worktree /
  另一个终端跑全量只会等锁 120s 后失败（不变量 6）。调完先关 UI 再跑别的。
- **`--ui` / `--debug` 是有头模式**：会弹浏览器窗口（这是用户主动要的界面，不是脚本偷起的
  子进程）；`--ui` 还起一个本地 Web 服务（端口随机），不要把它的网络面板外传。
- **单用例 `-g` 不省前置**：setup project 是 `dependencies`，照样先跑 stack-setup / auth-setup；
  基线决策、preflight、锁、webServer 启停一分不少。它省的是业务用例的等待，不是环境成本。
- `-g` 匹配的是「标题路径 + tag」，中文标题在 Git Bash 里加引号；只写 tag 时用 `--grep @smoke`
  （见下面「标签与选择性执行」）。

## `E2E_*` 开关

`scripts/run.ts` 与 `playwright.config.ts` 实际消费的就是下面这些（数据栈相关的
`E2E_PG_CONTAINER` / `E2E_PG_EXEC_MODE` 见「测试库封板」的容器一段）：

| 开关 | 用途 | 风险 / 什么时候别用 |
|------|------|---------------------|
| `E2E_STACK_PROFILE=<p>` | 选择 stack profile：`default`（不设）/ `smoke` / `risk` / `network` / `pages` / `journey`；决定库名、三个端口、基线目录、IP 段 | **只接受 profile 名**，不开放端口 / 库名覆盖；命名 profile 只能跑同名 project（`run.ts` 拒绝别的）。本地多 profile 仍串行（全局锁） |
| `E2E_REUSE_SERVER=1` | 复用当前 profile 的后端 / socket / 静态代理端口上已在监听的服务；preflight 改成「可达 + 身份」检查（后端 `/health/ready`、静态代理的 index.html） | 后端缓存着**上一个库**的应用设置 memo、静态服务可能伺服旧产物 —— 只有确认「跑的就是本轮产物」时才用；仅本地调试。它不会替你启动服务（见「复用已在监听的进程」） |
| `E2E_SKIP_BASELINE=1` | 忽略基线、全量 prepare（不封板） | 逃生口：失去了「迁移 / seed 变了」的漂移判定，每轮退回全量重建；只用于排查基线本身的问题，不是日常入口 |
| `E2E_REBUILD_BASELINE=1` | 等价于 `--rebuild-baseline`：强制全量 prepare + 重新封板 | 会用当前数据替换旧快照；确认迁移 / seed 已提交、数据路径干净再跑。与 `E2E_SKIP_BASELINE=1` 互斥（同时给按退出码 2 拒绝） |
| `E2E_REDIS_GC=0` | 关掉 run 流程里的 Redis 设备键对账（默认开） | 关掉后崩溃 run 的设备键会跨轮存活（RSA 公钥 30 天、challenge 24h）；只在排查 GC 本身时短暂使用 |
| `E2E_INCLUDE_QUARANTINE=1` | 忽略 `quarantine.json`：名单里的隔离用例也纳入执行（`playwright.config.ts` 的 `grepInvert` 不再挂名单） | 隔离用例本来就可能是红的；只在人工复查 / 验证名单条目时用，不要放进 nightly 主路径（理由见「标签与选择性执行」） |

## 标签与选择性执行

标签**统一用 Playwright 原生 tag**（`test(...)` / `test.describe(...)` 的第二个参数
`{ tag: '@smoke' }`），不往标题文字里写。理由：tag 是框架的一等公民（junit / JSON report 里
是独立的 `tags` 字段），`--grep` 也按 tag 匹配（Playwright 把 tag 并入 grep 的标题路径）；
标题只留人读的用例名，改文案不会顺手弄坏选择规则。

| tag | 含义 | 当前落点 |
|-----|------|----------|
| `@smoke` | 冒烟 | 首页只读、缓存清空、用户 CRUD、菜单 / 角色 / 设置模块 spec |
| `@risk` | 设备 / 风控 / auth 面 | 设备 ID 生命周期整组、risk 矩阵 U11–U16、auth 面矩阵（MFA / 会话 / 登出） |
| `@pages` | 页面扩面（pages profile） | 侧边栏业务页全集的页面可达链（`tests/pages/`，按路由分 6 条链） |
| `@journey` | 跨端旅程（journey profile） | 锁屏 J1–J4、socket 强踢 J5、WebAuthn J6、权限 J7、角色 J8、回收站 J9、MFA 强制绑定 TOTP J10（`tests/journey/`） |
| `@mobile` | mobile 设备 profile | Pixel 7 登录页布局（`tests/mobile/`，默认全量跑） |
| `@slow` | 慢用例（同时有 `test.slow()`） | 两条「回填 created_at」+ 敏感验证 S1/S2（共机噪声余量） |
| `@network` | 依赖真实外网 | U1b（api.ip.sb 定位） |
| `@quarantine` | 隔离（默认不执行，见下） | `quarantine.json` 里登记的用例 |

`@quarantine` 是**两层机制**：用例挂 `{ tag: '@quarantine' }` 便于人工 `--grep @quarantine`
单独选中；同时必须登记到 `apps/e2e/quarantine.json`（`testName` / `issue` / `owner` /
`addedAt` / `reviewAt`）。`playwright.config.ts` 加载时把名单条目的标题编译成 `grepInvert`，
默认从所有业务 project 中排除它们；`E2E_INCLUDE_QUARANTINE=1` 显式包含。空名单（`[]`）
不挂任何排除，零影响；`reviewAt` 到期会在 config 加载时告警。

为什么不写成 `run.ts` 的 `--grep-invert`：CLI 参数会覆盖 config 里 risk project 的
`/@network/` 排除（CLI 优先），等于把外网用例带进离线 run；config 级 `grepInvert` 可以是
数组，两条排除并存。本仓只有 nightly、没有 PR 门禁，所以「nightly 跑但不作为门禁」没有
第二道可挂 —— 取舍是**默认（含 nightly）不跑名单条目**，`E2E_INCLUDE_QUARANTINE=1` 是
人工复查入口；`owner` + `reviewAt` 是防止条目被遗忘的唯一机制。`@network` 由 network
project 的 `grep` 选中、risk 的 `grepInvert` 排除。

```bash
pnpm --filter @walnut/e2e e2e -- --grep @smoke          # 只跑冒烟 tag
pnpm --filter @walnut/e2e e2e -- --project=risk --grep @slow
E2E_INCLUDE_QUARANTINE=1 pnpm --filter @walnut/e2e e2e -- --grep @quarantine  # 人工复查隔离用例
```

setup project 是 `dependencies`：即使 `--grep` 不匹配它们，Playwright 也会先跑
stack-setup / auth-setup —— 不需要给 setup 用例贴业务 tag。

## 按改动范围选择（e2e:affected）

```bash
pnpm walnut e2e:affected                 # base 默认 origin/main
pnpm walnut e2e:affected origin/main     # 位置参数
pnpm walnut e2e:affected --base=<ref>    # 分支 / tag / 提交 sha
```

它读 `git diff --name-only <base>...HEAD`（三点 diff = 与 merge-base 比）的**已提交**改动，
打印计划后按判定执行。执行仍交给 `scripts/run.ts`，所以抢 run 级锁、preflight、基线决策与
`playwright test` 的硬顺序不变。**它不是 PR 门禁**（不进 prepush / ci:local）。

| 改动 | 判定 |
|------|------|
| `apps/admin/src/views/auth/**`、`apps/admin/src/api/auth*`、`apps/admin/src/store/modules/**` 下带 `auth` 的模块 | `--project=smoke` + `--project=journey`（auth 面同时是登录冒烟与登录旅程的触发源） |
| `apps/server/libs/{guards,system,ip}/**`、`apps/server/apps/api/src/middleware/**` | `--project=risk` |
| `apps/admin/src/views/**`、`apps/admin/src/router/**` | `--project=pages`（页面扩面；auth 视图同时命中 smoke / journey） |
| `apps/admin/src/socket/**`、`App/AppLock` 组件、锁屏 store（`app-lock.ts`）、`api/system/user_lock.ts` | `--project=journey` |
| `apps/server/db/seed/**`、`apps/server/apps/api/migrations/**`、`apps/e2e/scripts/prepare-db.ts`、seed 工具（`tooling/scripts/src/db/{seed*,admin-credential,app-keys}.ts`） | `--rebuild-baseline` + 全量 |
| `apps/e2e/**` | 全量 |
| 只改 `apps/docs/**` 或任意 `*.md`（且不在 `apps/e2e/**`） | 跳过（退出 0，打印理由） |
| **其它任何路径**（根 `package.json`、server 的 auth / identity / socket 等） | **全量（安全网）** |

一条改动可以命中多个 project（如 `views/auth/**` → smoke + pages + journey）；映射是加法。
server 侧 auth / identity / socket 在 E5 落地前**不**单独映射（走全量安全网）—— 过早收窄会丢掉
risk 的 auth-matrix 覆盖。

base 不存在 / 读不到 diff 时按前置条件失败（退出码 2），提示 `git fetch origin main` 或改用
`--base <ref>`。映射规则在 `scripts/affected-plan.ts`（纯函数，单测 `affected-plan.test.ts`）；
git 读取与执行在 `scripts/affected.ts`。

## 测试库封板（baseline）

每轮都 drop → 迁移 → seed 意味着「测试数据 = 仓库当前真源」：每次准备都要把迁移与 seed 的每一步
重新跑对，而且「这一轮用的测试数据是什么版本」没有记录。现在的默认是 **seal 一次、restore 每轮**，
实现全在 `apps/e2e/scripts/baseline.ts`：

- **seal（封板）**：全量准备（迁移 + seed + 把 admin 提升为 root + 放宽 CAP 节流与难度）跑完后，
  用数据栈容器里的 `pg_dump -Fc` 把**当前 profile 的库**导出成基线文件，随后写封板清单与口令文件。
  三个文件**先各写临时文件，再原子 rename**（提交时先撤旧清单）—— 中途失败 / 被 kill 不会留下
  「新 dump + 旧清单」；留下的「没有清单」状态会被下一轮识别成半成品并拒绝使用；
- **restore（恢复）**：每轮默认动作 —— 先逐个校验清单里记录的 dump / credentials 的 sha256 与
  字节数，`DROP/CREATE DATABASE` 后 `pg_restore` 回来，然后只重做**不在快照里**的运行时状态：
  `walnut_app` 口令（角色是集群级的，pg_dump 不导角色）、Redis 的应用设置缓存、
  `.auth/credentials.json`（口令取封板时那一份 —— 快照里的 OPAQUE 口令身份只认它）。
  之后做 sanity 断言：库名、admin 账号存在、`sys_menu` 行数 ≥ 清单记录、迁移头与清单一致；
- **漂移判据（P1-1）**：清单记 **`dataKey`** = `apps/server/db/seed`、迁移目录、`prepare-db.ts`
  与 seed 工具（完整清单见 `apps/e2e/scripts/e2e-data-paths.ts` 的 `E2E_DATA_PATHS`）在 HEAD 上的组合树哈希。
  `dataKey` 与当前不一致、或这些路径有**未提交改动**（`git status --porcelain`）⇒ 退出码 2 并
  提示 `--rebuild-baseline`；只改文档 / 前端 / 后端源码**不**触发。`gitCommit` 只用于展示
  「封板于哪个提交」。

产物都在 gitignored 的 `apps/e2e/.e2e/`（命名 profile 在 `.e2e/<profile>/`），**不入库**：

| 文件 | 内容 |
|------|------|
| `apps/e2e/.e2e/[<p>/]baseline.dump` | `pg_dump -Fc` 的自定义格式快照（当前 profile 的库） |
| `apps/e2e/.e2e/[<p>/]baseline.manifest.json` | 封板清单 / meta（版本 3，字段见下；profile / database / dataKey / 两个 sha 都在这里） |
| `apps/e2e/.e2e/[<p>/]baseline.credentials.json` | 封板时的 admin 口令（0600） |

封板清单（`manifestVersion: 3`）的字段：

| 字段 | 含义 |
|------|------|
| `manifestVersion` | 清单格式版本；形态变化时 +1。**旧版本不做迁移**（v1 缺 dataKey / credentials 的 sha；v2 缺 profile / database）：读到旧清单直接判不可用并提示重封板 |
| `sealedAt` | 封板时刻（ISO 8601） |
| `gitCommit` | 封板时的仓库 HEAD（40 位）——**只展示**，漂移判据已换成 `dataKey` |
| `profile` / `database` | 封板时的 profile 与库名；restore 前断言与当前 profile 一致（跨 profile 的 dump 恢复不了） |
| `dataKey` | 数据路径的组合树哈希；restore 前与当前快照比对，不一致即拒绝 |
| `dataDirty` | 封板时数据路径是否有未提交改动；`true` 的清单**永不可用**（数据无法证明与仓库一致） |
| `migrationsHead` | 库内 `migrations` 表的最大 id 与迁移名（快照的迁移头） |
| `dumpSha256` / `dumpBytes` | dump 的 sha256 与字节数（防替换 / 半写） |
| `credentialsSha256` / `credentialsBytes` | 封板口令文件的 sha256 与字节数（防「新 dump 配旧口令」） |
| `menuRows` | 封板时 `sys_menu` 的行数；restore 后断言 ≥ 它 |

**容器与平台（P1-1）**：dump / restore 要 `docker exec` 进数据栈容器。容器名默认
`e2e-wsl-postgres`，用 `E2E_PG_CONTAINER` 覆盖（通用 compose 的容器名是 `e2e-postgres`）。
win32 默认经 `wsl -e bash -c "docker exec …"`，其它平台直接 `docker exec`；
Windows + Docker Desktop（docker CLI 在 Windows 侧）用 `E2E_PG_EXEC_MODE=docker` 显式改走原生
docker。preflight 会用 `docker inspect` 提前确认容器可读。

### 什么时候必须重新封板

- 改了迁移或 seed（**已提交**）：`dataKey` 与清单不一致 ⇒ 退出码 2，提示重新封板 —— 不会静默
  重建，「数据版本变了」必须是显式动作；
- 改了迁移或 seed 但**没提交**：`git status` 显示数据路径脏 ⇒ 同样退出码 2（用旧数据跑新 schema
  比多跑一次 prepare 更危险）；
- 封板时数据路径就是脏的：清单记 `dataDirty=true`，该基线之后永远判不可用（提交 / 还原后重封板）；
- 清单是**旧格式（版本 1 / 2）**或封板中途中断（有 dump / credentials 但没有清单）：判「不可用」，
  不做迁移、不静默自举 —— 按提示重新封板；
- 清单里的 `profile` / `database` 与当前 profile 不一致（例如把 smoke 的基线拷进 risk 目录）：
  restore 拒绝；
- 换机器 / 清过 `apps/e2e/.e2e/`：没有基线，首次运行会**自动**全量 prepare 并封板；
- 换过数据卷 / 重建过容器：旧基线引用的角色与对象可能已不在，按报错提示重新封板。

```bash
pnpm --filter @walnut/e2e e2e -- --rebuild-baseline   # 全量 prepare + 重新封板 + 跑用例
E2E_REBUILD_BASELINE=1 pnpm walnut e2e                # 同上（等价的环境变量）
E2E_SKIP_BASELINE=1 pnpm walnut e2e                   # 逃生口：忽略基线、全量 prepare（不封板）
```

`--rebuild-baseline` 由 `scripts/run.ts` 自己消费，不会透传给 Playwright。

本机实测（同一台机器、同一份数据栈；单次读数，不是保证值）：seal 的 `pg_dump` 约 2.4 s；
整轮 restore 约 1.5–3.5 s；从零全量 prepare（迁移 + seed + 提升 root + 放宽 CAP）约 2–7 s。
**本机 prepare 本身已经很快**（本地 PG + 小数据量），所以封板的主要价值是「测试数据版本显式
可控 + 迁移 / seed 变化可被判漂移」，而不是把分钟级压成秒级 —— 冷启动或大数据量下差距才会明显。

## 运行时目录与清理（`.e2e`）

`apps/e2e/.e2e/` 里同时住着**活文件**和**排障残渣**：

- **活的（别删）**：`baseline.dump` / `baseline.manifest.json` / `baseline.credentials.json`
  （封板三件套）与 `stack.json`（上一轮栈信息）；命名 profile 的活文件在
  `.e2e/<profile>/` 里，清理脚本会**递归保留**它们；
- 其余（`*.log`、临时 `*.json` / `*.ts` / `*.mjs`、截图、trace 目录……）都可以清。

```bash
pnpm walnut e2e:clean            # dry-run：列出将删条目与总大小（默认，不删）
pnpm walnut e2e:clean --force    # 真删；只允许删 .e2e（或其 profile 子目录）的直接子项，保留名单在 scripts/clean.ts
```

清理脚本**不碰** `.auth/`（登录凭据与 auth.setup 的 gate-report）、`test-results/` 与
`playwright-report/`（Playwright 自己的产物）。跑用例期间别清 —— 正在写的日志会被删掉。

## Redis 设备键对账（redis-gc）

设备作用域键（设备缓存、滑动续期时间闸、登录会话 / 权限 / MFA / 签名 / CAP、风控缓存与
challenge 标记、murlock 锁）都有 TTL，但不短（RSA 公钥 30 天、challenge 24 小时）——
崩溃 / 中断的 run 会把它们留到下一轮。`scripts/redis-gc.ts` 在**锁内、库准备之后**做一次对账：

1. 只 SCAN 白名单前缀（`WALNUT_CACHE_SYSTEM:DEVICE:*`、`WALNUT_CACHE_AUTH:*`、
   `WALNUT_CACHE_SECURITY:*`、`risk:device:*`、`risk:rate:device:*`、`risk:challenge:*`、
   `APP:MURLOCK:*` …，完整表见 `scripts/redis-gc.ts` 的 `DEVICE_KEY_SCAN_PATTERNS`）；
2. 从键形的**已知槽位**取 deviceId，并要求形态是 `d1_` + 32 位小写 hex（服务端判据同形）；
3. 查 `sys_device`：设备**不存在**才是孤儿；存在则一个键都不动；
4. 对孤儿执行 `DEL <精确键名>`（分批）。**绝不 FLUSHDB / FLUSHALL** —— compose 里那两个命令
   已被重命名为空串禁用，本脚本也不会调用。

```bash
pnpm walnut e2e:redis-gc            # 独立入口（跑一轮真实对账）
node apps/e2e/scripts/redis-gc.ts --dry-run   # 只列计划，不删
E2E_REDIS_GC=0 pnpm walnut e2e      # 关掉 run 流程里的自动对账
```

默认**开**：run 的第三步刚重建过库，「不在 `sys_device` 里的 deviceId」就是确定的孤儿，留着只会
跨轮堆积。失败只打印 WARN、不拦测试（cleanup 不该把一轮用例判红）；排障时可以用
`--dry-run` 先看删除面。负对照（验收证据）：人为造 3 个孤儿键 + 1 个有效设备键，GC 后孤儿全删、
有效键保留（见优化文档 P2-2 的落地记录）。

## 复用已在监听的进程（`E2E_REUSE_SERVER=1`）

默认**不复用**：后端端口上残留的进程里缓存了一份应用设置 memo，而库每轮都会重建（全量 prepare
或从基线 restore，含放宽后的 CAP 节流 / 难度读），复用它就会读到上一个库的状态；静态代理端口上残留的
服务也可能伺服旧产物。只有明确知道「这些端口上跑的就是本轮产物」时才用 `E2E_REUSE_SERVER=1`
打开复用。

打开后 **preflight 也换口径**（P1-2）：不再要求三个端口空闲，而是检查「可达 + 身份」——
后端 `/health/ready` 返回 200、静态代理返回含 `<div id="app">` 的 index.html、socket 端口可达
（default 是 3001 / 4173 / 3002；命名 profile 换成 3101–3105 / 4181–4185 / 3011–3015）——
并打印复用警告（本轮可能连到旧产物 / 旧库，仅本地调试用）。它**不会**替你启动服务：

```bash
# 在 apps/e2e 下分别起两个进程（或用你自己的方式起同一份产物；profile 由 E2E_STACK_PROFILE 决定）
node scripts/start-backend.ts     # 后端 dist-stage（含日志 tee / 脱敏）
node scripts/static-server.ts     # 静态代理（dist-staging + /api /socket 反代）
E2E_REUSE_SERVER=1 pnpm walnut e2e:smoke
```

## CI 形态（nightly）

`.github/workflows/e2e.yml`：每天 UTC 19:00（北京 03:00）+ 手动 dispatch，**不进 PR**。
**prepare job 构建一次 + matrix 五 job 并行**（`smoke` / `risk` / `network` / `pages` / `journey`，
`fail-fast: false`）：每个 job 独立 checkout + 独立 services（PG 18 / Redis 8，端口与凭据同
`scripts/stack-profiles.ts`），`E2E_STACK_PROFILE` 决定库 / 端口 / 基线目录，`--project=<profile>`
与 profile 同名 1:1。一个 job 红不影响其余 job。**`journey` 与 `pages` 的 spec 都已落地**
（锁屏 / socket / WebAuthn / 权限 / 角色 / 回收站 / MFA TOTP 旅程、全站页面可达链），空 project
不再存在。前三个 job 覆盖改造前的 default 面，pages / journey 是扩面批次；机器时间约
1× 构建 + 5× 测试，墙钟取 prepare + 最慢 profile + 固定开销。

CI 走**基线路径**：每个 profile 的封板三件套由 `actions/cache` 跨 run 缓存，key =
`e2e-baseline-<profile>-v<清单格式版本>-<dataKey>`（`node apps/e2e/scripts/data-key.ts --cache-key`
的输出）—— profile 维度防止基线串用，数据路径变了 key 必变。缓存命中 ⇒ restore；未命中（含首跑）
⇒ 全量 prepare + seal，job 成功后缓存自动保存。**`.env.e2e` 固定路径在 CI 无影响**（每个 job 独立
checkout）；同一 job 内不会并发两个 profile 的 prepare。

**诊断 artifact 只保留五样**：junit / `results.json` / 脱敏后的 `backend.log` / `stack.json` /
基线清单，名字带 profile（`e2e-diagnostics-<profile>`）—— trace、截图、HTML 报告不上传
（不变量 8）。上传步骤带 `steps.redact.outcome == 'success'` 闸门：脱敏失败宁可不传（宁可少
artifact，不可泄露）。另有一个**非诊断** artifact：prepare 的 `e2e-stage-bundle`（前端
`dist-staging` + 后端 `dist-stage` + 两个 workspace CJS dist），只做跨 job 构建产物中转、
保留 1 天、不含 `env-local` 与密钥。细节看 workflow 文件头与优化文档 P1-6 的落地记录。

## 排障

- 本轮连的是哪个库 / 哪份产物（含产物 mtime）：`apps/e2e/.e2e/stack.json`。
- **退出码 2 提示「数据路径相对封板时已变化」**：`dataKey` 或工作区脏状态与封板时不符 ——
  改了迁移 / seed 就 `pnpm --filter @walnut/e2e e2e -- --rebuild-baseline` 重新封板；
  只是有未提交改动的话，先提交 / 还原（`git status --porcelain -- apps/server/db/seed …`）。
  `E2E_SKIP_BASELINE=1` 只用于排查基线本身的问题，不是日常入口。
- **退出码 2 提示「旧格式」/「封板清单缺失但残留 …」**：旧版清单（v1）不做迁移；后者是上一次
  封板中断的半成品 —— 都按提示 `--rebuild-baseline`。
- **`docker inspect` 失败 / 容器不可读**：确认容器名（默认 `e2e-wsl-postgres`，通用 compose 是
  `e2e-postgres`，用 `E2E_PG_CONTAINER` 覆盖）与 Docker 所在侧（win32 默认走 WSL；
  Windows + Docker Desktop 用 `E2E_PG_EXEC_MODE=docker`）。
- 单独查前置：`pnpm walnut e2e:doctor`（= `node apps/e2e/scripts/preflight.ts --doctor`，
  只自检、不抢锁、不动库、不起服务）。
- 安全闸报错（库名或端口不对）：说明环境串到了 dev 口径。**别绕开它**，回
  `apps/e2e/scripts/env.ts` 核对常量。
- 5433 连不上：先 `docker compose ps`，再 `wsl -l -v` 看发行版 STATE 是不是 Running。
- 页面停在一行 `forbidden` 或登录框等不出来：多半是静态代理端口被**别的**静态服务占着（default
  4173；命名 profile 4181–4185）。默认配置下 Playwright 会因端口被占直接失败（static-server 以 2
  退出）；跑之前确认该端口上没有遗留进程（`netstat -ano | findstr :4173`）。
- trace / 截图里的请求头与响应体**含 token 与 cookie**：`test-results/` 与 `playwright-report/`
  只留在本机，**不许上传到任何公开位置**。
