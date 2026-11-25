# 全链路 E2E（apps/e2e）

真实浏览器 × 真实后端进程（stage 产物）× **独立** PostgreSQL / Redis 栈的跨端测试。
这一层不测单元逻辑（那是各包 vitest 的事），只测跨端链路：设备身份签发与续期、CAP 挑战、
签名握手、风控拦截，以及登录 / 首页 / 用户 CRUD。

数据栈与 dev **物理隔离**：独立端口（5433 / 6380，dev 是 5432 / 6379）+ 独立库
（`walnut_e2e`）。`scripts/env.ts` 的安全闸在任何破坏性操作之前核对库名与端口 ——
配错或 env 读串都在 `DROP DATABASE` 之前当场抛错，而不是在之后。

## 数据栈的两种形态

两份 compose 的**内容同源**（镜像 `postgres:18-alpine` + `redis:8-alpine`、凭据、健康检查、
卷挂载点逐字一致），差别只有端口发布与命名：

| 形态 | 文件 | 适用 | 端口发布 | compose 项目 |
|------|------|------|----------|--------------|
| WSL 常驻栈 | `apps/e2e/docker-compose.wsl.yml` | Docker 跑在 WSL 里（本机采用） | `127.0.0.1:5433` / `127.0.0.1:6380` | `walnut-e2e-wsl` |
| 通用栈 | `apps/e2e/docker-compose.yml` | Docker 跑在 Windows（Docker Desktop）或原生 Linux | `5433` / `6380` | `walnut-e2e` |

为什么本机放 WSL：Windows 侧直接跑便携二进制会在桌面弹可见终端窗口；WSL 里的进程没有窗口。

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
| PostgreSQL | `127.0.0.1:5433`，库 `walnut_e2e` | dev 是 5432；库名同时是安全闸的判据 |
| PG 管理角色 | `walnut` / `e2e_dev_only` | 迁移、seed、断言；env 键 `DATABASE_PG_USER` / `DATABASE_PG_PASS` / `DATABASE_PG_NAME` |
| PG 运行时角色 | `walnut_app` / `walnut_app_e2e_only` | 后端进程用（RLS）；env 键 `DATABASE_PG_APP_USER` / `DATABASE_PG_APP_PASS` |
| Redis | `127.0.0.1:6380`，密码 `e2e_redis_only` | dev 是 6379；env 键 `APP_REDIS_HOST` / `APP_REDIS_PORT` / `APP_REDIS_PASS` |

凭据是本机测试栈的**固定明文**，真源是 `apps/e2e/scripts/env.ts`；两份 compose 与它逐字对齐，
改一处必须同时改另外两处。`walnut_app` 的密码不写在 compose 里：迁移建角色时带开发引导密码，
prepare-db 在每次重建库之后把它改成上面这个固定值（stage 启动拒绝开发引导密码）。

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
6. Windows 侧 3001 / 3002 / 4173 空闲（后端、socket.io、静态代理）。复用已在监听的进程时见
   下面「复用已在监听的进程」（`E2E_REUSE_SERVER=1`，preflight 会改查「可达 + 身份」）。
7. Node >= 24.15.0、pnpm >= 12（根 `package.json` 的 engines）。

> `apps/server/env-local/.env.e2e`（prepare-db 的迁移通道文件）含数据库口令：写入时是 `0600`，
> 文件头也写了「勿提交」，且迁移一结束就删。**Windows 上 Node 的 `mode` 基本不生效**（NTFS
> 不以 POSIX mode 表示权限），所以那份 0600 只对 POSIX 平台是真保护；Windows 上靠
> 「gitignored + 生命周期极短」兜底。POSIX 上可用 `stat -c %a <file>`（macOS：`stat -f %Lp`）核对。

## 运行

