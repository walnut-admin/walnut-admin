# 数据权限二期三期实施计划

> **位置变更（2026-11-02）**：本文自仓库根 docs/plans/ 迁入 docs 站。状态：【已完结】，后续演进见同目录 `data-scope-remediation-plan.md`（整改批 4-7）与 [Guard 链与安全](/content/backend/modules/security)。

> 状态：**已批准；批 1/2/3 已实施**（批 1 `afc8cde`、批 2 `f90bcd5`、批 3 三期 RLS `11df28d`）。
> 前置：一期已落地（`c9b7694`）；组织地基已落地（`349e0b9`）。

## 0. 终态目标（验收口径）

**不同用户登录后，在 demo 模块（数据权限示范表）看到不同的数据**：

| 用户 | 角色 data_scope | 能看到的 demo 行 |
|---|---|---|
| root | ALL(1) | 全部（含无主行） |
| deptA-长 | DEPT(3) | deptA 成员创建的行 |
| deptA-总监 | DEPT_AND_CHILD(4) | deptA + deptA-child 成员创建的行 |
| deptB-经理 | DEPT(3) | deptB 成员创建的行 |
| custom-专员 | CUSTOM(2)（勾选 deptA+deptB） | deptA + deptB 成员创建的行 |
| combo-双角色 | COMBINE 多角色（DEPT + SELF） | 两档并集 |
| solo-普通 | SELF(5) | 仅自己创建的行 |
| visitor | — | 仅自己（匿名行共享不变） |

read/update/delete 同口径：越权行 read→404、update/delete→404（不泄露存在性）；
list 不出现。create 自动填所属部门/创建者。

## 1. 二期：部门维度（批 1 + 批 2）

> **批 1 已实施**（`afc8cde`）。**批 2 已实施**（2026-10-30）：demo 部门列 +
> create 双回填 + 角色/用户 admin 表单 + 六档 + M1-M10 矩阵
> （`apps/server/apps/api/test/api/system/data-scope/data-scope-matrix.api-spec.ts`）。

### 1.1 批 1：迁移与解析器扩展（纯后端）

**迁移**（新迁移文件，不改 InitSchema）：
- `sys_user.dept_id uuid NULL`，FK→sys_dept RESTRICT，索引 `idx_user_dept`
- `sys_role_dept(role_id, dept_id)` 复合 PK junction（CUSTOM 部门清单）
- `sys_role.data_scope` CHECK 扩展：`1,2,3,5` → `1,2,3,4,5,6`
  - 4 = DEPT_AND_CHILD（本部门及以下）
  - 6 = DEPT_OR_SELF（本部门及以下 + 本人——吸收 RuoYi-Vue-Plus 增强）
  - 语义表：1 ALL / 2 CUSTOM(部门) / 3 DEPT / 4 DEPT_AND_CHILD / 5 SELF / 6 DEPT_OR_SELF
- 实体/dto/漂移守卫同步；walnut_pg 手工 ALTER + 登记 migrations 行（先例照旧）

**解析器扩展**（`data-scope.resolver.ts`，档位 → 描述符）：
- 描述符从 `{ mode, userId, userIds? }` 扩展为 `{ mode, userId, userIds?, deptIds? }`
- DEPT → `deptIds = [user.dept_id]`；DEPT_AND_CHILD → 递归 CTE 取子树（`sys_dept.parent_id`
  递归 + CYCLE 兜底，能力已有，新增按用户 dept 取全树入口）；DEPT_OR_SELF → 子树 ∪ {userId}
- CUSTOM → `sys_role_dept` 部门清单（替换原「角色成员 userIds」语义）
- 多角色：COMBINE 并集；SWITCH 只看 currentRole（不变）
- 缓存失效新增：sys_dept 移动/删除、sys_role_dept 变更、用户 dept 变更

**单元测试**：解析器档位矩阵全分支 + 递归子树 + 缓存失效新点位。

### 1.2 批 2：demo 行部门归属 + admin + 测试矩阵（核心大批）

> 状态：**已实施**（2026-10-30）。
> - 迁移 `apps/server/apps/api/migrations/1793350000000-DataScopePhase2DemoDept.ts`
>   （`app_demo.dept_id` + `idx_demo_dept`；walnut_pg 手工 ALTER 保数据）；
> - create 双回填在基类仓库（`fillDeptOnCreate`，取创建者 `sys_employee.dept_id`）；
> - 角色 create/update 接 `deptIds`（sys_role_dept 整组替换）、read 回显；
> - admin 角色表单六档 + CUSTOM 部门树多选、用户表单部门树选择器；
> - M1-M10 落地 `data-scope-matrix.api-spec.ts`。

**demo 表的行级部门归属（关键设计，两案对比）**：

