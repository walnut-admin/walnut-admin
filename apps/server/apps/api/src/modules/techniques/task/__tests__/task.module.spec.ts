import { describe, expect, it } from 'vitest'
import { isBootstrapTasksDisabled } from '../bootstrap-task.module'

function makeEnv(value?: string): NodeJS.ProcessEnv {
  return { WALNUT_ADMIN_BOOTSTRAP_TASKS: value } as unknown as NodeJS.ProcessEnv
}

describe('isBootstrapTasksDisabled', () => {
  it('未设 env 时为 false（默认仍跑 6 个 bootstrap 任务）', () => {
    expect(isBootstrapTasksDisabled(makeEnv())).toBe(false)
  })

  it('值为 off 时为 true', () => {
    expect(isBootstrapTasksDisabled(makeEnv('off'))).toBe(true)
  })

  it('其它取值不关闭（开关只认字面量 off）', () => {
    expect(isBootstrapTasksDisabled(makeEnv('on'))).toBe(false)
  })
})
