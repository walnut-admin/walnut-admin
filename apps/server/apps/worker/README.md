# `@walnut/server` worker（可选第二进程）

> 默认部署**不启动**本应用：`apps/api` 单进程仍全功能（HTTP + cron + Bull 消费）。
> worker 是同一镜像里**可选**的第二进程，用来把 cron / 队列消费从 web 进程里分流出去。
> 决策背景见 [ADR 0022](../../../docs/src/zh-CN/content/adr/0022-backend-lib-layering-and-composition-roots.md)。

## 它是什么

`apps/worker/src/main.ts` 用 `NestFactory.createApplicationContext(WorkerModule)` 起一个**没有 HTTP
监听**的应用上下文（不占端口、不接流量），`WorkerModule` 复用 `apps/api` 的 `AppModule`，并显式
注册 `ScheduleModule`。职责（`WORKER_STANDALONE=true` 时还包括执行 bootstrap 预热与维护任务，见下文部署契约）：

- 跑 `@Cron`（task 域的定时任务、refresh token purge 等）；
- 消费 Bull 队列（多进程竞争消费是安全的：同一 job 只会被一个 consumer 取走）。

## 启用方式（本地 / 单容器内）

前提：镜像仍按 `apps/api` 构建（`pnpm build` / `build:stage`）。api 构建会一并产出
`dist/apps/worker`（cli 是纯工具、被 `exclude` 挡在 api 构建外；worker 是同一镜像里的可选入口），
所以默认镜像就带着它，worker 只是可选的启动参数。
**不做「每个 app 一个镜像 / 一个构建 target」**：worker 与 api 共用同一镜像、同一份 `env-local`
（PG / Redis 配置同源），镜像只有一个入口 CMD（见 `apps/server/Dockerfile`）；生产编排里它只是
**同镜像的第二个 service**，见下一节。

在 `apps/server/` 目录下（ConfigModule 用 `process.cwd()` 定位 env）：

```bash
# 构建（prod 画像；stage 用 build:worker:stage）
pnpm build:worker

# 启动 worker 进程（WORKER_STANDALONE=true 由脚本注入）
pnpm start:worker

# 预发
pnpm build:worker:stage
pnpm start:worker:stage
```

`start:worker` 里的 `cross-env` 是 devDependency，**镜像内没有**（`pnpm deploy --prod` 只带生产依赖）。
在容器里直接给 env 启动同一入口：

```bash
WORKER_STANDALONE=true NODE_ENV=production node dist/apps/worker/src/main.js
```

启动日志会打印 `worker process started (no HTTP listener); cron jobs: N [...]`。
顺手起 api 时用 `pnpm start:prod` —— 它**没有**注入让位 env，与 worker 同跑时必须给 api
显式注入 `WORKER_STANDALONE`（见下一节）。

## 生产如何跑（compose）

生产里 worker 是 `deploy/docker-compose.yml` 的一个 service，**与 backend 同一镜像、只覆盖
`command`**：`node dist/apps/worker/src/main.js`（cwd 由镜像的 `WORKDIR /app` 提供），
`restart: always`，`depends_on` 的 postgres / redis 都是 `service_healthy`，日志单独挂到
`./logs/worker`（与 backend 的 `./logs` 分开 —— 两个进程共写同一批按天文件会在
winston-daily-rotate 轮转时互相 rename）。它**没有 healthcheck**：本入口没有 HTTP 监听，
`docker compose up -d --wait` 对没有探针的服务只要求 running。

**两处 `WORKER_STANDALONE=true` 都写在 compose 的容器 `environment` 里**（backend 与 worker
各一条），不能只写进 compose 挂载的那份后端 env 文件：`schedule.composition.ts:24-26` 在
**模块定义期**求值，早于 ConfigModule 加载 env 文件。backend 那条是「让位」，worker 那条是「承接」。

- **单实例约束**：1 个 api + 0 或 1 个 worker（ADR 0025）。`@Cron` 是进程内定时器、没有分布式锁
  —— `docker compose up -d --scale worker=2` 会把同一批任务各跑一遍。
- **要关 worker，就连 backend 那条 env 一起撤**：只删 worker service、却留着 backend 的
  `WORKER_STANDALONE=true` ⇒ api 不注册 `ScheduleModule`、worker 又不存在 = **零 `@Cron` tick**
  （见下面「部署契约」）。
- **上线后自查**：`docker logs walnut-worker 2>&1 | grep 'cron jobs'` 应看到 `cron jobs: N`（N > 0）；
  api 的日志里应有 `[WorkerStandalone] … delegated to the worker process` 的让位 warn。

