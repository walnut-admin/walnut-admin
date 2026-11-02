/**
 * App Key Module Constants
 * （自 schema/key.schema.ts 搬出：schema 只留 DTO 元数据类，业务常量归 const 文件）
 *
 * AppKeyTypeConst 的 wire 值集已上收 @walnut/contract/crypto-wire（rsa lib 不能反向
 * import app-domain，且前端也按 URL 传同一组值）；本文件保留 server-only 的 status 常量。
 */

import type { ValueOf } from 'easy-fns-ts'

export { AppKeyTypeConst, type AppKeyTypeConstType } from '@walnut/contract/crypto-wire'

export const AppKeyStatusConst = {
  ACTIVE: 'ACTIVE',
  DEPRECATED: 'DEPRECATED',
  DISABLED: 'DISABLED',
} as const

export type AppKeyStatusConstType = ValueOf<typeof AppKeyStatusConst>