| 方案 | 谓词 | 优点 | 缺点 |
|---|---|---|---|
| A 冗余列（若依模式，推荐） | `demo.dept_id = ANY(deptIds)` | 索引友好（idx_demo_dept）、单跳 | 需迁移加列 + create 回填（取创建者 employee.dept_id，无 employee 则 NULL=仅 ALL/SELF 可见） |
| B EXISTS 链 | `EXISTS (SELECT 1 FROM sys_employee e WHERE e.user_id = demo.created_by AND e.dept_id = ANY(deptIds))` | 无冗余、归属实时 | 两跳、无 employee 行的创建者不可见 |

**推荐 A**（demo 是示范表，索引友好优先；create 回填逻辑封装在基类 `applyDataScope` 旁，
owner 与 dept 双回填）。B 作为「无冗余列表」的通用 EXISTS 回退在注册表支持
（`matchBy: 'column'|'ownerDeptExists'`）。

**admin**：
- 角色表单：dataScope 选择器扩展 6 档；CUSTOM 时部门树多选（勾选提交 sys_role_dept）
- 用户表单：dept 选择器（写 sys_user.dept_id）
- 职工表单：入职时选部门/岗位联动（已有 employee 模块，补前端页面本批不做→仅接口）

**测试矩阵（接口层，真实 HTTP 全链，demo 为靶表）**：

用户 fixture（每档 ≥2 用户，跨部门交叉）：
`root(ALL)` / `deptA-all(ALL)` / `deptA-manager(DEPT)` / `deptA-child-manager(DEPT_AND_CHILD)`
/ `deptB-manager(DEPT)` / `combo(DEPT+SELF，COMBINE)` / `custom(CUSTOM: deptA+deptB)`
/ `solo(SELF)` / `visitor(SELF)`

demo 行分布：root×1、deptA-长×2、deptA-经理×1、deptA-child-经理×1、deptB-经理×1、
solo×1、无主(NULL dept)×1

断言矩阵（list 可见集合 / read 越权 404 / update 越权 404 / create 归属回填）：

| # | 用户 | 预期 list 可见 | 越权 update |
|---|---|---|---|
| M1 | root | 全部 7 行 | — |
| M2 | deptA-长(DEPT) | deptA 的 3 行 | 改 deptB 行 → 404 |
| M3 | deptA-总监(DEPT_AND_CHILD) | deptA 3 行 + child 1 行 | 同上 |
| M4 | deptB-经理 | deptB 1 行 | — |
| M5 | combo(DEPT+SELF) | 部门行 ∪ 自己行 | — |
| M6 | custom | deptA ∪ deptB | — |
| M7 | solo(SELF) | 仅自己 1 行 | 改他人 → 404 |
| M8 | visitor(SELF) | 仅自己（+匿名共享不变） | — |
| M9 | 无角色用户 | 空（默认拒绝） | — |
| M10 | 缓存失效时序 | 角色改档位/移出部门后下一请求立即生效 | — |

外加：read 逐行 404 抽查、create 归属回填断言（dept 取创建者 employee.dept_id）、
`COUNT(*) OVER()` total 与行集一致。

### 1.3 批 2 验收
全量集成（473 基线 → 预计 +40~50 矩阵用例）连续 2 轮稳定 + prepush（段数以 `packages/tooling/scripts/src/ci/prepush.ts` 的表为准） + build:stage
+ admin types:check + openapi 重新生成。

## 2. 三期：PostgreSQL RLS RESTRICTIVE 硬上限（批 3）

> **实施摘要（批 3 已落地 `11df28d`；2026-10-31 补记）**
> - **F1 fail-closed**：`app.data_scope_mode()` 缺省 `anonymous` —— 未在事务里显式
>   `set_config` 的池级直连一律 0 行 / 写入拒绝；
> - **九类显式 system 通道**：登录链自管事务、sys_user 系统读腿、日志旁写、监控系统腿、
>   回收站快照、logOperateId 回填、组织前置校验、设备历史 JOIN、after-commit hook 隔离。
>   请求内用 `@WalnutAdminDecoratorDataScopeSystemChannel()` 标记；无请求事务的路径经
>   `runInWalnutSystemTransaction` 开独立 system 事务；
> - **F3 WITH CHECK 部门腿**：sys_user / sys_employee 的本人行只有在 `dept_id` 未改变
>   （等于账号当前部门）时才允许写入，新增 `app.data_scope_user_dept_id` GUC —— 防
>   SELF/DEPT 用户改自家 dept 借部门角色横向扩权；部门腿仍放行部门管理员的正常改派；
> - **F2 env 必填**：`DATABASE_PG_APP_USER/PASS` 缺失启动即报错，禁止回退管理角色；
>   批 6 追加「stage / production 拒绝 dev 引导密码 `walnut_app_dev_only`」的防呆；
> - **F4 recoverSnapshot 断言**：恢复链路删除 `sys_deleted` 快照行时断言恰好命中 1 行
>   （事务内失败整体回滚，不再静默吞掉半恢复）；
> - **F5 部署注意**：`walnut_app` 预建强密码角色、管理通道须 superuser 或 BYPASSRLS、
>   生产 env-encrypted 必须含 `DATABASE_PG_APP_*`（细节见
>   `modernization-roadmap.md` §6.2）。
>
> **实测坑**：RLS 的 RESTRICTIVE 策略**只做 AND、不能单独授予访问** —— 只有 RESTRICTIVE
> 时默认拒绝（INSERT 全撞策略 / SELECT 0 行）。每张注册表必须另配一条 PERMISSIVE 基线
> （`p_data_scope_access`）显式授予全表访问，真正的天花板再由 RESTRICTIVE
> （`p_data_scope_ceiling`）收窄。

