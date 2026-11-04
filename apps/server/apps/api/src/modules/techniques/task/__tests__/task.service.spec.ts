import { AppKeyTypeConst } from '@walnut-server/app-domain'
import { describe, expect, it, vi } from 'vitest'
import { AppTechTasksService } from '../task.service'

/**
 * W2-A 修复批「单次执行」守卫（2026-11-01）。
 *
 * 原缺陷：`@Cron` 方法先 `runExclusive(..., () => this.xxx(false))` 跑一遍任务体，
 * 随后锁外继续裸跑任务体 —— 每个 tick 双跑。这里用 fake cronLock（执行回调一次）
 * 实例化服务，断言每个公开 cron 方法只经锁执行任务体**恰好一次**；bootstrap 的
 * `runBootstrapXxx` 无锁入口直接执行任务体且完全不经过 cronLock。
 */
function createHarness() {
  const appSettingRepo = { extractAppSettingIntoCache: vi.fn(async () => 3) }
  const localeSharedService = { extractLocaleMessagesIntoCacheForCronJob: vi.fn(async () => 7) }
  const authRefreshSharedService = { revokeExpiredRefreshTokenForCronJob: vi.fn(async () => [{ id: 'rt-1' }]) }
  const appKeyService = { rotateForCronJob: vi.fn(async () => undefined) }
  const sysUserDeviceSharedService = {
    // 拍板-5：残留行只标 stale（计数口径 deletedCount → staleCount）
    updateDeviceActiveStatusForCronJob: vi.fn(async () => ({ matchedCount: 1, modifiedCount: 1, staleCount: 0 })),
  }
  const appMonitorUserSharedService = {
    updateAuthStateForCronJob: vi.fn(async (revoked: { id: string }[]) => revoked),
  }
  const sysUserMfaSharedService = {
    updateMfaSetupStatusForCronJob: vi.fn(async () => ({ matchedCount: 1, modifiedCount: 1 })),
  }

  // fake 锁：正常路径执行回调一次并透传返回值；mockResolvedValue(undefined) 可模拟未抢到锁
  const runExclusive = vi.fn(async (_taskName: string, _ttlSeconds: number, fn: () => Promise<unknown>) => fn())

  const service = new AppTechTasksService(
    appSettingRepo as never,
    localeSharedService as never,
    authRefreshSharedService as never,
    appKeyService as never,
    sysUserDeviceSharedService as never,
    appMonitorUserSharedService as never,
    sysUserMfaSharedService as never,
    { runExclusive } as never,
  )

  return {
    service,
    runExclusive,
    appSettingRepo,
    localeSharedService,
    authRefreshSharedService,
    appKeyService,
    sysUserDeviceSharedService,
    appMonitorUserSharedService,
    sysUserMfaSharedService,
  }
}

