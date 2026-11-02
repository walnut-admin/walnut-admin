# ADR-0024: 健康探针 liveness / readiness 分离

**Date:** 2026-11-02
**Status:** Accepted

## Context

compose 的 healthcheck 此前抓静态图片（`/w/v1/static/images/demo.png`）—— 只能证明 Express 进程
还能响应，PG / Redis 已挂也一样 healthy。另一候选是 Terminus 的 `/app/health/*`：它挂在角色守卫
后面，且全局异常过滤器把一切错误兜成 HTTP 200 + `body.code`，编排层无法从状态码看出依赖是否
可用。

## Decision 1: 两个 raw Express 探针 + 编排层接线

`/health/live`（liveness，零依赖，进程存活即 200）与 `/health/ready`（readiness，并发执行
PG `SELECT 1` 与 Redis `PING`，各 1.5s 超时，任一失败 / 超时真 503）由
`apps/server/apps/api/src/app/probes.composition.ts` 以裸 Express 路由挂载，时机固定在
`NestFactory.create()` 之后、`listen()` 之前 —— 逃逸 app.module 注册的 11 个 `APP_GUARD`（另有 tech.module 的 Throttler 第 12 个）、
全局响应包裹与异常
过滤器（它们都在 `app.init()` 才注册）。既有静态资源探针已验证「raw route 先接住请求」这一
机制。

配套三件事：

- `deploy/docker-compose.yml` 的 backend healthcheck 改为 fetch `/health/ready` 并断言
  `r.ok`；Redis 自带带密码 PING 的 healthcheck，backend 的 `depends_on` 要求 PG / Redis 先
  `service_healthy`。
- `deploy/nginx/conf.d/api.conf` 对 `/health/` 返回 404，并用大小写不敏感正则兜底（Express
  路由不区分大小写，前缀 location 区分）；`deploy/post-verify.sh` 在部署后断言经 nginx 拿到的
  仍是 404。
- `/app/health/*` 原样保留：它是带角色与权限点的后台诊断面，不是编排探针。

## Alternatives considered

- **Terminus 原生 controller + 每个端点标 `@HealthCheck` / 守卫 Free**：要改 6-8 处安全层文件，
  漏标一个端点就静默回到恒 200 的语义；探针仍需穿过响应包裹。否决。

## Consequences

- 探针不再被「HTTP 200 + body code」模式欺骗：依赖挂了编排层能看到 503 并停止导流。
- 收到 SIGTERM / SIGINT 后 readiness 立即 503 `{ status: 'draining' }`，与
  `enableShutdownHooks` 的优雅关闭并行。
- 安全边界：响应体只有 `status` 与 `checks.{pg,redis}` 二值，不含版本号 / 连接串 / 耗时；
  nginx 挡公网，post-verify 有 404 断言。
- 代价：两条 raw 路由不进 openapi、不在 Nest 生命周期内，改动时必须保持挂载时机。
