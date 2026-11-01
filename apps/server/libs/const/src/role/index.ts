// Role enum — now imported directly from @walnut/contract by consumers
// Role mode 的 wire 值集已上收 @walnut/contract/role；本文件只保留 server-only 的 safe id 常量

export {
  type RoleModeType as IWalnutAdminConstRoleMode,
  RoleMode as WalnutAdminConstRoleMode,
} from '@walnut/contract/role'

// Phase 5a（B10 挂单收口）：safe id 常量收敛为 **uuid 单形态** —— PG 主键即 ETL 派生的
// v5 uuid（namespace 与派生规则见 packages/tooling/scripts/src/db/uuid5.ts），
// Mongo hex 形态随 MongoDB 摘除一并退役（同一批 safe role/user 的 uuid 值与派生结果一致）。
const WalnutAdminConstSafeRoleUuidIds = ['3055c85c-8f55-53c9-8c7a-366fef0a8183', 'eeb5619e-48ef-52a9-860a-c3d90dc5b97c'] as const
const WalnutAdminConstSafeUserUuidIds = ['7323c6ec-322f-588d-bb6a-81a768912c35', 'fb053bc0-db73-559f-b01e-6d2f51b1d242'] as const

// root/developer role/user id（uuid）
export const WalnutAdminConstSafeUserId: string[] = [...WalnutAdminConstSafeUserUuidIds]
export const WalnutAdminConstSafeRoleId: string[] = [...WalnutAdminConstSafeRoleUuidIds]
