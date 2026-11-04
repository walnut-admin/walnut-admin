import type { EntityManager } from 'typeorm'
import { Injectable, Logger } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { AppTechCacheDeviceService } from '@walnut-server/cache'
import { runAfterCommit, WalnutPGConnectionName } from '@walnut-server/db'
import { WalnutAdminExceptionNotFound } from '@walnut-server/exceptions'

import { SharedIpService } from '@walnut-server/ip'
import { SharedLocationDTO } from '@walnut-server/list'
import { AppDayjs } from '@walnut-server/utils/dayjs'
import { DataSource } from 'typeorm'
import { SysDeviceEntity } from '../entity/device.entity'

/**
 * B6 迁移：Mongo model → PG 命名连接 DataSource。全部查询按**业务键 device_id**走
 * （Q5 定案：user_device / auth_refresh_token 引用的是 sys_device.device_id，不是行 id），
 * 事务句柄 `dbSession?: ClientSession` → `em?: EntityManager`（取自 WalnutTxContext.em，
 * 缺省连接级 manager，语义同 Mongo 版可选 session）。
 */
@Injectable()
export class SysDeviceRepositoryService {
  private readonly logger = new Logger(SysDeviceRepositoryService.name)

  constructor(
    @InjectDataSource(WalnutPGConnectionName)
    private readonly dataSource: DataSource,

    private readonly cacheDeviceService: AppTechCacheDeviceService,
    private readonly sharedIpService: SharedIpService,
  ) { }

  private getRepository(em?: EntityManager) {
    return (em ?? this.dataSource.manager).getRepository(SysDeviceEntity)
  }

  /**
   * @description get all active devices
   */
  async getAllActiveDevices() {
    return this.getRepository().find({ where: { active: true } })
  }

  /**
   * @description 标记设备行为 stale（**不再物理删行**，拍板-5）
   *
   * 原实现是删行（findOneAndDelete 语义）：行一没，cookie 还在的浏览器就永久 40605
   * （DeviceGuard 回源查不到），而 banned / locked 也随行一起消失 —— 「等 cron 删行」
   * 成了绕过封禁的免费路径。现在只写 `stale = true` + `active = false`：
   * - 行与 cookie 生命周期解耦，guard 照常命中 ⇒ 不再造出 40605 死胡同；
   * - banned / locked 原地保留 ⇒ 删行不再是封禁的逃生门；
   * - `stale` 不参与鉴权，重新 initial 时由 device.service 写回 false。
   *
   * @returns 标记**前**的快照（调用方只关心「有没有打过标记」，无行返回 null）
   */
  async markDeviceStale(deviceId: string) {
    const repository = this.getRepository()

    const target = await repository.findOne({ where: { deviceId } })
    if (!target) {
      return null
    }

    const snapshot = { ...target }

    target.stale = true
    target.active = false

    const saved = await repository.save(target)

    // 行还在、只是 stale：缓存回写新状态（不再 del —— del 会让下一次请求回源，多一跳）
    await this.cacheDeviceService.setSysDeviceCache(saved)

    return snapshot
  }

  /**
   * @description 90 天留存清理：删掉「不在用、且 90 天没有任何写活动」的设备行
   *
   * 判据（批次 11 拍板）：
   * - `active = false`：当前不在用；
   * - `updated_at < cutoff`：锚点是 `updated_at` 而不是 `stale` —— `stale` 只覆盖
   *   「initial 完就没心跳」那部分；「用过之后放弃」的设备 `stale` 恒 false（它只在
   *   「active=true 但查不到 monitor 行」时才被打），只按 stale 清会漏掉主群。
   *   `updated_at` 是 @UpdateDateColumn，initial / 心跳翻 active / IP 变更 / markDeviceStale
   *   都会推它，是唯一在所有分支下都还在的活动痕迹；
   * - `banned = false AND locked = false`：封禁/锁定的行是那条决定的**唯一持久记录**，
   *   删掉等于静默解封（guard 查不到行 → 40605 → 自愈 → 换新身份）；
   * - 没有 90 天内的在线访客行（`last_active_at` 在窗口内，或 `auth = true`）：心跳是比
   *   `updated_at` 更细的活动证据；
   * - 没有「未撤销且未过期」的 RT：`fk_rt_device` 是 ON DELETE CASCADE，删设备会连带删掉
   *   活会话（= 静默踢人）。90 天没动的机器理论上没有活 RT，但别把安全建立在理论上。
   *
   * 为什么读别域的两张表：这两条子查询是**只读存在性旁证**（松引用，没有 FK），删除动作
   * 仍只发生在本域拥有的 sys_device 上；把判据拆到两个事务里会重新引入「设备删了、
   * monitor 行还在」的孤儿窗口。
   *
   * @param cutoff 活动窗口下界（`now - 90d`，由 cron 服务算好传入，天数不在 SQL 里写死）
   * @param em **必须**传入调用方的 system 事务句柄 —— 返回的 device_id 列表要在同一事务里
   *   交给 `IIdentityMonitorRepository.deleteByDeviceIds` 清 monitor 行。
   * @returns 被删掉的 device_id（受 FK CASCADE 影响的子表行不在这里列，调用方只记日志）
   */
  async purgeInactiveDevicesBefore(cutoff: Date, em: EntityManager): Promise<string[]> {
    // 泛型显式给「行数组」：驱动实际返回的是 `[rows, rowCount]`，下面按两种形状归一
    const raw = await em.query<Array<{ device_id: string }>>(
      `DELETE FROM sys_device d
        WHERE d.active = false
          AND d.updated_at < $1::timestamptz
          AND d.banned = false
          AND d.locked = false
          AND NOT EXISTS (
            SELECT 1 FROM app_monitor_user m
             WHERE m.device_id = d.device_id
               AND (m.last_active_at > $1::timestamptz OR m.auth = true))
          AND NOT EXISTS (
            SELECT 1 FROM auth_refresh_token rt
             WHERE rt.device_id = d.device_id
               AND rt.revoked = false
               AND rt.expired_at > now())
        RETURNING d.device_id`,
      [cutoff],
    )

    // TypeORM 的 Postgres 驱动对**非 SELECT** 语句返回 `[rows, rowCount]` 二元组（实测：
    // 0 行时是 `[[], 0]`），只有 SELECT 才直接给行数组。直接 `raw.map(...)` 会得到
    // `[undefined, undefined]` —— 删得掉设备、却删不掉 monitor 行（本批集成用例抓到的真实
    // 缺陷）。这里按两种形状归一，不赌驱动版本。
    const rows = (Array.isArray(raw[0]) ? raw[0] : raw) as Array<{ device_id: string }>

    return rows.map(row => row.device_id)
  }

