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

// Phase 5a（B10 挂单收口）：safe id 常量收敛为 **uuid 单形态** —— PG 主键即 ETL 派生的
// v5 uuid（namespace 与派生规则见 packages/tooling/scripts/src/db/uuid5.ts），
// Mongo hex 形态随 MongoDB 摘除一并退役（同一批 safe role/user 的 uuid 值与派生结果一致）。
const WalnutAdminConstSafeRoleUuidIds = ['3055c85c-8f55-53c9-8c7a-366fef0a8183', 'eeb5619e-48ef-52a9-860a-c3d90dc5b97c'] as const
const WalnutAdminConstSafeUserUuidIds = ['7323c6ec-322f-588d-bb6a-81a768912c35', 'fb053bc0-db73-559f-b01e-6d2f51b1d242'] as const

// root/developer role/user id（uuid）
export const WalnutAdminConstSafeUserId: string[] = [...WalnutAdminConstSafeUserUuidIds]
export const WalnutAdminConstSafeRoleId: string[] = [...WalnutAdminConstSafeRoleUuidIds]
