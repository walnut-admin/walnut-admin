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
3. stage 产物已构建：`apps/server/dist-stage`（`pnpm --filter @walnut/server build:stage`）与
   `apps/admin/dist-staging`（`pnpm walnut build:stage`）。
4. Playwright 浏览器已安装：`pnpm --filter @walnut/e2e exec playwright install chromium`。
5. Windows 侧 3001 / 3002 / 4173 空闲（后端、socket.io、静态代理）。
6. Node >= 24.15.0、pnpm >= 12（根 `package.json` 的 engines）。

## 运行

```bash
pnpm walnut e2e         # 全量：preflight → prepare-db → stack-info → 全部 spec（含 @network）
pnpm walnut e2e:smoke   # 冒烟子集（setup + 首页 / 登录 / 用户 CRUD）
pnpm walnut e2e:risk    # 设备 ID 全生命周期（不含 @network）
pnpm walnut e2e:network # 只跑依赖真实外网的用例（当前是 U1b：api.ip.sb 的定位）
pnpm walnut e2e:report  # 打开上一轮 HTML 报告
```

包脚本只是把参数交给 `scripts/run.ts`（`e2e:smoke` = `node scripts/run.ts --project=smoke`），
额外参数原样透传给 Playwright，例如 `pnpm --filter @walnut/e2e e2e -g "登录"`。

依赖外网的用例在标题里带 `@network`：`risk` project 用 `grepInvert` 排除它们，`network`
project 只收它们 —— 离线环境里 `e2e:risk` 仍应全绿，只有 `e2e:network` 与全量会要求外网。

`run.ts` 的顺序是硬约束：

1. **抢 run 级 advisory lock 并整轮持有** —— 两个 worktree 同时跑全量时，第二个在等锁；
   120s 内抢不到就报「谁在持锁」并退出（一轮全量远超这个时长，所以实际表现是第二个直接失败）。
   锁不在 prepare 结束就放：否则后一个 run 的 `DROP DATABASE` 会删掉前一个正在用的库；
2. `scripts/preflight.ts` 查前置（env / 两处 stage 产物 / chromium / PG·Redis 可达 / 3001·3002·4173
   空闲）——**在动库之前**，失败按退出码 2 收场；
3. `prepare-db` 每次**重建**库：`DROP DATABASE … WITH (FORCE)` → `CREATE` → 迁移 → seed →
   把 `admin` 提升为 root → 放宽 CAP 节流 → 重置 `walnut_app` 口令 → 写 `.auth/credentials.json`。
   所以「数据还在不在」不用操心，跑一次就是干净库；
4. `stack-info` 写本轮栈信息（含两处产物的**真实 mtime**，用来判断跑的是不是旧产物）；
5. `playwright test`（webServer 由它起；默认**不复用**已在监听的进程 —— 见下面「退出码」）。

设备与 Redis 键的清理由 `tests/fixtures.ts` 的 auto fixture 统一做：断言失败时也会执行，
不会因为用例末尾的手写清理被跳过而留下残渣。

## 退出码

| 码 | 含义 | 什么时候出现 |
|----|------|--------------|
| 0 | 成功 | 全部用例通过 |
| 1 | 跑起来了但结果不对 | 用例失败、脚本自身报错、子进程（migration / seed）以其它非零码退出 |
| 2 | **环境没准备好** | 缺 `.env.stage`、缺 stage 产物、PG / Redis 连不上、端口被占、没装 chromium；seed 以 2 退出也原样透传 |

看到 2 就不必怀疑用例：按报错里的「处置」把前置补齐再跑。Playwright 自己的退出码原样透传
（它用 1 表示有用例失败）。

### 复用已在监听的进程（`E2E_REUSE_SERVER=1`）

默认**不复用**：3001 上残留的后端进程里缓存了一份应用设置 memo，而 prepare-db 每轮都重建库
（含放宽后的 CAP 节流读），复用它会读到上一个库的状态；4173 上残留的静态服务也可能伺服旧产物。
只有明确知道「3001 / 4173 上跑的就是本轮产物」时才用 `E2E_REUSE_SERVER=1` 打开复用。

## 排障

- 本轮连的是哪个库 / 哪份产物（含产物 mtime）：`apps/e2e/.e2e/stack.json`。
- 单独查前置：`node apps/e2e/scripts/preflight.ts`（不重建库、不起服务）。
- 安全闸报错（库名或端口不对）：说明环境串到了 dev 口径。**别绕开它**，回
  `apps/e2e/scripts/env.ts` 核对常量。
- 5433 连不上：先 `docker compose ps`，再 `wsl -l -v` 看发行版 STATE 是不是 Running。
- 页面停在一行 `forbidden` 或登录框等不出来：多半是 4173 被**别的**静态服务占着。默认配置下
  Playwright 会因端口被占直接失败（static-server 以 2 退出）；跑之前确认 4173 上没有遗留进程
  （`netstat -ano | findstr :4173`）。
- trace / 截图里的请求头与响应体**含 token 与 cookie**：`test-results/` 与 `playwright-report/`
  只留在本机，**不许上传到任何公开位置**。
