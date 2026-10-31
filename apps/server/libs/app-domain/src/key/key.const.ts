/**
 * App Key Module Constants
 * （自 schema/key.schema.ts 搬出：schema 只留 DTO 元数据类，业务常量归 const 文件）
 */

import type { ValueOf } from 'easy-fns-ts'

export const AppKeyTypeConst = {
  RSA_PAIR: 'RSA_PAIR',
  AES_KEY_URL: 'AES_KEY_URL',
  JWT_AT: 'JWT_AT',
  JWT_RT: 'JWT_RT',
} as const

export type AppKeyTypeConstType = ValueOf<typeof AppKeyTypeConst>

export const AppKeyStatusConst = {
  ACTIVE: 'ACTIVE',
  DEPRECATED: 'DEPRECATED',
  DISABLED: 'DISABLED',
} as const

export type AppKeyStatusConstType = ValueOf<typeof AppKeyStatusConst>
