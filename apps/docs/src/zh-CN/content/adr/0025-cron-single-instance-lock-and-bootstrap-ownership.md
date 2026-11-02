# ADR-0025: 定时任务单实例锁与 bootstrap 归属

**Date:** 2026-11-02
**Status:** Accepted

## Context

`@nestjs/schedule` 的 `@Cron` 是进程内定时器：api 与 worker 同时启动时同一 tick 会在两个进程各
跑一遍。启动期 bootstrap 的 6 个任务（含非幂等的 `rotateAppKey`）同样在每个进程各跑一次；key
轮换的过期判断原先在事务外，双进程交错会让后进者把先者的新 key 再次作废。

## Decision 1: key 轮换用事务内 FOR UPDATE 幂等化

`apps/server/libs/app-domain/src/key/key.service.ts` 的 `rotateForCronJob` 改为「事务 →
`FOR UPDATE` 锁当前 ACTIVE 行 → 锁内重读 `validEnd` → 仍过期才 rotate」。后进者拿到锁后看到
先者插入的新 ACTIVE 行即跳过，不依赖任何分布式锁。

## Decision 2: bootstrap 归属交给组合根

6 个启动任务拆到 `apps/server/apps/api/src/modules/techniques/task/bootstrap-task.module.ts` 的
`AppBootstrapTaskModule`，由组合根决定归属：默认 api 加载；`WORKER_STANDALONE=true` 时 api 让
出、worker 加载；cli 用 `WALNUT_ADMIN_BOOTSTRAP_TASKS=off` 隔离副作用（`openapi:export` 不应
触发轮换）。`WORKER_STANDALONE` 同一判据也控制 api 侧 `ScheduleModule` 的注册（`schedule.composition.ts`；
cli 的 `WALNUT_ADMIN_BOOTSTRAP_TASKS=off` 只隔离 bootstrap 任务，不影响 cron 注册）。

## Decision 3: 7 个 @Cron 套 Redis try-lock

`libs/cache` 的 `AppTechCacheCronLockService` 以 `SET NX EX` 抢锁，释放用 Lua 比对 token 后删除；
抢不到锁的实例记 warn 后跳过本次 tick。拿锁有 1s 超时、释放有 1s 上限，防 Redis 断连重连时卡在
offline queue。三种抢锁结果：Redis 命令异常 / 抢锁超时 → fail-open 无锁执行；键已被另一实例
持有 → fail-closed 跳过本次 tick（任务本身幂等，下一轮 cron 会再触发）。
所有 `@Cron` 另配 `waitForCompletion: true`，防同实例上一次未跑完时自重叠。

## Alternatives considered

- **@nestjs/locks**：0.0.x、ESM 形态与本仓 CJS 不合，还要自实现 LockStore；成本大于收益。
- **Bull repeatable job**：等于把调度语义整体迁到队列，改动面远超本轮范围。
- **PG advisory lock**：轮换已幂等化后不需要；且锁与被保护的 Redis 状态分居两个系统。

## Consequences

- 部署契约固定为「1 个 api + 0 或 1 个 worker」：`WORKER_STANDALONE=true` 时 worker 未起，
  cron 与预热都彻底不跑；api 启动日志会打一条让位 warn（`warnIfWorkerStandalone`）。
- fail-open 是有意的取舍：Redis 故障时任务照常执行，宁可重复不可停摆；任务体自身按
  upsert / 条件判断保持幂等。
- 多副本场景由 Redis 锁互斥；bootstrap 的单份归属依赖当前「1 api + 0/1 worker」部署契约
  （每个 api 副本默认都会执行 bootstrap）——拆多副本时 bootstrap 需另行加锁，并升级到
  `@nestjs/locks` 或等价方案。
- 证据：`apps/server/apps/worker/README.md` 记录 worker 启停与部署契约。
