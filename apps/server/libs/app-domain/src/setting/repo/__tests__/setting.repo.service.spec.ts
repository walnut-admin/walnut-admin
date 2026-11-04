import { describe, expect, it } from 'vitest'
import { AppSettingRepositoryService } from '../setting.repo.service'

/**
 * 批 4 / L2（P3-36）+ S1：`updateAppSettingByKey` 也是设置写通道（ip.service 等消费）。
 * 写的是 `app.functional.role` 时必须 bump 数据权限 epoch；其他 key 不 bump；
 * 目标行不存在（静默无操作）时没有真实写入，不 bump。
 */

function createService(docExists: boolean) {
  const saved: unknown[] = []
  const repository = {
    find: async () => [],
    findOne: async () => docExists
      ? { settingKey: 'app.functional.role', settingValue: '{}' }
      : null,
    save: async (doc: unknown) => {
      saved.push(doc)
      return doc
    },
  }

  const calls: string[] = []
  const dataSource = { manager: { getRepository: () => repository } } as never
  const cacheAppSettings = {
    setAppSettings: async () => {
      calls.push('extract')
    },
  } as never
  const dataScope = {
    bumpEpoch: async () => {
      calls.push('bump')
    },
  } as never

  return {
    service: new AppSettingRepositoryService(dataSource, cacheAppSettings, dataScope),
    calls,
    saved,
  }
}

describe('updateAppSettingByKey → 数据权限 epoch', () => {
  it('写 app.functional.role：重提取缓存后 bump', async () => {
    const ctx = createService(true)

    await ctx.service.updateAppSettingByKey('app.functional.role', '{"scope":"global"}')

    expect(ctx.calls).toEqual(['extract', 'bump'])
    expect(ctx.saved).toHaveLength(1)
  })

  it('写其他 key：只重提取，不 bump', async () => {
    const ctx = createService(true)

    await ctx.service.updateAppSettingByKey('app.global.ipBlackList', '[]')

    expect(ctx.calls).toEqual(['extract'])
  })

  it('目标 key 不存在（静默无操作）：不 bump', async () => {
    const ctx = createService(false)

    await ctx.service.updateAppSettingByKey('app.functional.role', '{}')

    expect(ctx.calls).toEqual(['extract'])
    expect(ctx.saved).toHaveLength(0)
  })
})
