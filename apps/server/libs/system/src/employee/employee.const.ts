import type { ValueOf } from 'easy-fns-ts'

/**
 * 职工状态（varchar + CHECK，取值真源）：
 * - probation 试用期 / active 在职 / resigned 离职。
 *
 * 语义边界：状态是**人事事实**，不驱动账号生命周期 —— 离职（resigned）不删除、不自动
 * 解绑 sys_user 账号（账号侧禁用/删除走自己的通道），见 employee.entity 头注释。
 */
export const SysEmployeeStatusConst = {
  PROBATION: 'probation',
  ACTIVE: 'active',
  RESIGNED: 'resigned',
} as const

export type ISysEmployeeStatus = ValueOf<typeof SysEmployeeStatusConst>