### 冒烟（CI 与本机同一条判据）

`.github/workflows/ci.yml` 的 `openapi` job 末尾有一节「Worker smoke (cron registered)」：
`pnpm build` 产出 dist（与镜像同一条构建命令）→ 以 `NODE_ENV=development` +
`WORKER_STANDALONE=true` + `WALNUT_ADMIN_BOOTSTRAP_TASKS=off` 启动
`dist/apps/worker/src/main.js` → 轮询最多 40s 等日志出现 `cron jobs: <非零>` → SIGTERM 收场。
**`cron jobs: 0` 也是红的** —— 「进程起来了但一个 cron 都没挂上」正是要抓的缺陷形态。

本机等价做法（在 `apps/server/` 下，需要 PG + Redis + 解密后的 `env-local/.env.development`）：

```bash
pnpm build
NODE_ENV=development WORKER_STANDALONE=true WALNUT_ADMIN_BOOTSTRAP_TASKS=off node dist/apps/worker/src/main.js
# 另开一个终端：约 9s 后应看到 "cron jobs: 7 [...]"；Ctrl-C 退出
```

三个坑（都是实测）：

1. **`NODE_ENV=production` 会直接拒绝启动**：`libs/config/src/utils/pg-app-password.ts:45` 的开发
   引导密码守卫 —— 本机冒烟只能用 `development`，生产靠真实的 `DATABASE_PG_APP_PASS`；
2. **冷 require 整张依赖图要 ~9s**（不是 3 秒）：Nest 自身只占 ~1s，别用固定 `sleep 3` 判；
3. **进程不会自己退出**：`enableShutdownHooks` 只等 SIGTERM，所以要显式 kill（Windows 下
   `Stop-Process` 是硬杀、走不到钩子）。

`WALNUT_ADMIN_BOOTSTRAP_TASKS=off` 只隔离 bootstrap 任务、**不影响 cron 注册**，所以计数断言
依然有效。

## cron 让位机制（为什么不会双跑）

`AppModule` 里的条件组合 `apps/api/src/app/schedule.composition.ts`：

- `WORKER_STANDALONE !== 'true'`（默认）：api 注册 `ScheduleModule.forRoot()`，cron 在 api 里跑
  —— 与 HEAD 行为一致；
- `WORKER_STANDALONE === 'true'`：api **不**注册 `ScheduleModule`，cron 只由 worker 的组合根注册
  （`apps/worker/src/worker.module.ts`）。worker 侧由启动脚本注入；**api 侧没有任何脚本代注入（Dockerfile CMD 固定）**，启用 worker 时要在容器环境显式给出（如 compose 的 api service 设置该 env），否则
  api 照旧注册 cron —— 会和 worker 双跑。

Bull 不需要开关：多进程消费同一个队列是竞争消费，不会重复执行。启动期 bootstrap 任务
（`AppBootstrapTaskModule`，W2-A 从 `AppTechTaskModule` 拆出）同样按组合根单份归属：默认归 api，
`WORKER_STANDALONE=true` 时 api 不加载、只由 worker 加载 —— `rotateAppKey()` 因此不会在两个
进程各跑一遍。

## 部署契约（`WORKER_STANDALONE=true`）

**前提：worker 必须运行。** 让位同时带来两个退化面，且都以「worker 在跑」为前提：

1. **cron 让位**：api 不注册 `ScheduleModule`；worker 不起则**没有任何 `@Cron` tick**
   （不是延后，是彻底不跑）；
2. **预热迁移**：settings / locale 缓存改由 worker 的 bootstrap 写入共享 Redis，api 读同一份。
   worker 不起时 api 的 `getSetting` 退化为默认值并逐次打 error 日志，langId 校验也会放行，
   直到 worker 首跑或 02:00 的 cron（同样需要 worker）。

两者是组合根让位的语义，不是故障。启动可见性：api 在 `WORKER_STANDALONE=true` 下启动时会打一条
让位 warn（`main.ts` 调 `warnIfWorkerStandalone`）——部署后先确认 worker 进程与这条日志。

## 文件

```
apps/worker/
├── src/main.ts          # 应用上下文入口 + 启动日志 + enableShutdownHooks
├── src/worker.module.ts # 组合根：AppModule + ScheduleModule（standalone 时）
├── tsconfig.app.json    # 编译范围（api + libs）
└── tsconfig.app.stage.json
```
