// type-only：typeorm 是 CJS 包，本文件经 Node 原生类型剥离按 ESM 加载，具名值导入
// 无法静态解析（cjs-module-lexer 认不出 tslib 星转载出的名字）；类型导入剥离后零运行时依赖。
import type { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * 数据权限一期 —— `sys_role.data_scope` + `app_demo.created_by`。
 *
 * 结构真源：`apps/docs/src/zh-CN/content/plans/data-scope-design.md` §4（一期推荐方案）与 §5（改动面）。
 * 三档枚举与 `libs/const/src/app/dataScope.ts` 的 `WalnutAdminConstDataScope` 同源：
 * 1 = ALL / 2 = SELF / 3 = CUSTOM。DDL 用 `smallint + CHECK`（不做 PG 原生 ENUM：
 * 值集变更要走 ALTER TYPE，phase2 2.2 已定）。CHECK 的文本形态与
 * `common/dto/dto-entity.drift.spec.ts` 的枚举三方守卫解析格式对齐
 * （`CONSTRAINT ck_<table>_<col> CHECK (<col> IN (...))`），后续把守卫扫描面扩到
 * 全部 migration 时不会被判成形状漂移。
 *
 * 回填口径（两类角色与默认值不同）：
 * - root：1（ALL，root 恒全量；显式回填而不是只依赖 DEFAULT，便于审计时一眼看出）；
 * - visitor：2（SELF）—— permission.guard 对 visitor 放行**所有** `:list` / `:read`
 *   权限串，若 visitor 落到默认 ALL，注册表里的业务表（sys_user / sys_log_* 等）
 *   会对游客变成全量可读；游客账号本身没有业务行，SELF 等价于「看不到任何他人数据」。
 *   这条回填同时写进 `db/seed/sys_role.json`（新装环境由 seed 带出同值）。
 * - 其余角色走列默认 1（保持既有行为：数据权限上线不缩小任何现有角色的可见面）。
 *
 * app_demo.created_by 是数据权限的**示范 owner 列**（demo 是模板示范表）：
 * 可空（历史行没有创建者）、松引用（不建 FK，对齐 phase2 的审计列口径），
 * 部分索引服务 SELF/CUSTOM 的 `created_by = / IN` 过滤。
 */
export const DATA_SCOPE_PHASE1_UP: string[] = [
  // ============================================================
  // 1. sys_role.data_scope（1 ALL / 2 SELF / 3 CUSTOM）
  // ============================================================
  `ALTER TABLE sys_role
    ADD COLUMN data_scope smallint NOT NULL DEFAULT 1,
    ADD CONSTRAINT ck_role_data_scope CHECK (data_scope IN (1, 2, 3))`,
  `COMMENT ON COLUMN sys_role.data_scope IS '数据权限档位：1=ALL 2=SELF 3=CUSTOM（data-scope-design.md §4）'`,
  // root 恒 ALL（显式回填，语义自证）
  `UPDATE sys_role SET data_scope = 1 WHERE role_name = 'root'`,
  // visitor 仅本人（见文件头：permission.guard 对 visitor 放行所有 list/read）
  `UPDATE sys_role SET data_scope = 2 WHERE role_name = 'visitor'`,

  // ============================================================
  // 2. app_demo.created_by（示范 owner 列，基类 create 自动填充）
  // ============================================================
  `ALTER TABLE app_demo ADD COLUMN created_by uuid NULL`,
  `CREATE INDEX idx_demo_created_by ON app_demo (created_by) WHERE "created_by" IS NOT NULL`,
  `COMMENT ON COLUMN app_demo.created_by IS '创建者（数据权限 owner 列；松引用 sys_user.id，不建 FK）'`,
]

export const DATA_SCOPE_PHASE1_DOWN: string[] = [
  'DROP INDEX IF EXISTS idx_demo_created_by',
  'ALTER TABLE app_demo DROP COLUMN IF EXISTS created_by',
  `ALTER TABLE sys_role
    DROP CONSTRAINT IF EXISTS ck_role_data_scope,
    DROP COLUMN IF EXISTS data_scope`,
]

export class DataScopePhase11793336000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const sql of DATA_SCOPE_PHASE1_UP) {
      await queryRunner.query(sql)
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const sql of DATA_SCOPE_PHASE1_DOWN) {
      await queryRunner.query(sql)
    }
  }
}
