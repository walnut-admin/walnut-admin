# 数据权限（Data Scope）设计方案

> 2026-10-30 调研定稿。两路调研：RuoYi 机制拆解（源码级）+ TypeORM/PG 现代方案盘点。
> 决策待维护者批准后进入实施（一期建议范围见 §5）。

## 1. 背景与现状

本仓权限体系已完备的是**功能权限**（菜单权限串 → `AUTH:PERMISSIONS` 缓存 → permission.guard
精确匹配，含 P1-18 membership 根修）；**数据权限**（行级：谁能看到/操作哪些行的数据）缺失。
本仓无部门维度，用户/角色模型为 sys_user / sys_role / sys_user_role junction。

## 2. RuoYi 机制拆解（对照基准）

若依（RuoYi-Vue）的实现 = **Service 层 AOP 切面拼 SQL 文本 → 塞进 `BaseEntity.params.dataScope`
→ Mapper XML 手写 `${}` 占位符展开**。

- 角色 `sys_role.data_scope` 五档：1 全部 / 2 自定义（sys_role_dept 中间表）/ 3 本部门 /
  4 本部门及以下 / 5 仅本人；多角色条件 OR 串联（最宽授权），无匹配兜底 `dept_id = 0`（默认拒绝）。
- 「本部门及以下」依赖 `sys_dept.ancestors` 逗号路径串 + `FIND_IN_SET`（无索引）；
  自定义范围是显式清单不递归子树。
- RuoYi-Vue-Plus 已弃用该方案，改 MyBatis-Plus `InnerInterceptor` + JSQLParser 解析改写 +
  SpEL 模板：自动覆盖 SELECT/UPDATE/DELETE、显式 ignore 机制、子树缓存——但仍是应用层过滤。

若依方案的已知局限（对本设计的启示）：

1. 只在「标注注解 **且** XML 手写占位符」的语句生效——漏一处即全量泄露；详情/删除/导出需手工兜底。
2. 别名/字段名/占位符三处人肉对齐；`${}` 文本替换致 SQL 难以复用执行计划。
3. `FIND_IN_SET(ancestors)` 无索引；部门移动需级联更新所有后代（写放大）。
4. 一用户一部门（单值）；仅有部门/用户两个过滤维度。
5. 角色数据范围缓存在登录态里，变更后要重登才生效。

## 3. TypeORM/PG 方案对比

| 维度 | 应用层 where 注入 | PostgreSQL RLS | 视图 | casbin |
|---|---|---|---|---|
| 防绕过 | 中（收口到基类 + lint 较强） | **强**（DB 层强制） | 中 | 弱（仅显式 enforce） |
| 性能 | 好（参数化 + 索引友好） | 中（需 STABLE 包装 + 索引，否则 seq scan） | 中（barrier 伤计划） | 差（列表 N+1） |
| 可测性 | **好**（纯函数 + mock，贴合现有测试风格） | 差（需 testcontainers 基建，本仓没有） | 中 | 中 |
| 与现有 guard/roleMode 组合 | 正交，语义沿用 COMBINE/SWITCH | 正交但注入点在事务内 | 正交 | 形成第二权限源 |
| 运维复杂度 | 低 | 高（独立角色/FORCE/连接池纪律/导出 row_security=off） | 中 | 高 |

### PG RLS 的三个硬阻塞（决定其为二期备选）

1. 本仓读路径大多**不在事务里**（`getManager` 回退池级连接）；RLS 的
   `set_config(..., true)` 必须事务内，事务外等于没设；业界实测「注入 repository
   另取池连接」会导致全 0 结果甚至死锁。
2. **Guard 链先于拦截器执行**，登录前置链路要查 sys_device/sys_user——
   全局 fail-closed RLS 覆盖系统表会直接弄断登录链路；RLS 只能覆盖业务表。
3. 本仓没有 testcontainers/DB 级测试基建，RLS 行为无法进回归网。

业界要点（Supabase/PostgREST 生态）：`current_setting` 是 VOLATILE，策略里直接用会
575× 退化——需包 `STABLE` SQL 函数 + 策略列 btree 索引；多策略默认 PERMISSIVE 取 OR，
租户硬边界用 `AS RESTRICTIVE`；导出用 `row_security=off`（报错而非静默少行）。

## 4. 推荐方案

### 一期（主方案）：应用层 scope + 基类收口 + fail-closed 注册表

```
JWT Guard → ALS 拦截器种入 { user, dataScope } → controller → service
  → pg-base.repository
       ├─ list(): applyPgListQuery → customize → applyDataScope(qb)
       └─ readById/update/deleteSoft*: scopedWhere(id)（天然阻断越权改删）
```

