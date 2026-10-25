# ADR-0021: 数据库从 MongoDB 整体迁移到 PostgreSQL

**Date:** 2026-10-25
**Status:** Accepted

## Context

后端自脚手架时代起建立在 Mongoose 之上：以 schema 文件数为准共 24 个集合；事务经
`@WalnutDBTransaction()` 拦截器开启 `ClientSession` 挂到请求上，业务层用 `@WalnutDBSession()`
取出后**逐层显式传参**给仓库层（机制见 [MongoDB 事务](../backend/transactions.md)）；seed 数据是
保留 Extended JSON（`$oid` / `$date`）的 JSON 文件；跑起来的最低要求是 MongoDB **副本集** ——
本地开发也得 `rs.initiate()` 起一个单节点副本集（见
[数据库与初始化数据](../backend/mongodb.md)）。

推动整体迁移的是两件叠加的事：

1. **事务能力被部署形态绑死**：MongoDB 的多文档事务只在 replica set 上可用，单机 mongod 完全没有
   ACID。对照 PostgreSQL —— **单节点即完整 ACID**，事务不再对拓扑提要求。「跑起来」的最低形态
   因此简化一维，本地开发与 CI 的服务容器都跟着受益。
2. **官方镜像渠道坍塌**：Bitnami 自 2025-08 起冻结免费公共目录并迁入 `bitnamilegacy`，现行镜像只剩
   dev / latest 标签、生产用途需要订阅。本仓 `deploy/docker-compose.yml` 与
   `apps/server/docker/docker-compose.dev.yml` 里的 `bitnami/mongodb`、`bitnami/redis` 全部受影响
   —— 维持现状等于把生产部署押在一个已宣布终结的免费渠道上。

另外**数据迁移的负担天然很轻**：本地数据被视为最新数据（唯一的真源），线上只是 demo 环境
（见 Decision 6）—— 这也是「整体切换」在这个时间点可负担的原因。

## Decision 1: 整体切换到 PostgreSQL，ORM 选 TypeORM 1.x

24 个集合一次性全部迁到 PostgreSQL，**不做双轨**。ORM 选 **TypeORM 1.x + `@nestjs/typeorm`**
（`@nestjs/typeorm` 的 v12 是官方包，peer 依赖覆盖 Nest 11 / 12，与本仓 NestJS 11 对齐）；
`mongoose` / `@nestjs/mongoose` 随迁移退场。选定全量切换的依据是数据基准（Decision 6）：
没有线上存量要保兼容，渐进双轨只会把两套驱动、两套 repository 语义同时养在代码里。

## Decision 2: 主键直接切 UUID，不做 24-hex 兼容伪装

`_id` 从 ObjectId 切换为 UUID，**不在字符串列里继续装 24 位 hex** 来冒充兼容 —— 那种伪装会让
「ID 是什么」永远说不清，且把 ObjectId 的校验/构造残留永久留在代码里。切换是诚实的，连带改造点
一并算进迁移范围：

| 连带改造点 | 现状 | 迁移后 |
|------------|------|--------|
| DTO 校验器 | `Types.ObjectId.isValid` 一类 Mongo 专用校验 | UUID 校验 |
| locale 管道 | 按 ObjectId 解析路由参数 | 按 UUID 解析 |
| 列表查询 | 按 `_id` 查询/排序的转换逻辑 | 按 UUID 列查询 |
| seed 数据 | Extended JSON（`$oid` / `$date`） | 随 seed 通道重建（Decision 6） |

## Decision 3: 事务装饰器 API 不变，内部换 PG 实现

`@WalnutDBTransaction()` 对业务层**保持原样**：装饰器照挂、session 参数装饰器照用，拦截器内部
改为开启 PostgreSQL 事务。业务代码不需要感知存储换了：

```typescript
class UserController {
  @WalnutDBTransaction()
  async create(@Body() dto: UserCreateDTO) {
    return this.service.create(dto)
  }
}
```

这条不变量同时是本次迁移最大的风险面（见 Consequences 的风险 1）：现有事务链路靠把
`ClientSession` 逐层传参串起来，内部实现换成 PG 后，任何一处传参链的遗漏都可能在编译期静默通过。

## Decision 4: 容器镜像弃用 Bitnami，改 Docker 官方镜像

弃用的是**整个 Bitnami 渠道**，不只是 mongodb：

- 数据库镜像改用 Docker 官方 `library/postgres`；
- `bitnami/redis` 同受冻结影响，随本批一并迁离 Bitnami（改用 Docker 官方镜像）；
- 改造范围覆盖 `deploy/docker-compose.yml`（生产）与 `apps/server/docker/docker-compose.dev.yml`
  （开发）两处 compose。

## Decision 5: 回收站是业务功能，完整保留

`sys_deleted` 回收站（软删时存整文档 JSON 快照 + `recover` 按原集合动态恢复）是**业务层功能**，
不依赖任何 MongoDB 特性，与数据库无关 —— **完整保留**，随迁移移植到 PG 实现上。

