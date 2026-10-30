import type { INestApplication } from '@nestjs/common'
import type { DataSource } from 'typeorm'
import { randomUUID } from 'node:crypto'

import { DBTransactionHooksStore } from '@walnut-server/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AppMonitorUserRepositoryService } from '@/modules/app/monitor/user/repo/user.repo.service'
import { AppMonitorUserBasicRepository } from '@/modules/app/monitor/user/user.basic.repository'
import { AppMonitorUserService } from '@/modules/app/monitor/user/user.service'
import { ALSRequestService } from '@/modules/shared/als/request/request.service'
import { SysDeviceBasicRepository } from '@/modules/system/device/device.basic.repository'
import { SysDeviceService } from '@/modules/system/device/device.service'
import { SysDeviceRepositoryService } from '@/modules/system/device/repo/device.repo.service'
import { SysUserDeviceRepositoryService } from '@/modules/system/user_device/repo/user_device.repo.service'
import { SysUserDeviceService } from '@/modules/system/user_device/user_device.service'
import { createIntegrationApp, getWalnutPgDataSource } from './helpers/create-integration-app'
import { INTEGRATION_DATABASE_NAME } from './helpers/integration.const'

/**
 * B6 设备三角用例（phase2 4.8/4.9/4.21 / phase3-plan §1 B6，on real PG）：
 * - device：按业务键 device_id 注册（initial upsert 覆盖写 + uq_device_id）、
 *   ipHistory/locationHistory 追加与 5 条截断语义、列表 location 过滤（jsonb ILIKE）、
 *   按业务键删除；IP 一律用私网段（ip.service 对本机 IP 确定性返回 LOCAL，不发外网请求）；
 * - user_device ↔ device：device_id 是**业务键** FK（Q5 定案）—— 未知业务键拒绝、
 *   (user_id, device_id) UNIQUE、设备删除 CASCADE、锁状态批量翻转、
 *   updateUserDeviceLastActiveAt 的基线（含 isNil 反转分支的原始行为）；
 * - monitor_user：visitorId upsert、left 过滤、populated user（sys_user 同源表）、
 *   forceQuit 链路（PG 读行 + doSignout；B7b 起 refresh revoke 写腿同为 PG，
 *   同库断言 revoked）、JOIN 版列表。
 */

const LOCAL_LOCATION = { country: 'LOCAL', region: 'LOCAL', city: 'LOCAL' }

