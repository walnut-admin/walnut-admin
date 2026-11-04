import { beforeEach, describe, expect, it } from 'vitest'
import { AppSettingService } from '../setting.service'

/**
 * 批 4 / L2（P3-36）+ S1：`app.functional.role` 写通道的 epoch bump 判定。
 *
 * 覆盖：非 functional.role 不 bump；写入该键 bump；**改名离开**（before 命中、
 * after 不命中）也必须 bump —— 只看新 key 会漏掉 effective roleMode 回落到默认值的
 * 场景。bump 必须发生在 APP:SETTING 重提取之后（新世代首次计算要读到新设置）。
 */

interface FakeSettingRow {
  id: string
  settingKey: string
  settingValue: string
  settingType: string
  settingName?: string
}

class FakeSettingBasicRepo {
  readonly rows = new Map<string, FakeSettingRow>()
  private seq = 0

  async create(dto: Partial<FakeSettingRow>) {
    const row: FakeSettingRow = {
      id: `setting-${++this.seq}`,
      settingKey: dto.settingKey!,
      settingValue: dto.settingValue!,
      settingType: dto.settingType!,
      settingName: dto.settingName,
    }
    this.rows.set(row.id, row)
    return { ...row }
  }

  async readById(id: string) {
    const row = this.rows.get(id)
    if (row === undefined) {
      throw new Error(`setting ${id} not found`)
    }
    return { ...row }
  }

  async update(id: string, dto: Partial<FakeSettingRow>) {
    const row = this.rows.get(id)
    if (row === undefined) {
      throw new Error(`setting ${id} not found`)
    }
    Object.assign(row, dto)
    return { ...row }
  }
}

const FUNCTIONAL_ROLE = 'app.functional.role'

function createService(beforeKey: string) {
  const repo = new FakeSettingBasicRepo()
  repo.rows.set('existing', {
    id: 'existing',
    settingKey: beforeKey,
    settingValue: '{}',
    settingType: 'functional',
  })

  const calls: string[] = []
  const repoService = {
    extractAppSettingIntoCache: async () => {
      calls.push('extract')
      return 0
    },
  }
  const dataScope = {
    bumpEpoch: async () => {
      calls.push('bump')
    },
  }

  const service = new AppSettingService(
    repo as never,
    {} as never,
    repoService as never,
    dataScope as never,
  )

  return { service, calls }
}

function updatePayload(settingKey: string) {
  return {
    settingKey,
    settingName: 'x',
    settingValue: '{}',
    settingType: 'functional' as const,
  }
}

describe('setting 写通道 → 数据权限 epoch', () => {
  let ctx: ReturnType<typeof createService>

  beforeEach(() => {
    ctx = createService('app.other.setting')
  })

  it('非 functional.role：只重提取，不 bump', async () => {
    await ctx.service.create(updatePayload('app.other.setting'))

    expect(ctx.calls).toEqual(['extract'])
  })

  it('create functional.role：先重提取再 bump', async () => {
    await ctx.service.create(updatePayload(FUNCTIONAL_ROLE))

    expect(ctx.calls).toEqual(['extract', 'bump'])
  })

  it('update 同 key functional.role → bump', async () => {
    const functionalCtx = createService(FUNCTIONAL_ROLE)

    await functionalCtx.service.update('existing', updatePayload(FUNCTIONAL_ROLE))

    expect(functionalCtx.calls).toEqual(['extract', 'bump'])
  })

  it('update 改名离开 functional.role → 仍 bump（before 命中）', async () => {
    const functionalCtx = createService(FUNCTIONAL_ROLE)

    await functionalCtx.service.update('existing', updatePayload('app.other.setting'))

    expect(functionalCtx.calls).toEqual(['extract', 'bump'])
  })

  it('update 改名进入 functional.role → bump（after 命中）', async () => {
    await ctx.service.update('existing', updatePayload(FUNCTIONAL_ROLE))

    expect(ctx.calls).toEqual(['extract', 'bump'])
  })

  it('update 两个 key 都不命中 → 不 bump', async () => {
    await ctx.service.update('existing', updatePayload('app.other.setting.2'))

    expect(ctx.calls).toEqual(['extract'])
  })
})
