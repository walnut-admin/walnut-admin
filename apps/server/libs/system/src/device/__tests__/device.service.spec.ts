import type { AppTechCacheDeviceService } from '@walnut-server/cache'
import type { SysUserDeviceSharedService } from '@walnut-server/identity'
import type { SharedIpService } from '@walnut-server/ip'
import type { EntityManager } from 'typeorm'
import type { IWalnutAdminSystemMonitorActiveUserReader } from '../../system.ports'
import type { SysDeviceBasicRepository } from '../device.basic.repository'
import type { SysDeviceRepositoryService } from '../repo/device.repo.service'
import { WalnutAdminConstRevokeRTType } from '@walnut-server/const/app/setting'
import { describe, expect, it, vi } from 'vitest'
import { SysDeviceService } from '../device.service'

/**
 * 拍板-4（封禁 = 踢下线）的**服务层**钉点：封禁必须触发设备踢下线端口，解禁 / 锁定不触发。
 *
 * 为什么钉在这里：`ban` 原先只写 sys_device.banned（guard 下次请求才 40607），已封设备
 * 仍能用 /auth/refresh 续 AT、WebSocket 也不断。踢人动作本身跨两层（auth 的 RT/会话腿 +
 * app 的 socket 腿），经 `WALNUT_ADMIN_SYSTEM_DEVICE_KICKER` 端口注入 —— 本用例守的是
 * 「谁在什么时候调它」：只有 banned=true 才调，且必须带 deviceBanned 原因与事务句柄。
 */

const DEVICE_ID = 'a'.repeat(64)

function createHarness() {
  const updated = {
    id: 'device-row-id',
    deviceId: DEVICE_ID,
    deviceName: 'DESKTOP_AAAAAA',
    locked: false,
    banned: true,
    active: true,
    ip: '127.0.0.1',
  }

  const cacheDeviceService = {
    setSysDeviceCache: vi.fn(async () => undefined),
    markDeviceCookieRenewed: vi.fn(async () => true),
  }
  const deviceBasicRepo = {
    readById: vi.fn(async () => ({ id: 'device-row-id', deviceId: DEVICE_ID })),
  }
  const deviceRepoService = {
    findDeviceByDeviceIdAndUpdate: vi.fn(async () => updated),
  }
  const deviceKicker = { kickDevice: vi.fn(async () => []) }

  const service = new SysDeviceService(
    cacheDeviceService as unknown as AppTechCacheDeviceService,
    deviceBasicRepo as unknown as SysDeviceBasicRepository,
    {} as IWalnutAdminSystemMonitorActiveUserReader,
    deviceKicker,
    {} as SysUserDeviceSharedService,
    deviceRepoService as unknown as SysDeviceRepositoryService,
    {} as SharedIpService,
  )

  return { service, deviceKicker, deviceRepoService, cacheDeviceService }
}

// 事务句柄：`runAfterCommit` 在无 ALS 上下文时**内联执行**，所以这里传一个假 em 即可
const EM = { marker: 'entity-manager' } as unknown as EntityManager

describe('sysDeviceService：封禁 = 踢下线（拍板-4）', () => {
  it('ban → 踢下线端口被调一次，原因 deviceBanned，带事务句柄', async () => {
    const h = createHarness()

    await expect(h.service.ban('device-row-id', EM)).resolves.toBe(true)

    expect(h.deviceRepoService.findDeviceByDeviceIdAndUpdate).toHaveBeenCalledWith(
      DEVICE_ID,
      { banned: true },
      EM,
    )
    expect(h.deviceKicker.kickDevice).toHaveBeenCalledTimes(1)
    expect(h.deviceKicker.kickDevice).toHaveBeenCalledWith(
      DEVICE_ID,
      WalnutAdminConstRevokeRTType.deviceBanned,
      EM,
    )
  })

  it('unban → 不踢（解禁不该断人家会话）', async () => {
    const h = createHarness()

    await h.service.unban('device-row-id', EM)

    expect(h.deviceKicker.kickDevice).not.toHaveBeenCalled()
  })

  it('lock / unlock → 不踢（本轮封禁语义专属；锁定的覆盖见报告「需要 Lead 拍板」）', async () => {
    const h = createHarness()

    await h.service.lock('device-row-id', EM)
    await h.service.unlock('device-row-id', EM)

    expect(h.deviceKicker.kickDevice).not.toHaveBeenCalled()
  })

  it('封禁写库 + 缓存双写仍在（踢人不替代原有写腿）', async () => {
    const h = createHarness()

    await h.service.ban('device-row-id', EM)

    expect(h.cacheDeviceService.setSysDeviceCache).toHaveBeenCalledTimes(1)
  })
})
