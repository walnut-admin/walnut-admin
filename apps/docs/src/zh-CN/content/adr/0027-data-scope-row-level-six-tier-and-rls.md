# ADR-0027: 数据权限行级设计（六档 + PG RLS 双保险）

**Date:** 2026-11-02
**Status:** Accepted

## Context

中后台需要行级数据权限：同一张业务表，不同用户只能看到 / 操作自己有权的那部分行。历史方案是
纯应用层注入谓词（列表与单行读写各自拼 WHERE）；数据权限二期引入部门维度与六档语义，数据权限三期把 PostgreSQL
RLS 作为数据库侧硬上限（建立在 ADR 0021 完成后的数据库能力之上），最终形态是「应用层谓词 + RLS 双保险」——应用层负责可见明细与越权
404，RLS 保证即使查询构造漏了谓词也拿不到天花板外的行。

## Decision 1: 六档在应用层解析，在仓库基类执行

ALL / CUSTOM / DEPT / DEPT_AND_CHILD / SELF / DEPT_OR_SELF 六档数值由 `@walnut/contract`
定义；`libs/system/src/data-scope/data-scope.resolver.ts` 是纯函数解析器（多角色按 roleMode
取并集或当前角色，visitor 固定 SELF），`libs/repository/src/pg-base.repository.ts` 在
list / readById / updateByField / delete* 统一注入 owner 与部门谓词，create 按注册表回填
owner / dept。解析与执行分离，决策层可单测，未来接策略引擎只换解析层。

## Decision 2: 注册即强制，未注册即豁免

注册表 `apps/server/apps/api/src/common/repository/data-scope.ts` 是跨域实体清单的唯一真源：
注册的实体全部走基类谓词，未注册的实体逐条登记豁免理由。ESLint
`walnut/data-scope/direct-repository` 拦「绕过基类直连已注册实体」，实体名清单由
`eslint-data-scope-entities.drift.spec.ts` 与注册表文本对账 —— 加实体漏同步会红。

## Decision 3: PG RLS 作数据库侧天花板

`libs/db/src/data-scope-rls.ts` 把描述符写进**当前事务**的 GUC（`app.data_scope.mode` /
`user_id` / `dept_ids` / `user_dept_id`）；迁移 `1793360000000-DataScopePhase3Rls` 对七张注册
表 `ENABLE + FORCE ROW LEVEL SECURITY`，每表一条 PERMISSIVE 基线 + 一条 RESTRICTIVE 天花板，
运行角色 `walnut_app` 为 NOSUPERUSER / NOBYPASSRLS。策略函数未读到设置时缺省 `anonymous`，
即 fail-closed 0 行 / 写入拒绝。

## Decision 4: 系统通道显式化

登录链、日志旁写、在线监控心跳、回收站快照、无请求的 cron 等必须在没有用户上下文时读写注册
表。它们不能靠「默认放行」，只能显式进入系统通道：请求内用
`@WalnutAdminDecoratorDataScopeSystemChannel()` 标记事务，无请求事务的路径经
`runInWalnutSystemTransaction`（或 `withWalnutSystemManager`）开独立 system 事务，ALS 侧为
`ALSRequestService.runAsSystem()`。每个豁免点都带理由与 `eslint-disable` 落点，便于审计。

## Decision 5: 回收站快照与登记制恢复器

删除前把行快照写入 `sys_deleted`（同样注册数据权限，SELF 只看本人删除的快照）；恢复按
`modelName` 路由到 `WalnutAdminRecoverableRegistry` 的登记式恢复器，未登记即受控报错，不在
service 里散落 if/else。

完整设计与演进过程见 [数据权限设计](../plans/data-scope-design.md)、
[二期三期计划](../plans/data-scope-phase2-3-plan.md) 与
[遗留整改计划](../plans/data-scope-remediation-plan.md)。

## Alternatives considered

- **纯应用层过滤**：基类收口 + lint 已较强，但绕过仓库直连 SQL 即失守；RLS 是 DB 层强制。
- **纯 RLS**：六档语义需要用户、角色、部门树与 roleMode 等应用上下文，纯策略表达不了。
- **若依式 AOP 拼 SQL + Mapper XML 占位符**：只在「注解 + 占位符双全」处生效，漏一处即全量
  泄露，且部门子树用无索引的 `FIND_IN_SET`；本仓用参数化谓词 + 递归 CTE 规避。
- **引入 OPA / Casbin 等策略引擎**：为六档 scope 引入 PDP 属过度设计；只吸收「残余过滤条件」
  思想，以纯函数形态落在解析层。

## Consequences

- fail-closed 语义贯穿两层：应用层缺上下文 403 / 越权 404（不泄露存在性），RLS 缺设置 0 行。
- `walnut_app` 是运行时专用角色：迁移内嵌的开发引导密码在 stage / production 会被启动校验
  拒绝，生产必须预建强密码角色。
- 多副本下数据面天然安全：每个请求的 RLS 设置只作用于本事务，连接回池即清空，不存在跨请求
  残留；池级直连因缺省 anonymous 而拒绝，而不是静默读到全量。
- 已知坑：PG 的 RESTRICTIVE 只做 AND、不能单独授予访问，每表必须另配 PERMISSIVE 基线，否则
  默认拒绝（INSERT 全撞策略）；WITH CHECK 对 sys_user / sys_employee 额外要求部门不变，防
  SELF / DEPT 用户改自家 dept 横向扩权。
- 运维代价：RLS 要求「查询与 `set_config` 同连接同事务」的连接纪律，spike 实测后维持每 CRUD
  隐式事务，不引入请求级事务合流。
