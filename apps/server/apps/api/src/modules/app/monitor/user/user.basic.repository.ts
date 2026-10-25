import type { DataSource, EntityManager, SelectQueryBuilder } from 'typeorm'
import type { IWalnutAdminRequestList } from '@/common/dto/list.dto'
import { Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { WalnutDBModelName, WalnutPGConnectionName } from '@walnut-server/db'

import { WalnutAdminCommonPgBaseRepository } from '@/common/repository/pg-base.repository'
import {
  applyPgListQuery,
  buildPgListQueryOptions,
  ILIKE_ESCAPE_REGEX,
  WALNUT_PG_LIST_TOTAL_ALIAS,
} from '@/common/repository/pg-list.builder'
import { AppMonitorUserEntity } from './entity/monitor-user.entity'

/** monitor 列表行：实体列 + Mongo 版 $lookup 注入的 populated_device / populated_user */
export interface IAppMonitorUserListRow extends AppMonitorUserEntity {
  populated_device: {
    deviceInfo: { os: unknown, browser: unknown, type: unknown }
    ip: string | null
    locationInfo: { country: unknown }
  } | null
  populated_user: { id: string, userName: string | null } | null
}

/**
 * B6 迁移模板（repo 层）：类名与文件名保持不变（DI token 不动），基类换成 PG 版。
 *
 * Mongo 版 list 的 $lookup（device 按 deviceId 业务键、user 按 userId）在这里以
 * LEFT JOIN 承接（均无行放大：device_id 全表唯一、user 侧 PK 对一），出参组装回
 * populated_device / populated_user 形态；matchConditions 里落在 populate 字段上的
 * （ip/country/os/browser/userName）转为 JOIN 别名上的 ILIKE（$regex 'i' 等价）。
 */
@Injectable()
export class AppMonitorUserBasicRepository extends WalnutAdminCommonPgBaseRepository<AppMonitorUserEntity> {
  constructor(
    @InjectDataSource(WalnutPGConnectionName)
    dataSource: DataSource,
  ) {
    super(AppMonitorUserEntity, WalnutDBModelName.APP_MONITOR_USER, dataSource)
  }

  public async list<T>(
    params: IWalnutAdminRequestList<T>,
    _customize?: (qb: SelectQueryBuilder<AppMonitorUserEntity>) => void,
    em?: EntityManager,
  ): Promise<{ data: IAppMonitorUserListRow[], total: number }> {
    const qb = this.getManager(em)
      .createQueryBuilder(AppMonitorUserEntity, 'entity')
      .leftJoin('sys_device', 'device', 'device.device_id = entity.device_id')
      .leftJoin('sys_user', 'monitor_user', 'monitor_user.id = entity.user_id')

    applyPgListQuery(qb, 'entity', buildPgListQueryOptions<T>(params))

    // Mongo 版 matchConditions：populate 字段上的 $regex('i') → JOIN 别名 ILIKE
    // （字面量转义同 pg-list.builder；非实体列被 applyPgListQuery 的白名单跳过，在此接管）
    const query = (params.query ?? {}) as Record<string, unknown>
    const ilike = (expression: string, key: string, raw: unknown) => {
      if (raw === null || raw === undefined || raw === '') {
        return
      }
      const escaped = String(raw).replace(ILIKE_ESCAPE_REGEX, c => `\\${c}`)
      qb.andWhere(`${expression} ILIKE :${key}`, { [key]: `%${escaped}%` })
    }
    ilike('device.ip', 'monitorDeviceIp', query.ip)
    ilike(`device.location_info->>'country'`, 'monitorCountry', query.country)
    ilike(`device.device_info->>'os'`, 'monitorOs', query.os)
    ilike(`device.device_info->>'browser'`, 'monitorBrowser', query.browser)
    ilike('monitor_user.user_name', 'monitorUserName', query.userName)

    // populate 出参列（别名与实体列错开；device.id 作 JOIN 命中标记），同趟带出 total 窗口列
    qb.addSelect('device.id', 'populated_device_id')
    qb.addSelect('device.ip', 'populated_device_ip')
    qb.addSelect(`device.device_info->>'os'`, 'populated_device_os')
    qb.addSelect(`device.device_info->>'browser'`, 'populated_device_browser')
    qb.addSelect(`device.device_info->>'type'`, 'populated_device_type')
    qb.addSelect(`device.location_info->>'country'`, 'populated_device_country')
    qb.addSelect('monitor_user.id', 'populated_user_id')
    qb.addSelect('monitor_user.user_name', 'populated_user_user_name')
    qb.addSelect(`COUNT(*) OVER()`, WALNUT_PG_LIST_TOTAL_ALIAS)

    const { raw, entities } = await qb.getRawAndEntities()

    const total = Number((raw[0] as Record<string, unknown> | undefined)?.[WALNUT_PG_LIST_TOTAL_ALIAS] ?? 0)

    // 单行 JOIN 无放大，raw 与 entities 逐行对齐；populate 对象按行并回
    const data = entities.map((entity, index) => {
      const row = raw[index] as Record<string, unknown> | undefined

      const populatedDeviceId = row?.populated_device_id as string | undefined
      const populatedUserId = row?.populated_user_id as string | undefined

      const populated_device = populatedDeviceId != null
        ? {
            deviceInfo: {
              os: row?.populated_device_os ?? null,
              browser: row?.populated_device_browser ?? null,
              type: row?.populated_device_type ?? null,
            },
            ip: (row?.populated_device_ip as string | null) ?? null,
            locationInfo: { country: row?.populated_device_country ?? null },
          }
        : null

      const populated_user = populatedUserId != null
        ? { id: populatedUserId, userName: (row?.populated_user_user_name as string | null) ?? null }
        : null

      return Object.assign(entity, { populated_device, populated_user })
    })

    return { data, total }
  }
}