  /**
   * @description get device name by device id
   */
  async getDeviceNameByDeviceId(deviceId: string, em?: EntityManager) {
    const device = await this.getRepository(em).findOne({ where: { deviceId } })
    return device?.deviceName as string
  }

  /**
   * @description find device by device id
   */
  async findDeviceByDeviceId(deviceId: string, em?: EntityManager) {
    return this.getRepository(em).findOne({ where: { deviceId } })
  }

  /**
   * @description find device by device id and update
   * （Mongo 版 findOneAndUpdate + returnDocument: 'after' → 找到即赋值保存，返回更新后行）
   */
  async findDeviceByDeviceIdAndUpdate(deviceId: string, update: Partial<SysDeviceEntity>, em?: EntityManager) {
    const repository = this.getRepository(em)

    const target = await repository.findOne({ where: { deviceId } })
    if (!target) {
      return null
    }

    Object.assign(target, update)
    return repository.save(target)
  }

  /**
   * @description get device location history
   */
  async getDeviceLocationHistory(deviceId: string) {
    const device = await this.getRepository().findOne({ where: { deviceId } })
    return device?.locationHistory || []
  }

  /**
   * @description get device current location
   */
  async getDeviceCurrentLocation(deviceId: string) {
    const device = await this.getRepository().findOne({ where: { deviceId } })
    return device?.locationInfo || null
  }

  /**
   * 获取设备创建时间距离当前时间的天数
   * @param createdAt 设备创建时间
   * @returns 距离当前时间的天数
   */
  getDeviceCreatedDays(createdAt: Date) {
    return AppDayjs().diff(createdAt, 'day')
  }

  /**
   * 更新设备 IP 和位置信息
   *
   * 逻辑：
   * 1. 同时更新 ipHistory 和 locationHistory
   * 2. 保持两者同步（相同的索引对应相同的记录）
   * 3. 最多保留 5 条历史记录
   * 4. 更新 locationInfo 为最新位置
   *
   * @param deviceId - Device ID
   * @param ip - 新的 IP address
   */
  async updateIpAndLocation(
    deviceId: string,
    ip: string,
    em?: EntityManager,
  ) {
    const repository = this.getRepository(em)

    const device = await repository.findOne({ where: { deviceId } })
    const responseLocation = await this.sharedIpService.getLocationInfoFromFreeAPI(ip)

    const location: SharedLocationDTO = {
      country: responseLocation.country,
      region: responseLocation.region,
      city: responseLocation.city,
    }

    if (!device) {
      throw new WalnutAdminExceptionNotFound()
    }

    // 检查 IP 是否已存在
    const existingIndex = device.ipHistory.indexOf(ip)

    if (existingIndex !== -1) {
      // IP 已存在，更新对应的位置信息和时间戳
      device.locationHistory[existingIndex] = {
        ip,
        location: location as unknown as Record<string, unknown>,
        timestamp: AppDayjs().valueOf(),
      }
    }
    else {
      // 新 IP，添加到历史记录
      device.ipHistory.push(ip)
      device.locationHistory.push({
        ip,
        location: location as unknown as Record<string, unknown>,
        timestamp: AppDayjs().valueOf(),
      })

      // 保持最多 5 条记录
      if (device.ipHistory.length > 5) {
        device.ipHistory.shift()
        device.locationHistory.shift()
      }
    }

    // 更新当前位置信息为最新的
    device.locationInfo = location as unknown as Record<string, unknown>
    device.ip = ip

    await repository.save(device)

    // set device cache after transaction commit
    await runAfterCommit(async () => {
      await this.cacheDeviceService.setSysDeviceCache(device)
    })

    return true
  }
}
