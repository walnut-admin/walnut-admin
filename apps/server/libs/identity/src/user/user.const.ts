/**
 * User Module Constants
 * （自 schema/user.schema.ts 搬出：schema 只留 DTO 元数据类，业务常量归 const 文件；
 * gender 枚举按 GB 标准定义，admin 侧未消费，故留在 server 模块内）
 */

import type { ValueOf } from 'easy-fns-ts'

export const SysUserGenderConst = {
  UNKNOWN: 0,
  MALE: 1,
  FEMALE: 2,
  UNDESCRIBED: 9,
} as const

export type SysUserGenderConstType = ValueOf<typeof SysUserGenderConst>
