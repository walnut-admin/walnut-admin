export const WalnutAdminSocketEvents = {
  LOCK: 'lock:lock',
  UNLOCK: 'lock:unlock',
  FORCE_QUIT: 'force:quit',
} as const

export const WalnutAdminSocketRooms = {
  USER: (userId: string, visitorId: string) => `user:${userId}:${visitorId}` as const,
}

// Note: Type definitions have been moved to @walnut/types/walnut-admin/socket.d.ts
// - IWalnutAdminSocketEvents
// - IWalnutAdminSocketEventDataMap
// - IWalnutAdminSocketRoom
