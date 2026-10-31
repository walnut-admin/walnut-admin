/**
 * User Lock Module Constants
 * （自 schema/user_lock.schema.ts 搬出：schema 只留 DTO 元数据类，业务常量归 const 文件）
 */

import type { ValueOf } from 'easy-fns-ts'

export const LockModeConst = {
  DEFAULT: 'default',
  IDLE: 'idle',
  SECURITY: 'security',
} as const

export type ILockModeConst = ValueOf<typeof LockModeConst>
