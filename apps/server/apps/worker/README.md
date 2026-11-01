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

## 启用方式（单容器内）

前提：镜像仍按 `apps/api` 构建（`pnpm build` / `build:stage`）。api 构建会一并产出
`dist/apps/worker`（cli 是纯工具、被 `exclude` 挡在 api 构建外；worker 是同一镜像里的可选入口），
所以默认镜像就带着它，worker 只是可选的启动参数。
**不做「每个 app 一个容器」**：worker 与 api 共用同一镜像、同一份 `env-local`（PG / Redis 配置
同源），不要为它单独建 compose 服务或复制一套 env。

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
顺手起 api 时用 `pnpm start:prod` —— 它**没有**注入让位 env，与 worker 同跑时按上一节给 api
显式注入 `WORKER_STANDALONE`。

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
