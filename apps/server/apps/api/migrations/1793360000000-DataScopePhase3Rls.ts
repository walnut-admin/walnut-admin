// type-only：typeorm 是 CJS 包，本文件经 Node 原生类型剥离按 ESM 加载，具名值导入
// 无法静态解析（cjs-module-lexer 认不出 tslib 星转载出的名字）；类型导入剥离后零运行时依赖。
import type { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * 数据权限三期 —— PostgreSQL RLS RESTRICTIVE 硬上限（部门 + 本人天花板）。
 *
 * 结构真源：`apps/docs/src/zh-CN/content/plans/data-scope-phase2-3-plan.md` §2。三件事：
 *
 * ## 1. 专用角色 `walnut_app`
 * `NOSUPERUSER NOBYPASSRLS` 非表 owner —— RLS 只对「非 owner 且无 BYPASSRLS」的角色
 * 生效，运行时连接必须切到本角色（`DATABASE_PG_APP_USER/PASS`），迁移/管理通道保持
 * `DATABASE_PG_USER`（见 data-source.cli.ts 头注释与 pg.config.ts）。
 *
 * 密码只用于本地/集成库引导：`CREATE ROLE` 带一个开发默认密码；生产环境应在跑迁移
 * 前**预建**该角色（强密码）或迁移后立即 `ALTER ROLE ... PASSWORD` —— 已存在则本迁移
 * 的 DO 块跳过创建，不会覆盖生产密码。
 *
 * 权限按「DML 精确集合」授予（SELECT/INSERT/UPDATE/DELETE + 序列 USAGE/SELECT），
 * 不给 DDL（CREATE/ALTER/DROP）与 TRUNCATE；`ALTER DEFAULT PRIVILEGES` 让后续迁移
 * 新建的表自动继承同一组权限（前提：后续迁移仍由同一角色执行）。
 *
 * ## 2. `app` schema 的 STABLE 读取函数
 * 策略谓词不能每行调 `current_setting()`（每行一次函数调用，且优化器无法当常量），
 * 统一包成 STABLE SQL 函数 —— STABLE 在一条语句内只求值一次，`dept_id = ANY(...)`
 * 仍可走 `idx_demo_dept` 等索引。
 *
 * `app.data_scope_mode()` 的缺省值是 **`anonymous`（fail-closed）**：任何没有在事务里
 * 显式 `set_config` 的查询一律 0 行 / 写入拒绝。放行只有两条显式通道：
 * - 请求内：`all`（ALL/root）/ `scoped`（其余档位）/ `system`（登录链、在线监控心跳等
 *   无描述符但必须读写注册表的处理器，由 `@WalnutAdminDecoratorDataScopeSystemChannel()`
 *   标记）；
 * - 非请求通道：迁移 / `db:export:pg` / seed / 测试清理使用**管理角色**
 *   `DATABASE_PG_USER`（superuser 或 BYPASSRLS）—— RLS 对该角色天然不生效；
 *   运行时 `walnut_app` 的池级直连不再有任何“忘设置也放行”的兜底。
 *
 * 应用侧的系统读腿（repo service 的池级 manager，如登录按用户名查 sys_user、日志旁写、
 * 心跳记账）统一经 `withWalnutSystemManager` 开一个 **system 事务**（`libs/db` 的
 * `runInWalnutSystemTransaction`），把设置落在与查询同连接同事务上。
 *
 * ## 3. 七张注册表 ENABLE + FORCE ROW LEVEL SECURITY
 * 注册表 = `apps/api/src/common/repository/data-scope.ts` 的
 * `WALNUT_DATA_SCOPE_ENTITIES`：sys_user / sys_log_operate / sys_log_auth /
 * app_monitor_user / sys_deleted / app_demo / sys_employee。豁免清单（系统表、
 * 全局配置表、junction）**不启用** RLS。
 *
 * 策略形状（每表两条：一条 PERMISSIVE 基线 + 一条 RESTRICTIVE 天花板，TO walnut_app，FOR ALL）：
 * ```
 * allow_all() OR <owner 列> = user_id() [ OR <dept 列> = ANY(dept_ids()) ] [ OR owner IS NULL ]
 * ```
 * - owner 腿 = 应用层 SELF 语义；dept 腿 = DEPT / DEPT_AND_CHILD / CUSTOM 语义；
 *   两腿 OR = DEPT_OR_SELF / 多角色并集 —— **天花板不小于应用层明细**；
 * - 无 dept 列的注册表（日志 / 回收站）只有 owner 腿：部门系档位在应用层本来就是
 *   恒假，RLS 多放行 owner 行不改变最终可见集（应用层再收窄）；
 * - app_monitor_user 的 `user_id IS NULL` = 应用层 `allowAnonymous`（匿名访客行共享）；
 * - 无职工行的 NULL dept 行对非 ALL 用户不可见（`= ANY` 对 NULL 为 NULL → 假），
 *   与二期方案 A 的语义一致；
 * - **sys_user / sys_employee 的 WITH CHECK 与 USING 不同**（P2-2）：本人行只有在
 *   `dept_id` 未改变（等于 `app.data_scope_user_dept_id()`，即账号当前部门）时才允许
 *   写入 —— 部门腿仍放行部门管理员的正常改派，但 SELF/DEPT 用户不能把自家 dept_id
 *   改到天花板外，借下一次 DEPT 解析横向扩权。
 *
 * 为什么是 RESTRICTIVE：permissive 策略之间是 OR，任何一条宽策略都会放宽天花板；
 * RESTRICTIVE 之间是 AND，未来给某表加「宽松」策略也不会突破本天花板。
 * 但 PG 的 RESTRICTIVE **只做 AND、不能单独授予访问**（只有 RESTRICTIVE 时默认拒绝），
 * 所以每表另建一条 PERMISSIVE `USING (true) / WITH CHECK (true)` 基线，真正的天花板
 * 由 RESTRICTIVE 收窄 —— 这也是本次实测抓出的一个坑（首版只有 RESTRICTIVE 时
 * INSERT 全撞策略、SELECT 0 行）。
 *
 * 与应用层 scope 的关系：**冗余天花板**。应用层继续算「可见明细」（越权行 404 /
 * list 不出现），RLS 只保证「即使应用层查询构造有 bug（漏 WHERE、直连 em），
 * 也拿不到部门/本人之外的行」。
 *
 * 审计/导出通道：`pnpm db:export:pg` 应使用超级用户/BYPASSRLS 角色（或显式
 * `SET row_security = off`，PG 会对 owner 之外的角色报错而不是静默少行）。
 */
const ROLE = 'walnut_app'

/**
 * 引导密码：仅本地开发 / 集成测试库。生产预建角色时本迁移跳过 CREATE ROLE，
 * 不会覆盖生产密码（见上方说明）。
 */
const BOOTSTRAP_PASSWORD = 'walnut_app_dev_only'

const RLS_TABLES = [
  'sys_user',
  'sys_log_operate',
  'sys_log_auth',
  'app_monitor_user',
  'sys_deleted',
  'app_demo',
  'sys_employee',
] as const

/**
 * 每张表的策略谓词（owner 列 + 可选 dept 列 + allowAnonymous）。
 *
 * `using` 管「能看到哪些行」，`withCheck` 管「写出来的新行长什么样」——绝大多数表两者
 * 相同；sys_user / sys_employee 的 WITH CHECK 额外收窄（P2-2）：
 * 本人行只有在 **dept_id 未改变**（等于账号当前部门）时才允许写，防止 SELF/DEPT 用户
 * 把自家 dept_id 改成天花板外的部门，借下一次 DEPT 解析横向扩权。部门腿仍保留，
 * 让部门管理员能改本部门内的职工/账号。
 */
interface IWalnutDataScopePolicyExpression {
  using: string
  withCheck: string
}

const POLICY_EXPRESSIONS: Record<typeof RLS_TABLES[number], IWalnutDataScopePolicyExpression> = {
  // sys_user：SELF = 本人账号行（id 即 owner）；部门系档位按 dept_id
  sys_user: {
    using: 'app.data_scope_allow_all() OR id = app.data_scope_user_id() OR dept_id = ANY(app.data_scope_dept_ids())',
    // WITH CHECK：部门腿放行；本人行要求新 dept 与账号当前 dept 一致（防横向改部门）
    withCheck: 'app.data_scope_allow_all() OR dept_id = ANY(app.data_scope_dept_ids()) OR (id = app.data_scope_user_id() AND dept_id IS NOT DISTINCT FROM app.data_scope_user_dept_id())',
  },
  // 操作日志：按操作者过滤；无部门列（应用层部门系档位恒假）
  sys_log_operate: {
    using: 'app.data_scope_allow_all() OR user_id = app.data_scope_user_id()',
    withCheck: 'app.data_scope_allow_all() OR user_id = app.data_scope_user_id()',
  },
  // 登录日志：失败登录 user_id 为 NULL —— 仅 ALL/system 可见（审计面收敛）
  sys_log_auth: {
    using: 'app.data_scope_allow_all() OR user_id = app.data_scope_user_id()',
    withCheck: 'app.data_scope_allow_all() OR user_id = app.data_scope_user_id()',
  },
  // 在线监控：匿名访客行（user_id IS NULL）对浏览者共享（应用层 allowAnonymous）
  app_monitor_user: {
    using: 'app.data_scope_allow_all() OR user_id = app.data_scope_user_id() OR user_id IS NULL',
    withCheck: 'app.data_scope_allow_all() OR user_id = app.data_scope_user_id() OR user_id IS NULL',
  },
  // 回收站：按删除者过滤
  sys_deleted: {
    using: 'app.data_scope_allow_all() OR deleted_by = app.data_scope_user_id()',
    withCheck: 'app.data_scope_allow_all() OR deleted_by = app.data_scope_user_id()',
  },
  // 示范表：owner + 行级部门归属（二期方案 A）
  app_demo: {
    using: 'app.data_scope_allow_all() OR created_by = app.data_scope_user_id() OR dept_id = ANY(app.data_scope_dept_ids())',
    withCheck: 'app.data_scope_allow_all() OR created_by = app.data_scope_user_id() OR dept_id = ANY(app.data_scope_dept_ids())',
  },
  // 职工：绑定账号（owner）或所属部门
  sys_employee: {
    using: 'app.data_scope_allow_all() OR user_id = app.data_scope_user_id() OR dept_id = ANY(app.data_scope_dept_ids())',
    // WITH CHECK：部门腿放行；本人行要求新 dept 与账号当前 dept 一致（防横向改部门）
    withCheck: 'app.data_scope_allow_all() OR dept_id = ANY(app.data_scope_dept_ids()) OR (user_id = app.data_scope_user_id() AND dept_id IS NOT DISTINCT FROM app.data_scope_user_dept_id())',
  },
}

const UP_SQL: string[] = [
  // ============================================================
  // 0. schema app（函数容器；不对 PUBLIC 开放）
  // ============================================================
  'CREATE SCHEMA IF NOT EXISTS app',
  'REVOKE ALL ON SCHEMA app FROM PUBLIC',

  // ============================================================
  // 1. STABLE 读取函数（策略谓词的唯一 DB 侧入口）
  // ============================================================
  // 缺省 **anonymous（fail-closed）**：未显式 set_config 的连接一律 0 行 / 写入拒绝。
  // 系统读腿（登录链 / guard / 日志旁写 / 心跳 / 测试清理）必须显式进入 system 事务；
  // 迁移/导出/seed 走管理角色（DATABASE_PG_USER，superuser/BYPASSRLS）天然绕 RLS。
  `CREATE OR REPLACE FUNCTION app.data_scope_mode() RETURNS text
    LANGUAGE sql STABLE AS $$
      SELECT COALESCE(NULLIF(current_setting('app.data_scope.mode', true), ''), 'anonymous')
    $$`,
  `CREATE OR REPLACE FUNCTION app.data_scope_user_id() RETURNS uuid
    LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('app.data_scope.user_id', true), '')::uuid
    $$`,
  `CREATE OR REPLACE FUNCTION app.data_scope_dept_ids() RETURNS uuid[]
    LANGUAGE sql STABLE AS $$
      SELECT CASE
        WHEN current_setting('app.data_scope.dept_ids', true) IS NULL
          OR current_setting('app.data_scope.dept_ids', true) = '' THEN '{}'::uuid[]
        ELSE string_to_array(current_setting('app.data_scope.dept_ids', true), ',')::uuid[]
      END
    $$`,
  `CREATE OR REPLACE FUNCTION app.data_scope_user_dept_id() RETURNS uuid
    LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('app.data_scope.user_dept_id', true), '')::uuid
    $$`,
  `CREATE OR REPLACE FUNCTION app.data_scope_allow_all() RETURNS boolean
    LANGUAGE sql STABLE AS $$
      SELECT app.data_scope_mode() IN ('all', 'system')
    $$`,
  'REVOKE ALL ON FUNCTION app.data_scope_mode(), app.data_scope_user_id(), app.data_scope_dept_ids(), app.data_scope_user_dept_id(), app.data_scope_allow_all() FROM PUBLIC',

  // ============================================================
  // 2. 专用角色 + 权限（先建角色，后授权）
  // ============================================================
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${ROLE}') THEN
      CREATE ROLE ${ROLE} LOGIN PASSWORD '${BOOTSTRAP_PASSWORD}'
        NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
    END IF;
  END $$`,
  `DO $$ BEGIN
    EXECUTE format('GRANT CONNECT ON DATABASE %I TO ${ROLE}', current_database());
  END $$`,
  `GRANT USAGE ON SCHEMA public, app TO ${ROLE}`,
  // DML 精确集合：不给 DDL / TRUNCATE
  `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${ROLE}`,
  `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${ROLE}`,
  // 迁移账本不收进运行时权限面（ALL TABLES 会把它带上；运行时 migrationsRun=false）
  `REVOKE ALL PRIVILEGES ON TABLE migrations FROM ${ROLE}`,
  // 后续迁移新建的表/序列自动继承同一组权限（前提：后续迁移由同一角色执行）
  `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${ROLE}`,
  `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${ROLE}`,
  `GRANT EXECUTE ON FUNCTION app.data_scope_mode(), app.data_scope_user_id(), app.data_scope_dept_ids(), app.data_scope_user_dept_id(), app.data_scope_allow_all() TO ${ROLE}`,

  // ============================================================
  // 3. 七张注册表：ENABLE + FORCE + RESTRICTIVE 策略
  // ============================================================
  ...RLS_TABLES.map(table => `ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`),
  ...RLS_TABLES.map(table => `ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`),
  ...RLS_TABLES.flatMap(table => [
    // 基线 PERMISSIVE：PG 的规则是「RESTRICTIVE 只做 AND、不能单独授予访问」——
    // 只有 RESTRICTIVE 策略时默认拒绝（0 行 / INSERT 全撞策略）。这一条显式授予
    // 全表访问，真正的天花板由下面的 RESTRICTIVE 收窄。未来新增的宽策略（PERMISSIVE）
    // 也只能在「与天花板同时满足」时生效，不会把范围放大。
    `DROP POLICY IF EXISTS p_data_scope_access ON ${table}`,
    `CREATE POLICY p_data_scope_access ON ${table}
      AS PERMISSIVE
      FOR ALL
      TO ${ROLE}
      USING (true)
      WITH CHECK (true)`,
    `DROP POLICY IF EXISTS p_data_scope_ceiling ON ${table}`,
    `CREATE POLICY p_data_scope_ceiling ON ${table}
      AS RESTRICTIVE
      FOR ALL
      TO ${ROLE}
      USING (${POLICY_EXPRESSIONS[table].using})
      WITH CHECK (${POLICY_EXPRESSIONS[table].withCheck})`,
  ]),
]

const DOWN_SQL: string[] = [
  ...RLS_TABLES.flatMap(table => [
    `DROP POLICY IF EXISTS p_data_scope_ceiling ON ${table}`,
    `DROP POLICY IF EXISTS p_data_scope_access ON ${table}`,
    `ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY`,
  ]),

  // 函数与 schema
  'DROP FUNCTION IF EXISTS app.data_scope_allow_all()',
  'DROP FUNCTION IF EXISTS app.data_scope_user_dept_id()',
  'DROP FUNCTION IF EXISTS app.data_scope_dept_ids()',
  'DROP FUNCTION IF EXISTS app.data_scope_user_id()',
  'DROP FUNCTION IF EXISTS app.data_scope_mode()',
  'DROP SCHEMA IF EXISTS app',

  // 回收本库权限。**不 DROP ROLE**：角色是集群级对象，同一个 PG 实例上的其他库
  // （dev 库 / 集成库）可能仍持有它的授权或连接 —— `DROP ROLE` 会因跨库依赖失败，
  // 也会把「可逆性验证」变成环境耦合。角色生命周期由运维显式管理（幂等 CREATE）。
  `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM ${ROLE}`,
  `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE USAGE, SELECT ON SEQUENCES FROM ${ROLE}`,
  `REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM ${ROLE}`,
  `REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM ${ROLE}`,
]

export class DataScopePhase3Rls1793360000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const sql of UP_SQL) {
      await queryRunner.query(sql)
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const sql of DOWN_SQL) {
      await queryRunner.query(sql)
    }
  }
}
