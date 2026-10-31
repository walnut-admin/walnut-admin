import type { ValueOf } from 'easy-fns-ts'

/**
 * 部门状态（varchar + CHECK，取值真源）。
 * migration `ck_dept_status` / DTO 的 IsEnum 元数据都以此为源（新增枚举值先改这里）。
 */
export const SysDeptStatusConst = {
  ENABLED: 'enabled',
  DISABLED: 'disabled',
} as const

export type ISysDeptStatus = ValueOf<typeof SysDeptStatusConst>