describe('appTechTasksService：@Cron 入口单次执行', () => {
  it('extractAppSetting：经锁执行任务体恰好一次', async () => {
    const h = createHarness()

    await h.service.extractAppSetting()

    expect(h.runExclusive).toHaveBeenCalledTimes(1)
    expect(h.runExclusive).toHaveBeenCalledWith('extractAppSetting', 600, expect.any(Function))
    expect(h.appSettingRepo.extractAppSettingIntoCache).toHaveBeenCalledTimes(1)
  })

  it('extractSysLocaleMessages：经锁执行任务体恰好一次', async () => {
    const h = createHarness()

    await h.service.extractSysLocaleMessages()

    expect(h.runExclusive).toHaveBeenCalledTimes(1)
    expect(h.runExclusive).toHaveBeenCalledWith('extractSysLocaleMessages', 600, expect.any(Function))
    expect(h.localeSharedService.extractLocaleMessagesIntoCacheForCronJob).toHaveBeenCalledTimes(1)
  })

  it('deleteExpiredRefreshToken：经锁执行任务体恰好一次（TTL 900s）', async () => {
    const h = createHarness()

    await h.service.deleteExpiredRefreshToken()

    expect(h.runExclusive).toHaveBeenCalledTimes(1)
    expect(h.runExclusive).toHaveBeenCalledWith('deleteExpiredRefreshToken', 900, expect.any(Function))
    expect(h.authRefreshSharedService.revokeExpiredRefreshTokenForCronJob).toHaveBeenCalledTimes(1)
    expect(h.appMonitorUserSharedService.updateAuthStateForCronJob).toHaveBeenCalledTimes(1)
  })

  it('rotateAppKey：经锁执行任务体恰好一次（两种 key 各轮换一次，不是各两次）', async () => {
    const h = createHarness()

    await h.service.rotateAppKey()

    expect(h.runExclusive).toHaveBeenCalledTimes(1)
    expect(h.runExclusive).toHaveBeenCalledWith('rotateAppKey', 300, expect.any(Function))
    expect(h.appKeyService.rotateForCronJob).toHaveBeenCalledTimes(2)
    expect(h.appKeyService.rotateForCronJob).toHaveBeenNthCalledWith(1, AppKeyTypeConst.RSA_PAIR)
    expect(h.appKeyService.rotateForCronJob).toHaveBeenNthCalledWith(2, AppKeyTypeConst.AES_KEY_URL)
  })

  it('updateDeviceActiveStatus：经锁执行任务体恰好一次', async () => {
    const h = createHarness()

    await h.service.updateDeviceActiveStatus()

    expect(h.runExclusive).toHaveBeenCalledTimes(1)
    expect(h.runExclusive).toHaveBeenCalledWith('updateDeviceActiveStatus', 300, expect.any(Function))
    expect(h.sysUserDeviceSharedService.updateDeviceActiveStatusForCronJob).toHaveBeenCalledTimes(1)
  })

  it('updateMfaSetupStatus：经锁执行任务体恰好一次', async () => {
    const h = createHarness()

    await h.service.updateMfaSetupStatus()

    expect(h.runExclusive).toHaveBeenCalledTimes(1)
    expect(h.runExclusive).toHaveBeenCalledWith('updateMfaSetupStatus', 300, expect.any(Function))
    expect(h.sysUserMfaSharedService.updateMfaSetupStatusForCronJob).toHaveBeenCalledTimes(1)
  })

  it('未拿到锁：任务体完全不执行（锁外没有裸跑的第二遍）', async () => {
    const h = createHarness()
    // 模拟另一实例持锁：runExclusive 不再调用回调
    h.runExclusive.mockResolvedValue(undefined)

    await h.service.extractAppSetting()
    await h.service.rotateAppKey()

    expect(h.appSettingRepo.extractAppSettingIntoCache).not.toHaveBeenCalled()
    expect(h.appKeyService.rotateForCronJob).not.toHaveBeenCalled()
  })
})

describe('appTechTasksService：bootstrap 无锁入口', () => {
  it('六个 runBootstrap* 直接执行任务体一次，完全不经过 cronLock', async () => {
    const h = createHarness()

    await h.service.runBootstrapExtractAppSetting()
    await h.service.runBootstrapExtractSysLocaleMessages()
    await h.service.runBootstrapDeleteExpiredRefreshToken()
    await h.service.runBootstrapRotateAppKey()
    await h.service.runBootstrapUpdateDeviceActiveStatus()
    await h.service.runBootstrapUpdateMfaSetupStatus()

    expect(h.runExclusive).not.toHaveBeenCalled()

    expect(h.appSettingRepo.extractAppSettingIntoCache).toHaveBeenCalledTimes(1)
    expect(h.localeSharedService.extractLocaleMessagesIntoCacheForCronJob).toHaveBeenCalledTimes(1)
    expect(h.authRefreshSharedService.revokeExpiredRefreshTokenForCronJob).toHaveBeenCalledTimes(1)
    expect(h.appMonitorUserSharedService.updateAuthStateForCronJob).toHaveBeenCalledTimes(1)
    expect(h.appKeyService.rotateForCronJob).toHaveBeenCalledTimes(2)
    expect(h.sysUserDeviceSharedService.updateDeviceActiveStatusForCronJob).toHaveBeenCalledTimes(1)
    expect(h.sysUserMfaSharedService.updateMfaSetupStatusForCronJob).toHaveBeenCalledTimes(1)
  })
})
