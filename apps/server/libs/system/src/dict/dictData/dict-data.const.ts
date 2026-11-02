/**
 * Dict Data Module Constants
 * （自 schema/dictData.schema.ts 搬出：schema 只留 DTO 元数据类，业务常量归 const 文件）
 */

import type { ValueOf } from 'easy-fns-ts'

export const SysDictDataTagTypeConst = {
  PRIMARY: 'primary',
  INFO: 'info',
  SUCCESS: 'success',
  WARNING: 'warning',
  ERROR: 'error',
} as const

export type SysDictDataTagTypeConstType = ValueOf<typeof SysDictDataTagTypeConst>
