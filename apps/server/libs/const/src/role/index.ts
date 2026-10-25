import type { ValueOf } from 'easy-fns-ts'

// Role enum — now imported directly from @walnut/contract by consumers
// This file retains only server-local role constants (mode, IDs) not shared via contract

export const WalnutAdminConstRoleMode = {
  SWITCH: 'switchable',
  COMBINE: 'combinable',
} as const

export type IWalnutAdminConstRoleMode = ValueOf<
  typeof WalnutAdminConstRoleMode
>

export const WalnutAdminConstRoleRootId = '68635668a1f084bfd66da715'
export const WalnutAdminConstRoleDeveloperId = '6863567ba1f084bfd66da71b'

// B7a 起 id 进入 uuid 世界：同一批 safe role/user 的 PG 侧主键是 ETL 派生的 v5 uuid
// （namespace 与派生规则见 packages/tooling/scripts/src/db/uuid5.ts，hex → uuid 一一对应）。
// 常量双形态并存 —— user.crud 的 safe 拦截在 7c 归一前的双引擎窗口两边都拦得住，
// B10 清理时随 Mongo 侧一起摘 hex。
const WalnutAdminConstSafeRoleUuidIds = ['3055c85c-8f55-53c9-8c7a-366fef0a8183', 'eeb5619e-48ef-52a9-860a-c3d90dc5b97c'] as const
const WalnutAdminConstSafeUserUuidIds = ['7323c6ec-322f-588d-bb6a-81a768912c35', 'fb053bc0-db73-559f-b01e-6d2f51b1d242'] as const

// root/developer role/user id（hex + v5 uuid 双形态）
export const WalnutAdminConstSafeUserId = [...WalnutAdminConstSafeUserUuidIds, '68635bd771f9cd6b4fa8f1f9', '686363c61dbc81480db356e3']
export const WalnutAdminConstSafeRoleId = [...WalnutAdminConstSafeRoleUuidIds, WalnutAdminConstRoleRootId, WalnutAdminConstRoleDeveloperId]
