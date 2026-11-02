/*
 * Socket contract — shared between frontend and backend.
 */

import type { ValueOf } from 'easy-fns-ts'
import type { IWalnutAdminConstAppSettingForceQuitStrategy } from './setting'

export const WalnutAdminSocketEvents = {
  LOCK: 'lock:lock',
  UNLOCK: 'lock:unlock',
  FORCE_QUIT: 'force:quit',
} as const

/** Type for socket event values: 'lock:lock' | 'lock:unlock' | 'force:quit' */
export type IWalnutAdminSocketEvents = ValueOf<typeof WalnutAdminSocketEvents>

export const WalnutAdminSocketRooms = {
  USER: (userId: string, visitorId: string) => `user:${userId}:${visitorId}` as const,
}

/** Server -> client socket event payload shapes */
export interface IWalnutAdminSocketEventDataMap {
  'lock:lock': object
  'lock:unlock': object
  'force:quit': {
    strategy: IWalnutAdminConstAppSettingForceQuitStrategy
  }
}
