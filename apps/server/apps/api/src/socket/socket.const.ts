// Re-exported from @walnut/contract — single source of truth
export { WalnutAdminSocketEvents, WalnutAdminSocketRooms } from '@walnut/contract/socket'
// 值与类型同源导出：socket.d.ts 从这里取 IWalnutAdminSocketEventDataMap（skipLibCheck=true 曾掩盖 TS2724）
export type { IWalnutAdminSocketEventDataMap, IWalnutAdminSocketEvents } from '@walnut/contract/socket'

/**
 * socket.io 命名空间（原 socket.gateway.ts 顶部硬编码 + TODO「extract to config」的外提落点）。
 * 注意：namespace 是 socket.io 内部路由（不是 URL path），与 nginx 的 /socket/ 反代和
 * SOCKET_SERVER_PATH（/walnut-path/）互不相干。如需进一步 env 化，要同步 socket.config +
 * env validation + env 模板三处（超出本次 F-01 授权，先以常量单一真源落地）。
 */
export const WalnutAdminSocketNamespace = 'walnut-namespace'