describe('B6 device / user_device / monitor_user (on real PG)', () => {
  let app: INestApplication
  let pgDataSource: DataSource

  let deviceBasicRepo: SysDeviceBasicRepository
  let deviceRepoService: SysDeviceRepositoryService
  let deviceService: SysDeviceService
  let userDeviceRepo: SysUserDeviceRepositoryService
  let userDeviceService: SysUserDeviceService
  let monitorBasicRepo: AppMonitorUserBasicRepository
  let monitorRepoService: AppMonitorUserRepositoryService
  let monitorUserService: AppMonitorUserService
  let als: ALSRequestService

  /**
   * 数据权限一期：app_monitor_user 已注册（allowAnonymous），直接调
   * AppMonitorUserBasicRepository 的用例必须显式进入系统通道。
   */
  const itSystem = (name: string, fn: () => Promise<void>) => it(name, async () => als.runAsSystem(fn))

  const seed = randomUUID()
  const unique = (prefix: string) => `${prefix}-${seed}`

  let pgUserId = ''

  async function countPg(table: string, where: string, params: unknown[]) {
    const rows: Array<{ c: number }> = await pgDataSource.query(
      `SELECT count(*)::int AS c FROM ${table} WHERE ${where}`,
      params,
    )
    return rows[0].c
  }

  /** 复刻 tx.interceptor 的 ALS 钩子通道：initial 内部走 registerAfterCommitHook（strict 版） */
  async function runInHookStore<T>(fn: () => Promise<T>): Promise<T> {
    const hooks: (() => Promise<void>)[] = []
    const result = await DBTransactionHooksStore.run(hooks, async () => fn())
    for (const hook of hooks) {
      await hook()
    }
    return result
  }

  function makeFakeReq(fingerprint: string) {
    return {
      fingerprint,
      realIp: '10.9.9.9',
      os: 'windows',
      browser: 'chrome',
      userAgent: { ua: 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0' },
    } as IWalnutAdminExpressRequest
  }

  beforeAll(async () => {
    app = await createIntegrationApp()
    pgDataSource = getWalnutPgDataSource(app)
    expect(pgDataSource.options.database).toBe(INTEGRATION_DATABASE_NAME)

    deviceBasicRepo = app.get(SysDeviceBasicRepository)
    deviceRepoService = app.get(SysDeviceRepositoryService)
    deviceService = app.get(SysDeviceService)
    userDeviceRepo = app.get(SysUserDeviceRepositoryService)
    userDeviceService = app.get(SysUserDeviceService)
    monitorBasicRepo = app.get(AppMonitorUserBasicRepository)
    monitorRepoService = app.get(AppMonitorUserRepositoryService)
    monitorUserService = app.get(AppMonitorUserService)
    als = app.get(ALSRequestService)

    const userRows: Array<{ id: string }> = await pgDataSource.query(
      'INSERT INTO sys_user (user_name) VALUES ($1) RETURNING id',
      [unique('b6-user')],
    )
    pgUserId = userRows[0].id
  })

  afterAll(async () => {
    await app.close()
  })

  describe('sys_device：注册（业务键 upsert）与唯一约束', () => {
    itSystem('initial：按业务键 device_id upsert —— 首次插入全字段落位（sr/vp/geo 拍平、locationHistory 种子）', async () => {
      const fingerprint = unique('fp-initial')
      const payload = {
        deviceName: unique('b6-device-initial'),
        private: false,
        sr: { height: 2000, width: 1100 },
        vp: { height: 900, width: 800 },
        hardwareInfo: { cpuCores: 8 },
        deviceInfo: { platform: 'win32', netType: 'wifi', isp: 'telecom' },
      }

      const deviceId = deviceRepoService.getDeviceIdByFingerprint(fingerprint)
      const res = await runInHookStore(async () =>
        deviceService.initial(makeFakeReq(fingerprint), payload as never, pgDataSource.manager))

      expect(res.deviceId).toBe(deviceId)
      // 私网 IP → ip.service 确定性返回 LOCAL（无 countryCode/经纬度）
      expect(res.locationInfo).toMatchObject(LOCAL_LOCATION)

      const device = await deviceRepoService.findDeviceByDeviceId(deviceId)
      expect(device).not.toBeNull()
      expect(device!.deviceName).toBe(payload.deviceName)
      expect(device!.srHeight).toBe(2000)
      expect(device!.srWidth).toBe(1100)
      expect(device!.vpHeight).toBe(900)
      expect(device!.vpWidth).toBe(800)
      expect(device!.geoLongitude).toBeNull()
      expect(device!.geoLatitude).toBeNull()
      expect(device!.deviceInfo).toMatchObject({ os: 'windows', browser: 'chrome', type: 'desktop' })
      expect(device!.locationInfo).toMatchObject(LOCAL_LOCATION)
      expect(device!.locationHistory).toHaveLength(1)
      expect(device!.locationHistory[0]).toMatchObject({ ip: '10.9.9.9', location: LOCAL_LOCATION })
      expect(device!.ipHistory).toEqual(['10.9.9.9'])
      expect(device!.ip).toBe('10.9.9.9')
      expect(device!.active).toBe(true)
      expect(device!.riskScore).toBe(0)
    })

    itSystem('initial：同指纹二次注册 → 同一行整体覆盖（不新增）', async () => {
      const fingerprint = unique('fp-initial')

      await runInHookStore(async () =>
        deviceService.initial(makeFakeReq(fingerprint), {
          deviceName: unique('b6-device-initial'),
          private: false,
          sr: { height: 2000, width: 1100 },
          vp: { height: 900, width: 800 },
          hardwareInfo: {},
          deviceInfo: {},
        } as never, pgDataSource.manager))

      // 改名重注册：业务键命中 → 覆盖而非新行（对齐 $set + upsert）
      await runInHookStore(async () =>
        deviceService.initial(makeFakeReq(fingerprint), {
          deviceName: unique('b6-device-initial-2'),
          private: false,
          sr: { height: 1000, width: 500 },
          vp: { height: 400, width: 300 },
          hardwareInfo: {},
          deviceInfo: {},
        } as never, pgDataSource.manager))

      const deviceId = deviceRepoService.getDeviceIdByFingerprint(fingerprint)
      expect(await countPg('sys_device', 'device_id = $1', [deviceId])).toBe(1)
      const device = await deviceRepoService.findDeviceByDeviceId(deviceId)
      expect(device!.deviceName).toBe(unique('b6-device-initial-2'))
      expect(device!.srHeight).toBe(1000)
    })

    itSystem('uq_device_id：业务键重复插入拒绝（对齐 Mongo unique）', async () => {
      const deviceId = unique('b6-dup-device')
      await deviceBasicRepo.create({
        deviceName: unique('b6-dup-device-name'),
        deviceId,
        deviceInfo: {},
        ipHistory: [],
      })

      await expect(deviceBasicRepo.create({
        deviceName: unique('b6-dup-device-name-2'),
        deviceId,
        deviceInfo: {},
        ipHistory: [],
      })).rejects.toThrow()
    })
  })

  describe('sys_device：ipHistory/locationHistory 追加语义', () => {
    itSystem('新 IP 追加（两列同索引同步）、旧 IP 原位替换、超过 5 条 shift 截断', async () => {
      const deviceId = unique('b6-ip-device')
      await deviceBasicRepo.create({
        deviceName: unique('b6-ip-device-name'),
        deviceId,
        deviceInfo: {},
        ipHistory: ['10.0.0.1'],
        locationHistory: [{ ip: '10.0.0.1', location: { country: 'China' }, timestamp: 1 }],
      })

      // 新 IP → 追加（私网 IP → LOCAL 定位）
      await deviceRepoService.updateIpAndLocation(deviceId, '10.0.0.2')
      let device = await deviceRepoService.findDeviceByDeviceId(deviceId)
      expect(device!.ipHistory).toEqual(['10.0.0.1', '10.0.0.2'])
      expect(device!.locationHistory).toHaveLength(2)
      expect(device!.locationHistory[1]).toMatchObject({ ip: '10.0.0.2', location: LOCAL_LOCATION })
      expect(device!.locationHistory[1].timestamp).toBeGreaterThan(1)
      expect(device!.ip).toBe('10.0.0.2')
      expect(device!.locationInfo).toMatchObject(LOCAL_LOCATION)

      // 已存在 IP → 原位替换（长度不变）
      const before = device!.locationHistory[0].timestamp
      await deviceRepoService.updateIpAndLocation(deviceId, '10.0.0.1')
      device = await deviceRepoService.findDeviceByDeviceId(deviceId)
      expect(device!.ipHistory).toEqual(['10.0.0.1', '10.0.0.2'])
      expect(device!.locationHistory).toHaveLength(2)
      expect(device!.locationHistory[0].timestamp).toBeGreaterThan(before)

      // 追加到 5 条上限后继续追加 → shift 截断（保 5 条，最旧者出局）
      await deviceRepoService.updateIpAndLocation(deviceId, '10.0.0.3')
      await deviceRepoService.updateIpAndLocation(deviceId, '10.0.0.4')
      await deviceRepoService.updateIpAndLocation(deviceId, '10.0.0.5')
      await deviceRepoService.updateIpAndLocation(deviceId, '10.0.0.6')
      device = await deviceRepoService.findDeviceByDeviceId(deviceId)
      expect(device!.ipHistory).toEqual(['10.0.0.2', '10.0.0.3', '10.0.0.4', '10.0.0.5', '10.0.0.6'])
      expect(device!.locationHistory.map(i => i.ip)).toEqual(device!.ipHistory)

      // 未知业务键 → NotFound
      await expect(deviceRepoService.updateIpAndLocation(unique('b6-ghost'), '10.0.0.7')).rejects.toThrow()
    })

    itSystem('list：location 过滤打在 location_info 三个子字段（ILIKE 字面量）', async () => {
      const res = await deviceService.list({
        query: { location: 'local' },
        page: { page: 1, pageSize: 10 },
      } as never)

      expect(res.total).toBeGreaterThanOrEqual(1)
      expect(res.data.some(i => i.deviceId === deviceRepoService.getDeviceIdByFingerprint(unique('fp-initial')))).toBe(true)

      const miss = await deviceService.list({
        query: { location: 'atlantis' },
        page: { page: 1, pageSize: 10 },
      } as never)
      expect(miss.total).toBe(0)
    })

    itSystem('deleteNonMonitorUserDevice：按业务键删除并返回快照', async () => {
      const deviceId = unique('b6-del-device')
      await deviceBasicRepo.create({
        deviceName: unique('b6-del-device-name'),
        deviceId,
        deviceInfo: {},
        ipHistory: [],
      })

      const snapshot = await deviceRepoService.deleteNonMonitorUserDevice(deviceId) as { deviceId: string }
      expect(snapshot.deviceId).toBe(deviceId)
      expect(await countPg('sys_device', 'device_id = $1', [deviceId])).toBe(0)

      // 幂等路径：不存在返回 null（对齐 findOneAndDelete）
      expect(await deviceRepoService.deleteNonMonitorUserDevice(deviceId)).toBeNull()
    })
  })

  describe('sys_user_device ↔ sys_device：业务键 FK', () => {
    let deviceAKey = ''
    let deviceBKey = ''

    itSystem('未知业务键插入拒绝；已知业务键插入成功；(user_id, device_id) UNIQUE', async () => {
      deviceAKey = unique('b6-ua-device')
      deviceBKey = unique('b6-ub-device')
      await deviceBasicRepo.create({ deviceName: unique('b6-ua-name'), deviceId: deviceAKey, deviceInfo: {}, ipHistory: [] })
      await deviceBasicRepo.create({ deviceName: unique('b6-ub-name'), deviceId: deviceBKey, deviceInfo: {}, ipHistory: [] })

      // FK 挂在业务键 sys_device(device_id)（Q5 定案）：幽灵业务键拒绝，
      // 且必须是 PG 的 foreign_key_violation（23503）—— B7a review 挂单补错误码断言
      await expect(pgDataSource.query(
        'INSERT INTO sys_user_device (user_id, device_id) VALUES ($1, $2)',
        [pgUserId, unique('b6-ghost-device')],
      )).rejects.toMatchObject({ code: '23503' })

      const row = await userDeviceRepo.upsertDevice(pgUserId, deviceAKey, unique('b6-ua-name'))
      expect(row.deviceId).toBe(deviceAKey)
      expect(row.deviceName).toBe(unique('b6-ua-name'))
      // 幂等：同 (user, device) 再 upsert 返回既有行
      const again = await userDeviceRepo.upsertDevice(pgUserId, deviceAKey, 'renamed')
      expect(again.id).toBe(row.id)

      await userDeviceRepo.upsertDevice(pgUserId, deviceBKey, unique('b6-ub-name'))

      // uq_user_device (user_id, device_id)：重复绑定拒绝（Q2 定案补 UNIQUE）
      await expect(pgDataSource.query(
        'INSERT INTO sys_user_device (user_id, device_id) VALUES ($1, $2)',
        [pgUserId, deviceAKey],
      )).rejects.toThrow()
    })

    itSystem('updateLockStatusForAllDevices：$ne 语义批量翻转 + isAnyDeviceLockedForUser', async () => {
      expect(await userDeviceRepo.isAnyDeviceLockedForUser(pgUserId)).toBe(false)

      await userDeviceRepo.updateLockStatusForAllDevices(pgUserId, true)
      expect(await userDeviceRepo.isAnyDeviceLockedForUser(pgUserId)).toBe(true)
      expect(await userDeviceRepo.isDeviceLockedForUser(pgUserId, deviceAKey)).toBe(true)
      expect(await userDeviceRepo.isDeviceLockedForUser(pgUserId, deviceBKey)).toBe(true)

      await userDeviceRepo.updateLockStatusForAllDevices(pgUserId, false)
      expect(await userDeviceRepo.isAnyDeviceLockedForUser(pgUserId)).toBe(false)
    })

    itSystem('updateUserDeviceLastActiveAt：基线语义（含 isNil 反转分支的原始行为）', async () => {
      const target = await userDeviceRepo.findByUserAndDevice(pgUserId, deviceAKey)
      expect(target).not.toBeNull()
      // 行刚建，lastActiveAt 尚未置值
      expect(target!.lastActiveAt).toBeNull()

      // userId 为 nil → Mongo 版 `new Types.ObjectId(undefined)` 生成全新 id 恒匹配空集；
      // PG 侧等价（一次性随机 uuid）→ 返回 null，行不动
      expect(await userDeviceRepo.updateUserDeviceLastActiveAt(deviceAKey, undefined)).toBeNull()
      const untouched = await userDeviceRepo.findByUserAndDevice(pgUserId, deviceAKey)
      expect(untouched!.lastActiveAt).toBeNull()

      // userId 非 nil → 按 deviceId 更新命中行
      const updated = await userDeviceRepo.updateUserDeviceLastActiveAt(deviceAKey, pgUserId)
      expect(updated!.lastActiveAt).not.toBeNull()
      expect(updated!.lastActiveAt!.getTime()).toBeGreaterThan(0)
    })

    itSystem('删除设备 → user_device 行级联消失（ON DELETE CASCADE）', async () => {
      await pgDataSource.query('DELETE FROM sys_device WHERE device_id = $1', [deviceAKey])

      expect(await countPg('sys_device', 'device_id = $1', [deviceAKey])).toBe(0)
      expect(await countPg('sys_user_device', 'device_id = $1', [deviceAKey])).toBe(0)
      // 另一台设备不受影响
      expect(await countPg('sys_user_device', 'device_id = $1', [deviceBKey])).toBe(1)
    })
  })

  describe('app_monitor_user：upsert、active 过滤、populated user', () => {
    itSystem('findOneAndUpdate：visitorId upsert（先插后改），DB 默认值落位', async () => {
      const visitorId = unique('b6-visitor-1')
      const deviceAKey = unique('b6-m-device')

      await deviceBasicRepo.create({ deviceName: unique('b6-m-name'), deviceId: deviceAKey, deviceInfo: { os: 'windows', browser: 'chrome' }, ip: '9.9.9.9', locationInfo: { country: 'China' }, ipHistory: [] })

      const created = await monitorRepoService.findOneAndUpdate(
        { visitorId },
        { deviceId: deviceAKey, auth: true, currentRouter: '/home' },
        { upsert: true },
      )
      expect(created!.visitorId).toBe(visitorId)
      expect(created!.auth).toBe(true)
      expect(created!.focus).toBe(false)
      expect(created!.left).toBe(false)
      expect(created!.firstVisitAt).not.toBeNull()
      expect(created!.lastActiveAt).not.toBeNull()

      // 二次写：同 visitorId 更新同一行（uq_monitor_visitor）
      const updated = await monitorRepoService.findOneAndUpdate(
        { visitorId },
        { deviceId: deviceAKey, currentRouter: '/settings' },
        { upsert: true },
      )
      expect(updated!.id).toBe(created!.id)
      expect(updated!.currentRouter).toBe('/settings')
      expect(await countPg('app_monitor_user', 'visitor_id = $1', [visitorId])).toBe(1)
    })

    itSystem('findActiveByDeviceId / findFirstByDeviceId：left 过滤差异', async () => {
      const deviceKey = unique('b6-left-device')
      await deviceBasicRepo.create({ deviceName: unique('b6-left-name'), deviceId: deviceKey, deviceInfo: {}, ipHistory: [] })

      await monitorBasicRepo.create({ visitorId: unique('b6-visitor-left'), deviceId: deviceKey, left: true })
      await monitorBasicRepo.create({ visitorId: unique('b6-visitor-active'), deviceId: deviceKey, left: false })

      const active = await monitorRepoService.findActiveByDeviceId(deviceKey)
      expect(active!.left).toBe(false)

      // justOne 语义：不筛 left，任取一行
      const first = await monitorRepoService.findFirstByDeviceId(deviceKey)
      expect(first).not.toBeNull()
    })

    itSystem('findActiveUserByDeviceId：user 松引用查 sys_user 同源表（ETL 前空数据窗口）', async () => {
      const deviceKey = unique('b6-pop-device')
      await deviceBasicRepo.create({ deviceName: unique('b6-pop-name'), deviceId: deviceKey, deviceInfo: {}, ipHistory: [] })

      const withUser = await monitorBasicRepo.create({ visitorId: unique('b6-visitor-user'), deviceId: deviceKey, userId: pgUserId, auth: true })
      const withoutUser = await monitorBasicRepo.create({ visitorId: unique('b6-visitor-anon'), deviceId: deviceKey, left: true })

      expect(await monitorRepoService.findActiveUserByDeviceId(deviceKey)).toMatchObject({
        id: pgUserId,
        userName: unique('b6-user'),
      })

      // 未知设备 → 无 active monitor → null
      expect(await monitorRepoService.findActiveUserByDeviceId(unique('b6-nobody'))).toBeNull()

      await monitorBasicRepo.deleteRealById(withoutUser.id)
      await monitorBasicRepo.deleteRealById(withUser.id)
    })
  })

  describe('forceQuit 链路', () => {
    itSystem('monitor 不存在 → false（PG 侧短路）', async () => {
      const result = await monitorUserService.forceQuitByMonitorId(randomUUID(), pgDataSource.manager)
      expect(result).toBe(false)
    })

    itSystem('forceQuitByMonitorId：PG 读行 + doSignout，refresh revoke 写腿同为 PG（B7b 归一）', async () => {
      const deviceKey = unique('b6-fq-device')
      await deviceBasicRepo.create({ deviceName: unique('b6-fq-name'), deviceId: deviceKey, deviceInfo: {}, ipHistory: [] })

      const jti = unique('b6-fq-jti')
      // refresh 行已迁 PG（B7b）：双 FK —— user_id → sys_user、device_id → sys_device(device_id)
      await pgDataSource.query(
        'INSERT INTO auth_refresh_token (jti, user_id, device_id, encrypted_token, expired_at) VALUES ($1, $2, $3, $4, $5)',
        [jti, pgUserId, deviceKey, 'enc', new Date(Date.now() + 3600_000).toISOString()],
      )

      const monitor = await monitorBasicRepo.create({
        visitorId: unique('b6-fq-visitor'),
        deviceId: deviceKey,
        userId: pgUserId,
        auth: true,
        // left=true → isOnline=false → forceQuit 只走 revoke 腿、不发 socket
        left: true,
      })

      const result = await monitorUserService.forceQuitByMonitorId(monitor.id, pgDataSource.manager)

      // doSignout(admin-kick) 正常完成（返回 void）
      expect(result).toBeUndefined()

      // B7b 归一：revoke 落 PG 同一行（原 B6~B7 跨引擎窗口的「不落 Mongo」现状断言随之退役）
      const rows: Array<{ revoked: boolean }> = await pgDataSource.query(
        'SELECT revoked FROM auth_refresh_token WHERE jti = $1',
        [jti],
      )
      expect(rows[0].revoked).toBe(true)

      await monitorBasicRepo.deleteRealById(monitor.id)
    })

    itSystem('user_device.forceQuitUserDevice：无 monitor 行 → DataNotFound', async () => {
      await expect(userDeviceService.forceQuitUserDevice(
        pgUserId,
        unique('b6-fq-nobody'),
        pgDataSource.manager,
      )).rejects.toThrow()
    })
  })

  describe('monitor 列表：JOIN 版 $lookup', () => {
    itSystem('device / user 形态 + populate 字段过滤（os/ip/userName）', async () => {
      const deviceKey = unique('b6-list-device')
      await deviceBasicRepo.create({
        deviceName: unique('b6-list-name'),
        deviceId: deviceKey,
        deviceInfo: { os: 'windows', browser: 'chrome', type: 'desktop' },
        ip: '9.9.9.9',
        locationInfo: { country: 'China' },
        ipHistory: [],
      })

      const authedVisitor = unique('b6-list-visitor-auth')
      await monitorBasicRepo.create({
        visitorId: authedVisitor,
        deviceId: deviceKey,
        userId: pgUserId,
        auth: true,
        currentRouter: '/about',
      })

      // os 命中：authedVisitor 行带上 device / user
      const res = await monitorUserService.list({
        query: { os: 'win' },
        page: { page: 1, pageSize: 10 },
      } as never)

      const row = res.data.find(i => i.visitorId === authedVisitor)
      expect(row).toBeDefined()
      expect(row!.device).toMatchObject({
        deviceInfo: { os: 'windows', browser: 'chrome', type: 'desktop' },
        ip: '9.9.9.9',
        locationInfo: { country: 'China' },
      })
      expect(row!.user).toMatchObject({ id: pgUserId, userName: unique('b6-user') })

      // userName 过滤（$lookup user 上的 $regex → JOIN ILIKE）
      const byUser = await monitorUserService.list({
        query: { userName: unique('b6-user') },
        page: { page: 1, pageSize: 10 },
      } as never)
      expect(byUser.total).toBe(1)
      expect(byUser.data[0].visitorId).toBe(authedVisitor)

      // 未命中过滤
      const miss = await monitorUserService.list({
        query: { userName: 'atlantis' },
        page: { page: 1, pageSize: 10 },
      } as never)
      expect(miss.total).toBe(0)
    })
  })
})