```bash
pnpm walnut e2e         # 全量：preflight → 基线决策（restore / prepare+seal）→ stack-info → 全部 spec（含 @network）
pnpm walnut e2e:smoke   # 冒烟子集（setup + 首页 / 登录 / 用户 CRUD）
pnpm walnut e2e:risk    # 设备 ID 全生命周期（不含 @network）
pnpm walnut e2e:network # 只跑依赖真实外网的用例（当前是 U1b：api.ip.sb 的定位）
pnpm walnut e2e:affected # 按 git 改动范围选择子集（默认 base=origin/main，见下）
pnpm walnut e2e:report  # 打开上一轮 HTML 报告
```

包脚本只是把参数交给 `scripts/run.ts`（`e2e:smoke` = `node scripts/run.ts --project=smoke`），
额外参数原样透传给 Playwright，例如 `pnpm --filter @walnut/e2e e2e -g "登录"`。

依赖外网的用例带 `@network` **tag**（写法见下面「标签与选择性执行」）：`risk` project 用
`grepInvert` 排除它们，`network` project 只收它们。**离线口径（2026-11-25 起成立）**：
`e2e:risk` 不需要外网 —— Phase0-4 用 127/8 的 local IP（后端跳过 geo 查询），CAP 的 widget 与
WASM 都已自托管（同源加载）；`e2e:network`（当前是 U1b：api.ip.sb 真实定位）需要外网，
离线时必红是**预期**。

`run.ts` 的顺序是硬约束：

1. **抢 run 级 advisory lock 并整轮持有** —— 两个 worktree 同时跑全量时，第二个在等锁；
   120s 内抢不到就报「谁在持锁」并退出（一轮全量远超这个时长，所以实际表现是第二个直接失败）。
   锁不在 prepare 结束就放：否则后一个 run 的 `DROP DATABASE` 会删掉前一个正在用的库；
2. `scripts/preflight.ts` 查前置（env / **workspace CJS dist** / 两处 stage 产物 / chromium /
   PG·Redis 可达 / **PG 容器可读** / 3001·3002·4173 空闲）——**在动库之前**，失败按退出码 2 收场
   （`E2E_REUSE_SERVER=1` 时端口改成「可达 + 身份」检查，见下）；
3. **基线决策**（`scripts/baseline.ts` 的 `ensureTestDatabase`，整段在同一把锁内）：清单有效、
   `dataKey` 一致且数据路径干净 ⇒ 从基线 `pg_restore` 恢复（不跑迁移 / seed）；没有基线 ⇒ 全量
   prepare 后自动封板；`dataKey` 变了 / 数据路径脏 / 清单对不上 ⇒ **退出码 2** 并提示重新封板；
   `--rebuild-baseline` ⇒ 强制全量 prepare + 重新封板；`E2E_SKIP_BASELINE=1` ⇒ 忽略基线、全量
   prepare（见下面「测试库封板」）；
4. `stack-info` 写本轮栈信息（含两处产物的**真实 mtime**，用来判断跑的是不是旧产物）；
5. `playwright test`（webServer 由它起；默认**不复用**已在监听的进程 —— 见下面「退出码」）。

设备与 Redis 键的清理由 `tests/fixtures.ts` 的 auto fixture 统一做：断言失败时也会执行，
不会因为用例末尾的手写清理被跳过而留下残渣。

## 标签与选择性执行

标签**统一用 Playwright 原生 tag**（`test(...)` / `test.describe(...)` 的第二个参数
`{ tag: '@smoke' }`），不往标题文字里写。理由：tag 是框架的一等公民（junit / JSON report 里
是独立的 `tags` 字段），`--grep` 也按 tag 匹配（Playwright 把 tag 并入 grep 的标题路径）；
标题只留人读的用例名，改文案不会顺手弄坏选择规则。

| tag | 含义 | 当前落点 |
|-----|------|----------|
| `@smoke` | 冒烟 | 首页只读、用户 CRUD |
| `@risk` | 设备 / 风控 | 设备 ID 生命周期整组（`test.describe` 上） |
| `@slow` | 慢用例（同时有 `test.slow()`） | 两条「回填 created_at」 |
| `@network` | 依赖真实外网 | U1b（api.ip.sb 定位） |
| `@quarantine` | 隔离（本批只建机制） | 暂无 |