唯一的历史包袱：存量旧快照是 `JSON.stringify` 的 Mongo 文档，内含 ObjectId 语义的 `_id` 与引用。
恢复旧快照时需要 ID 转换器，或对「迁移前归档的快照」明确放弃恢复策略 —— **两种都合法，实施阶段
拍板**，本 ADR 只固定「功能保留、包袱如实处理」这两条。

## Decision 6: 数据基准 —— 本地为准，线上不迁

本地数据视为最新数据（真源）；线上是 demo 环境，无迁移价值，**不做线上数据迁移**。迁移分期里的
数据通道（Phase 4）只覆盖**本地 + seed**：`apps/server/db/seed/` 这份 JSON 真源按 UUID 语义
重建，继续作为可再生的初始化数据来源。

## Alternatives considered

- **留在 MongoDB（不迁移）**：改动最小的显然备选。否决理由：事务能力继续被 replica set 绑死，
  且镜像渠道坍塌的问题不解决 —— 那是随时间恶化的外部依赖，不是可以搁置的口味问题。
- **留在 Bitnami、迁入 `bitnamilegacy` 标签**：一行 image 改动就能续命。否决理由：legacy 目录
  的性质是「冻结存档」而非「继续维护」，没有安全更新的承诺；对要上生产的部署来说只是把断崖
  往后挪。
- **MikroORM 7 双驱动渐进迁移**：支持同一套实体定义下双驱动并存、可按模块逐步切，技术上最平滑。
  落选理由：生态规模与官方 Nest 集成深度都不如 TypeORM（`@nestjs/typeorm` 是官方包，
  MikroORM 靠社区维护的 Nest 模块）；且本项目基于数据基准（Decision 6）已经选择**全量切换**
  而非双轨 —— 双驱动保留的价值前提不存在。
- **Prisma**：声明式 schema + 生成式客户端，迁移工具成熟。落选理由：其客户端形态与既有
  Nest 装饰器 / Repository 分层的写法偏差大，Nest 集成靠社区包而非官方一等支持，全量替换的
  改造成本高于 TypeORM 路线。
- **Drizzle**：更贴近 SQL 的轻量封装，类型体验好。落选理由：定位偏向「喜欢手写 SQL 的团队」，
  生态规模与 Nest 集成深度不足以承载一次全量替换。

## Consequences

- **好处**：单节点即完整 ACID，事务不再要求 replica set，本地/CI 的最低部署形态简化；镜像回到
  Docker 官方渠道，生产部署不再押在冻结的免费目录上；关系型约束（外键、唯一约束）从此可用。
- **风险与缓解（写实）**：
  1. **事务链路静默失效**：业务层到仓库层靠数十处 `.session()` 传参串起事务，换成 PG 实现后，
     任何一处漏改都**不是编译错误** —— 参数还在、类型对得上（或退化为 any），只是事务静默地
     不生效。缓解两条：拦截器 API 不变（Decision 3）把改动面压在基础设施层内；迁移分期里的
     Phase 0（动手前在旧库上锁定现有事务行为的基线测试）让「迁移前后行为一致」可逐条对账。
  2. **ID 体系切换的隐性耦合**：ObjectId 的语义以字符串形态散在校验器、管道、查询与 seed 里，
     编译器看不见字符串里的语义 —— 漏改一处不会红，只会在运行期收到查不到数据的静默错误。
     缓解：把改造点当清单管（Decision 2 的表），并以 Phase 0 基线测试覆盖按 ID 查询的路径。
  3. **回收站旧快照兼容**：旧快照内嵌 ObjectId 语义，恢复需要转换器或明确放弃（Decision 5，
     实施阶段定）。风险形态是「最需要恢复数据的时刻才发现恢复不了」，所以策略必须在实施期
     显式决策，不许默认搁置。
  4. **lang i18n 聚合管道重写**：多语言模块用 Mongo 聚合管道做合并查询，PG 侧需要用 SQL 重写
     等价查询并逐字段对账结果。
  5. **测试 / CI / seed 工具链重建**：seed / export / 形态校验 / 打包这条初始化数据链路都按
     Extended JSON 与 Mongo 语义实现，随库重建；CI 里的 MongoDB 服务容器同步换成 PostgreSQL。
- **文档连带**：[数据库与初始化数据](../backend/mongodb.md) 与
  [MongoDB 事务](../backend/transactions.md) 描述的是迁移前现状，随实施推进改写为 PostgreSQL
  版本（纳入实施清单，不在本 ADR 内展开）。

## Related

- [数据库与初始化数据](../backend/mongodb.md) —— 迁移前 MongoDB 的运行要求（副本集）与 seed 链路。
- [MongoDB 事务](../backend/transactions.md) —— `@WalnutDBTransaction()` 的现有实现机制，
  本决策保持其 API 不变。
