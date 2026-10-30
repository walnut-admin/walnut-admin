import type { ValueOf } from 'easy-fns-ts'

/**
 * 角色数据权限档位（`sys_role.data_scope` smallint）。
 *
 * 六档语义（docs/plans/data-scope-phase2-3-plan.md §1.1；对齐 RuoYi 五档并吸收
 * RuoYi-Vue-Plus 的 `DEPT_AND_CHILD_OR_SELF`）：
 * - ALL            = 1：全量（root 恒 ALL；显式授予也可）；不注入任何行级谓词
 * - CUSTOM         = 2：自定义部门清单（`sys_role_dept` 的 dept_id 集合，不递归子树）
 * - DEPT           = 3：本部门（`sys_user.dept_id`）
 * - DEPT_AND_CHILD = 4：本部门及以下（递归 CTE 取 dept 子树，含自身）
 * - SELF           = 5：仅本人（注册表实体的 owner 列 = 当前用户）
 * - DEPT_OR_SELF   = 6：本部门及以下 + 本人（部门子树与 SELF 的并集）
 *
 * **一期 → 二期的语义演进（重要）**：一期三档是 1 ALL / 2 SELF / 3 CUSTOM（角色成员），
 * 二期把数值重排为上面的六档 —— 迁移 `1793340000000-DataScopePhase2Dept.ts` 按
 * 「旧 2 → 新 5、旧 3 → 新 2」重映射存量行。CUSTOM 的「角色成员 userIds」语义作废，
 * 统一改为部门维度（`sys_role_dept`）。
 *
 * DDL 的 CHECK 必须与这里的值集一致（migration 的
 * `CONSTRAINT ck_role_data_scope CHECK (data_scope IN (1, 2, 3, 4, 5, 6))`）；
 * 数字值而不是字符串，是为了对齐 RuoYi 语义且避免 `varchar + CHECK` 的额外枚举面。
 */
export const WalnutAdminConstDataScope = {
  ALL: 1,
  CUSTOM: 2,
  DEPT: 3,
  DEPT_AND_CHILD: 4,
  SELF: 5,
  DEPT_OR_SELF: 6,
} as const

export type IWalnutAdminConstDataScope = ValueOf<typeof WalnutAdminConstDataScope>

/**
 * 解析后的运行时模式串（描述符 `mode` 的取值）。与数字档位一一对应：
 * `toWalnutDataScopeMode` 负责映射（common/repository/data-scope.ts）。
 */
export const WalnutAdminConstDataScopeMode = {
  ALL: 'ALL',
  CUSTOM: 'CUSTOM',
  DEPT: 'DEPT',
  DEPT_AND_CHILD: 'DEPT_AND_CHILD',
  SELF: 'SELF',
  DEPT_OR_SELF: 'DEPT_OR_SELF',
} as const

export type IWalnutAdminConstDataScopeMode = ValueOf<typeof WalnutAdminConstDataScopeMode>
