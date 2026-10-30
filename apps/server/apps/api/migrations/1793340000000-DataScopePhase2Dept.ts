// type-only：typeorm 是 CJS 包，本文件经 Node 原生类型剥离按 ESM 加载，具名值导入
// 无法静态解析（cjs-module-lexer 认不出 tslib 星转载出的名字）；类型导入剥离后零运行时依赖。
import type { MigrationInterface, QueryRunner } from 'typeorm'

/**
 * 数据权限二期批 1 —— 部门维度地基：`sys_user.dept_id` + `sys_role_dept` +
 * `sys_role.data_scope` 六档扩展。
 *
 * 结构真源：`docs/plans/data-scope-phase2-3-plan.md` §1.1 与
 * `docs/plans/data-scope-design.md` §4（二期部门维度）。InitSchema 是历史基线，一字不动。
 *
 * ## 六档语义与存量行的重映射（本迁移最容易做错的一步）
 *
 * 一期：1 = ALL / 2 = SELF / 3 = CUSTOM（角色成员 userIds）。
 * 二期：1 ALL / 2 CUSTOM(部门清单) / 3 DEPT / 4 DEPT_AND_CHILD / 5 SELF / 6 DEPT_OR_SELF。
 *
 * 数值 2/3 的语义在一期→二期之间发生了「换位」，因此 up 在放宽 CHECK 前先重映射存量：
 * - 旧 2（SELF）→ 新 5（SELF）；
 * - 旧 3（CUSTOM 角色成员）→ 新 2（CUSTOM 部门清单）—— 清单为空，默认拒绝；
 *   一期的「角色成员可见」语义按计划正式废除（admin 需在批 2 重新勾选部门）。
 * 顺序不能反：先 2→5 再 3→2，否则刚迁过去的 SELF 会被第二次 UPDATE 误伤。
 *
 * down 对称反演：新 4/6（二期新增档位，一期无对应语义）回落 1（ALL），新 2→旧 3、
 * 新 5→旧 2，最后收窄 CHECK。up/down 都保持「值集中间态也合法」的顺序，避免 CHECK 拦更新。
 *
 * ## 其他结构
 * - `sys_user.dept_id`：可空（用户可不属于任何部门）+ FK RESTRICT（有用户的部门不许删，
 *   与 `sys_employee.dept_id` 同口径）。partial index 服务「按部门取用户」的失效反查腿。
 * - `sys_role_dept`：CUSTOM 档位的部门清单，复合 PK 去重；双 FK CASCADE 随主行生灭
 *   （与 sys_user_role / sys_role_menu 的 junction 形态一致）。
 */
export const DATA_SCOPE_PHASE2_DEPT_UP: string[] = [
  // ============================================================
  // 1. sys_user.dept_id（用户归属部门；DEPT / DEPT_AND_CHILD 的解析输入）
  // ============================================================
  `ALTER TABLE sys_user
    ADD COLUMN dept_id uuid NULL,
    ADD CONSTRAINT fk_user_dept FOREIGN KEY (dept_id) REFERENCES sys_dept (id) ON DELETE RESTRICT`,
  // partial index：无部门用户（多数账号在接入组织前）不进索引（对齐 idx_employee_post）
  'CREATE INDEX idx_user_dept ON sys_user (dept_id) WHERE "dept_id" IS NOT NULL',
  `COMMENT ON COLUMN sys_user.dept_id IS '所属部门（数据权限 DEPT 档位的解析输入；NULL = 无部门，DEPT 档位默认拒绝）'`,

  // ============================================================
  // 2. sys_role_dept（CUSTOM 档位的部门清单，junction）
  // ============================================================
  `CREATE TABLE sys_role_dept (
    role_id uuid NOT NULL,
    dept_id uuid NOT NULL,
    CONSTRAINT pk_sys_role_dept PRIMARY KEY (role_id, dept_id),
    CONSTRAINT fk_role_dept_role FOREIGN KEY (role_id) REFERENCES sys_role (id) ON DELETE CASCADE,
    CONSTRAINT fk_role_dept_dept FOREIGN KEY (dept_id) REFERENCES sys_dept (id) ON DELETE CASCADE
  )`,
  // FK 反查（部门删除 / 「哪些角色的自定义范围含此部门」）—— PG 的 FK 不自动建索引
  'CREATE INDEX idx_role_dept_dept ON sys_role_dept (dept_id)',

  // ============================================================
  // 3. sys_role.data_scope：三档 → 六档（含存量值重映射）
  // ============================================================
  'ALTER TABLE sys_role DROP CONSTRAINT IF EXISTS ck_role_data_scope',
  // 旧 SELF(2) → 新 SELF(5)；必须在前，否则下面的 3→2 会误伤
  'UPDATE sys_role SET data_scope = 5 WHERE data_scope = 2',
  // 旧 CUSTOM(3, 角色成员) → 新 CUSTOM(2, 部门清单；清单为空 = 默认拒绝)
  'UPDATE sys_role SET data_scope = 2 WHERE data_scope = 3',
  `ALTER TABLE sys_role
    ADD CONSTRAINT ck_role_data_scope CHECK (data_scope IN (1, 2, 3, 4, 5, 6))`,
  `COMMENT ON COLUMN sys_role.data_scope IS '数据权限档位：1=ALL 2=CUSTOM(部门清单) 3=DEPT 4=DEPT_AND_CHILD 5=SELF 6=DEPT_OR_SELF（data-scope-phase2-3-plan.md §1.1）'`,
]

export const DATA_SCOPE_PHASE2_DEPT_DOWN: string[] = [
  // 反演顺序同样关键：先把新 2 拆出去（→ 旧 3），再把新 5 落回旧 2
  'ALTER TABLE sys_role DROP CONSTRAINT IF EXISTS ck_role_data_scope',
  // 二期新增档位在一期没有等价语义：回落 ALL（不缩小可见面）
  'UPDATE sys_role SET data_scope = 1 WHERE data_scope IN (4, 6)',
  'UPDATE sys_role SET data_scope = 3 WHERE data_scope = 2',
  'UPDATE sys_role SET data_scope = 2 WHERE data_scope = 5',
  `ALTER TABLE sys_role
    ADD CONSTRAINT ck_role_data_scope CHECK (data_scope IN (1, 2, 3))`,
  `COMMENT ON COLUMN sys_role.data_scope IS '数据权限档位：1=ALL 2=SELF 3=CUSTOM（data-scope-design.md §4）'`,

  'DROP TABLE IF EXISTS sys_role_dept',

  'ALTER TABLE sys_user DROP CONSTRAINT IF EXISTS fk_user_dept',
  'DROP INDEX IF EXISTS idx_user_dept',
  'ALTER TABLE sys_user DROP COLUMN IF EXISTS dept_id',
]

export class DataScopePhase2Dept1793340000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const sql of DATA_SCOPE_PHASE2_DEPT_UP) {
      await queryRunner.query(sql)
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const sql of DATA_SCOPE_PHASE2_DEPT_DOWN) {
      await queryRunner.query(sql)
    }
  }
}