### 2.1 前置三件套（缺一不做 RLS）
1. **请求级事务**：读路径全量进事务——`WalnutTxInterceptor` 扩展「无 @WalnutTx 时
   自动开启只读事务」或强制所有注册实体端点挂 @WalnutTx（二选一，实施时按连接占用实测定；
   已由批 6 spike 实测，结论见 `data-scope-remediation-plan.md` §4.2）；
   同步删除 `getManager` 的池级回退（事务内 set_config 才有效）
2. **专用角色**：`walnut_app`（NOSUPERUSER NOBYPASSRLS 非表 owner），迁移把表 owner
   转移或 GRANT 精确权限；TypeORM 连接串切 walnut_app
3. **测试基建**：集成测试连接切 walnut_app（RLS 生效形态下跑，杜绝「postgres 全过」假阳性）

### 2.2 策略（RESTRICTIVE 天花板 + STABLE 函数）
```sql
CREATE FUNCTION app.current_data_scope_dept_ids() RETURNS uuid[]
  LANGUAGE sql STABLE AS
  $$ SELECT current_setting('app.data_scope.dept_ids', true)::uuid[] $$;

ALTER TABLE app_demo ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_demo FORCE ROW LEVEL SECURITY;

CREATE POLICY dept_ceiling ON app_demo
  AS RESTRICTIVE TO walnut_app
  USING (dept_id = ANY(app.current_data_scope_dept_ids()))
  WITH CHECK (dept_id = ANY(app.current_data_scope_dept_ids()));
```
- 应用层 scope 继续算「可见明细」，RLS 只做**部门天花板**（多一层 DB 强制，
  即使应用层 bug 也不会越部门）；策略只建在注册表实体上，系统表不启用
- 事务内注入：tx.interceptor 在 startTransaction 后
  `set_config('app.data_scope.dept_ids', ..., true)`
- 导出：db:export:pg 角色加 BYPASSRLS 或会话 `SET row_security=off`（报错而非静默少行）

### 2.3 验收
- 集成测试以 walnut_app 连接全绿（RLS 生效形态）
- 专项：跨部门直连 SQL 读写 → 0 行/WITH CHECK 报错
- 导出走 BYPASSRLS 通道且行数完整

## 3. 批次与提交规划

| 批 | 内容 | 提交 |
|---|---|---|
| 批 1 | 迁移 + 解析器扩展 + 单测 | feat(server) |
| 批 2 | demo dept 列 + admin + 测试矩阵（M1-M10） | feat(server)(admin) |
| 批 3 | RLS 三件套 + 策略 + 专项回归 | feat(server) |
| 收尾 | roadmap/模块文档/openapi 同步 + 终验 | docs/chore |

## 4. 风险与回滚

| 风险 | 缓解 |
|---|---|
| 既有 449+ 用例受 scope 影响 | 只适配 fixture 不削断言；豁免清单显式化 |
| dept 回填依赖 employee 行（无 employee 的创建者） | NULL dept 行仅 root/SELF 可见，语义写进文档 |
| RLS 改变连接/事务模型 | 批 3 独立分支先行 spike，实测连接占用后再合入 |
| 缓存失效遗漏 | 失效点清单 + 单测（沿用 AUTH:PERMISSIONS 纪律） |

## 5. 待确认（已按推荐执行，除非维护者否决）

1. demo 行部门归属采用方案 A（冗余列）
2. data_scope 枚举扩展 4/6 档（吸收 RuoYi-Vue-Plus 的 DEPT_AND_CHILD_OR_SELF）
3. 三期 RLS 采用「自动只读事务」兜底方案实施前先 spike 实测连接占用
4. admin 前端页面（角色部门树/用户部门选择/demo 页面）随批 2 接口同步做
