import type { ValueOf } from 'easy-fns-ts'

/**
 * 角色数据权限档位（`sys_role.data_scope` smallint）。
 *
 * 与 `docs/plans/data-scope-design.md` §4 的三档对齐（部门维度二期再扩）：
 * - ALL    = 1：全量（root 恒 ALL；显式授予也可）；不注入任何行级谓词
 * - SELF   = 2：仅本人（注册表实体的 owner 列 = 当前用户）
 * - CUSTOM = 3：自定义用户集（一期从 `sys_user_role` 取角色成员，二期接部门维度）
 *
 * DDL 的 CHECK 必须与这里的值集一致（migration 的
 * `CONSTRAINT ck_role_data_scope CHECK (data_scope IN (1, 2, 3))`）；
 * 数字值而不是字符串，是为了对齐 RuoYi 语义且避免 `varchar + CHECK` 的额外枚举面。
 */
export const WalnutAdminConstDataScope = {
  ALL: 1,
  SELF: 2,
  CUSTOM: 3,
} as const

export type IWalnutAdminConstDataScope = ValueOf<typeof WalnutAdminConstDataScope>

/**
 * 解析后的运行时模式串（描述符 `mode` 的取值）。与数字档位一一对应：
 * `toWalnutDataScopeMode` 负责映射（common/repository/data-scope.ts）。
 */
export const WalnutAdminConstDataScopeMode = {
  ALL: 'ALL',
  SELF: 'SELF',
  CUSTOM: 'CUSTOM',
} as const

export type IWalnutAdminConstDataScopeMode = ValueOf<typeof WalnutAdminConstDataScopeMode>