设计要点：

1. **描述符**：`DataScopeDescriptor = { mode: 'ALL'|'SELF'|'CUSTOM', userId, userIds? }`；
   解析器为纯函数（用户角色 junction + 角色 dataScope → 描述符），可单测。
2. **范围三档（一期）**：`ALL`（root/显式授予）/ `SELF`（仅本人，owner 列 = 当前用户）/
   `CUSTOM`（用户/部门 id 清单，应用层解析后 `IN (:...ids)`，不做行内子查询）。
   部门维度二期引入（§6）。
3. **实体注册表**：`{ entity, scopeColumn, allowAnonymous? }`；注册即强制过滤，
   未注册即显式豁免；**单测断言「所有含 owner 列的实体已注册或豁免」**（防漏注册的机械守卫）。
4. **注入语义**：一律 `andWhere`（不可被 or 放宽）；`customize` 钩子之后追加；
   写路径由「readById（带 scope）→ save」近似 RLS 的 WITH CHECK；`updateByField` 同样带 scope。
5. **收口与机械守卫**：ESLint `no-restricted-syntax`（或单测扫描）禁止
   `common/repository` 之外调用 `.getRepository(`——钉死直连绕过面
   （现存直连点：monitor user / setting / key / purge purge 四处，随实施收口）。
6. **缓存**：`AUTH:DATA_SCOPE:<userId>`（不带 deviceId——角色不随设备变）；
   角色变更、用户角色变更、角色删除三处写入口失效（复用 `AUTH:PERMISSIONS` 的
   「唯一写入口 + 失效」纪律）。
7. **multi-role 语义**：COMBINE = 各角色 scope 取并集（最宽）；SWITCH = 仅 currentRole
   的 scope；root 恒 ALL——沿用现有 roleMode 语义。

### 二期（可选）：RLS 作 RESTRICTIVE 硬上限 + 部门维度

- 引入 `sys_dept` / `sys_user.dept_id` / `sys_role_dept` / `sys_role.data_scope smallint`
  （1 ALL / 2 CUSTOM / 3 DEPT / 4 DEPT_AND_CHILD / 5 SELF / 6 DEPT_OR_SELF，对齐若依语义）；
  子树查询用 `WITH RECURSIVE`（不照搬 ancestors 逗号串）。
- 描述符扩为 `{ mode, userId, deptIds }`，只改解析器与谓词一处，基类不动。
- RLS：业务表 `ENABLE + FORCE`、独立 `walnut_app` 运行角色（NOBYPASSRLS）、
  `RESTRICTIVE` 租户/组织天花板策略 + `STABLE` 函数包装 + 索引；只对业务表启用
  （不覆盖守卫链依赖的系统表）；`WalnutTxInterceptor` 事务内注入
  `set_config('app.tenant_id', ..., true)`；**删除 `getManager` 的池级回退**；
  `db:export:pg` 用 BYPASSRLS 角色。

## 5. 一期改动面预估

- 新：`modules/system/data-scope/{data-scope.service.ts, data-scope.module.ts}`（解析 + 缓存 + 失效）
- 新：`common/repository/data-scope.ts`（纯函数 applyDataScope/buildScopedWhere + 注册表）
- 改：`common/repository/pg-base.repository.ts`（list/readById/updateByField/delete* 注入）
- 改：`als.interceptor.ts` + `request.service.ts`（上下文种入 user/dataScope）
- 新迁移：`sys_role.data_scope smallint`（root 回填 ALL）
- 改：role entity/DTO/controller + admin 角色表单（dataScope 选择器）
- 收口：monitor user / setting / key 三处直连 repo
- 新：drift 类单测（实体注册完整性）+ ESLint 规则（禁基类外 getRepository）

## 6. 与 RuoYi 对照

| 维度 | RuoYi | 本方案 |
|---|---|---|
| 注入方式 | AOP 拼 SQL 文本 + XML `${}` 手工展开 | 基类 andWhere 参数化 |
| 覆盖面 | 仅标注+占位符双全的查询（漏即裸奔） | 基类单点收口 + lint 防直连 |
| 部门子树 | ancestors 逗号串 + FIND_IN_SET（无索引） | 二期递归 CTE / ltree |
| 多角色 | 最宽授权 OR 拼接 | COMBINE 并集 / SWITCH 当前角色（沿用 roleMode） |
| count 一致性 | list/count 双份拼接易漏 | `COUNT(*) OVER()` 单趟天然含 scope |
| 行级强制 | 无（应用层） | 一期应用层 + 二期 RLS RESTRICTIVE 可选 |