`@quarantine` **只建立标签机制**：给用例挂上 `{ tag: '@quarantine' }` 后即可用
`--grep @quarantine` 单独选中；本批不建 quarantine.json 列表（P2-1），也不自动从全量里剔除 ——
标记它的人要自己决定是否同时调整 project 的 `testMatch` / `grep`。`@network` 由 network
project 的 `grep` 选中、risk 的 `grepInvert` 排除。

```bash
pnpm --filter @walnut/e2e e2e -- --grep @smoke          # 只跑冒烟 tag
pnpm --filter @walnut/e2e e2e -- --project=risk --grep @slow
pnpm --filter @walnut/e2e e2e -- --grep @quarantine     # 机制验证：有隔离用例时只选它们
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
| `apps/admin/src/views/auth/**`、`apps/admin/src/api/auth*`、`apps/admin/src/store/modules/**` 下带 `auth` 的模块 | `--project=smoke` |
| `apps/server/libs/{guards,system,ip}/**`、`apps/server/apps/api/src/middleware/**` | `--project=risk` |
| `apps/server/db/seed/**`、`apps/server/apps/api/migrations/**`、`apps/e2e/scripts/prepare-db.ts`、seed 工具（`tooling/scripts/src/db/{seed*,admin-credential,app-keys}.ts`） | `--rebuild-baseline` + 全量 |
| `apps/e2e/**` | 全量 |
| 只改 `apps/docs/**` 或任意 `*.md`（且不在 `apps/e2e/**`） | 跳过（退出 0，打印理由） |
| **其它任何路径**（根 `package.json`、server 其它模块……） | **全量（安全网）** |

base 不存在 / 读不到 diff 时按前置条件失败（退出码 2），提示 `git fetch origin main` 或改用
`--base <ref>`。映射规则在 `scripts/affected-plan.ts`（纯函数，单测 `affected-plan.test.ts`）；
git 读取与执行在 `scripts/affected.ts`。

## 测试库封板（baseline）

每轮都 drop → 迁移 → seed 意味着「测试数据 = 仓库当前真源」：每次准备都要把迁移与 seed 的每一步
重新跑对，而且「这一轮用的测试数据是什么版本」没有记录。现在的默认是 **seal 一次、restore 每轮**，
实现全在 `apps/e2e/scripts/baseline.ts`：

- **seal（封板）**：全量准备（迁移 + seed + 把 admin 提升为 root + 放宽 CAP 节流）跑完后，
  用数据栈容器里的 `pg_dump -Fc` 把 `walnut_e2e` 导出成基线文件，随后写封板清单与口令文件。
  三个文件**先各写临时文件，再原子 rename**（提交时先撤旧清单）—— 中途失败 / 被 kill 不会留下
  「新 dump + 旧清单」；留下的「没有清单」状态会被下一轮识别成半成品并拒绝使用；
- **restore（恢复）**：每轮默认动作 —— 先逐个校验清单里记录的 dump / credentials 的 sha256 与
  字节数，`DROP/CREATE DATABASE` 后 `pg_restore` 回来，然后只重做**不在快照里**的运行时状态：
  `walnut_app` 口令（角色是集群级的，pg_dump 不导角色）、Redis 的应用设置缓存、
  `.auth/credentials.json`（口令取封板时那一份 —— 快照里的 OPAQUE 口令身份只认它）。
  之后做 sanity 断言：库名、admin 账号存在、`sys_menu` 行数 ≥ 清单记录、迁移头与清单一致；
- **漂移判据（P1-1）**：清单记 **`dataKey`** = `apps/server/db/seed`、迁移目录、`prepare-db.ts`
  与 seed 工具（完整清单见 `apps/e2e/scripts/data-key.ts` 的 `DATA_PATHS`）在 HEAD 上的组合树哈希。
  `dataKey` 与当前不一致、或这些路径有**未提交改动**（`git status --porcelain`）⇒ 退出码 2 并
  提示 `--rebuild-baseline`；只改文档 / 前端 / 后端源码**不**触发。`gitCommit` 只用于展示
  「封板于哪个提交」。

产物都在 gitignored 的 `apps/e2e/.e2e/`，**不入库**：

| 文件 | 内容 |
|------|------|
| `apps/e2e/.e2e/baseline.dump` | `pg_dump -Fc` 的自定义格式快照 |
| `apps/e2e/.e2e/baseline.manifest.json` | 封板清单 / meta（版本 2，字段见下；dump 与 credentials 的 sha 都在这里） |
| `apps/e2e/.e2e/baseline.credentials.json` | 封板时的 admin 口令（0600） |

封板清单（`manifestVersion: 2`）的字段：

| 字段 | 含义 |
|------|------|
| `manifestVersion` | 清单格式版本；形态变化时 +1。**版本 1 不做迁移**：读到旧清单直接判不可用并提示重封板 |
| `sealedAt` | 封板时刻（ISO 8601） |
| `gitCommit` | 封板时的仓库 HEAD（40 位）——**只展示**，漂移判据已换成 `dataKey` |
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
- 清单是**旧格式（版本 1）**或封板中途中断（有 dump / credentials 但没有清单）：判「不可用」，
  不做迁移、不静默自举 —— 按提示重新封板；
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

## 退出码

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

### 复用已在监听的进程（`E2E_REUSE_SERVER=1`）

默认**不复用**：3001 上残留的后端进程里缓存了一份应用设置 memo，而库每轮都会重建（全量 prepare
或从基线 restore，含放宽后的 CAP 节流读），复用它会读到上一个库的状态；4173 上残留的静态服务也
可能伺服旧产物。只有明确知道「3001 / 4173 上跑的就是本轮产物」时才用 `E2E_REUSE_SERVER=1`
打开复用。

打开后 **preflight 也换口径**（P1-2）：不再要求三个端口空闲，而是检查「可达 + 身份」——
后端 `/health/ready` 返回 200、4173 返回含 `<div id="app">` 的 index.html、3002 可达 ——
并打印复用警告（本轮可能连到旧产物 / 旧库，仅本地调试用）。它**不会**替你启动服务：

```bash
# 在 apps/e2e 下分别起两个进程（或用你自己的方式起同一份产物）
node scripts/start-backend.ts     # 后端 dist-stage（含日志 tee / 脱敏）
node scripts/static-server.ts     # 4173 静态代理（dist-staging + /api /socket 反代）
E2E_REUSE_SERVER=1 pnpm walnut e2e:smoke
```

## CI 形态（nightly）

`.github/workflows/e2e.yml`：每天 UTC 19:00（北京 03:00）+ 手动 dispatch 跑全量，**不进 PR**。
数据栈由 job 级 services 起（PG 18 / Redis 8，端口与凭据同 `scripts/env.ts`）；CI 上目前仍固定
`E2E_SKIP_BASELINE=1`（首跑优先绿）。基线执行层已参数化（`E2E_PG_CONTAINER` + Linux 直接
`docker exec`），所以 runner 上切回基线路径只是「解析 service 容器名并 export」这一步 —— 具体
的前置条件与一行切法写在 workflow 文件头的基线注释里。artifact 只保留 junit / `results.json` /
脱敏后的 `backend.log` / `stack.json` / 基线清单 —— trace、截图、HTML 报告不上传（不变量 8）。
细节看 workflow 文件头与优化文档 P1-3 / P0-1。

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
- 页面停在一行 `forbidden` 或登录框等不出来：多半是 4173 被**别的**静态服务占着。默认配置下
  Playwright 会因端口被占直接失败（static-server 以 2 退出）；跑之前确认 4173 上没有遗留进程
  （`netstat -ano | findstr :4173`）。
- trace / 截图里的请求头与响应体**含 token 与 cookie**：`test-results/` 与 `playwright-report/`
  只留在本机，**不许上传到任何公开位置**。
