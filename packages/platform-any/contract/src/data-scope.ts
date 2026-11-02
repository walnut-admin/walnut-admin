/**
 * Role data-scope tiers — shared between frontend and backend.
 *
 * `sys_role.data_scope` 是 smallint；六档数值是**前后端 + DDL CHECK 的同一份契约**，
 * 任何增删改都要求同步迁移的 `CHECK (data_scope IN (...))`：
 * - ALL            = 1：全量（root 恒 ALL；显式授予也可）；不注入任何行级谓词
 * - CUSTOM         = 2：自定义部门清单（`sys_role_dept` 的 dept_id 集合，**不递归子树**）
 * - DEPT           = 3：本部门（`sys_user.dept_id`）
 * - DEPT_AND_CHILD = 4：本部门及以下（递归 CTE 取 dept 子树，**含自身**）
 * - SELF           = 5：仅本人（注册表实体的 owner 列 = 当前用户）
 * - DEPT_OR_SELF   = 6：本部门及以下 + 本人（部门子树与 SELF 的并集）
 *
 * 两个最容易误解的语义点：
 * - CUSTOM 只认显式勾选的那几个部门，**不向下展开**（要子树请用 DEPT_AND_CHILD）；
 * - DEPT_AND_CHILD 的子树**包含用户所在部门自身**，不是「仅下级」。
 *
 * 数值用 number 而不是字符串：对齐 RuoYi 的五档语义（第 6 档 DEPT_OR_SELF 吸收自
 * RuoYi-Vue-Plus 的增强）、避免 varchar + CHECK 的额外枚举面。
 */

import type { ValueOf } from 'easy-fns-ts'

export const DataScope = {
  ALL: 1,
  CUSTOM: 2,
  DEPT: 3,
  DEPT_AND_CHILD: 4,
  SELF: 5,
  DEPT_OR_SELF: 6,
} as const

/** 档位键名联合：'ALL' | 'CUSTOM' | 'DEPT' | 'DEPT_AND_CHILD' | 'SELF' | 'DEPT_OR_SELF' */
export type DataScopeKey = keyof typeof DataScope

/** 档位数值联合：1 | 2 | 3 | 4 | 5 | 6 */
export type DataScopeType = ValueOf<typeof DataScope>
