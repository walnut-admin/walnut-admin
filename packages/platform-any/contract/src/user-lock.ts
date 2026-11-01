/**
 * User lock module constants — shared between frontend and backend.
 */

import type { ValueOf } from 'easy-fns-ts'

export const LockModeConst = {
  DEFAULT: 'default',
  IDLE: 'idle',
  SECURITY: 'security',
} as const

export type ILockModeConst = ValueOf<typeof LockModeConst>
