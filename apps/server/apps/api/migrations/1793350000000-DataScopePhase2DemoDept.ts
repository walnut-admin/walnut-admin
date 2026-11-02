// type-only：typeorm 是 CJS 包，本文件经 Node 原生类型剥离按 ESM 加载，具名值导入
// 无法静态解析（cjs-module-lexer 认不出 tslib 星转载出的名字）；类型导入剥离后零运行时依赖。
import type { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * 数据权限二期批 2 —— `app_demo.dept_id`（示范表的行级部门归属）。
 *
 * 结构真源：`apps/docs/src/zh-CN/content/plans/data-scope-phase2-3-plan.md` §1.2 方案 A（冗余列，推荐）：
 * demo 是示范表，索引友好优先 —— 谓词 `dept_id = ANY(deptIds)` 单跳、可直接吃
 * `idx_demo_dept`；方案 B（EXISTS 链 `sys_employee.user_id = demo.created_by`）两跳且
 * 依赖创建者仍有职工行，只保留为「无冗余列表」的通用回退（注册表 `matchBy` 预留位）。
 *
 * 列口径：
 * - **可空**：历史行 / 创建者没有职工行（因此没有部门）时 dept_id 为 NULL ——
 *   「无部门归属行」只有 ALL 档位可见；SELF 仍可按 owner 看到自己创建的行
 *   （DEPT_OR_SELF 的部门腿不会包含它们）。语义写进 security.md 与注册表 note。
 * - **FK RESTRICT**：有 demo 行的部门不许删（与 sys_employee.dept_id 同口径；部门删除
 *   前的应用层校验 + FK 是最后防线）。
 * - 回填在**基类 create**（common/repository/pg-base.repository.ts）：创建者
 *   `sys_employee.dept_id`（无职工行 → NULL）。与一期 owner 回填同一位置，
 *   注册表项用 `fillDeptOnCreate: true` 显式开启。
 *
 * 索引：`idx_demo_dept` 用 partial（`WHERE dept_id IS NOT NULL`）—— 与
 * `idx_demo_created_by` 同款；无部门行（多数历史行）不进索引。实体装饰器同形，
 * 防未来 generate 漂移。
 */
export const DATA_SCOPE_PHASE2_DEMO_DEPT_UP: string[] = [
  `ALTER TABLE app_demo
    ADD COLUMN dept_id uuid NULL,
    ADD CONSTRAINT fk_demo_dept FOREIGN KEY (dept_id) REFERENCES sys_dept (id) ON DELETE RESTRICT`,
  'CREATE INDEX idx_demo_dept ON app_demo (dept_id) WHERE "dept_id" IS NOT NULL',
  `COMMENT ON COLUMN app_demo.dept_id IS '所属部门（数据权限部门系档位的行级归属；create 回填创建者 sys_employee.dept_id，无职工行为 NULL = 仅 ALL 可见）'`,
]

export const DATA_SCOPE_PHASE2_DEMO_DEPT_DOWN: string[] = [
  'DROP INDEX IF EXISTS idx_demo_dept',
  'ALTER TABLE app_demo DROP CONSTRAINT IF EXISTS fk_demo_dept',
  'ALTER TABLE app_demo DROP COLUMN IF EXISTS dept_id',
]

export class DataScopePhase2DemoDept1793350000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const sql of DATA_SCOPE_PHASE2_DEMO_DEPT_UP) {
      await queryRunner.query(sql)
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const sql of DATA_SCOPE_PHASE2_DEMO_DEPT_DOWN) {
      await queryRunner.query(sql)
    }
  }
}
