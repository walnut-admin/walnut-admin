import type { IWalnutAdminRequestList } from '@walnut-server/list'
import type { DataSource, EntityManager, SelectQueryBuilder } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { WalnutModelName, WalnutPGConnectionName } from '@walnut-server/db'

import { getFilterValue } from '@walnut-server/list'
import { applyPgListQuery, buildPgListQueryOptionsFromQb, escapeLikePattern, WALNUT_PG_LIST_TOTAL_ALIAS, WalnutAdminCommonPgBaseRepository } from '@walnut-server/repository'
import { AppMonitorUserEntity } from './entity/monitor-user.entity'

/** monitor 列表行：实体列 + Mongo 版 $lookup 注入的 device / user */
export interface IAppMonitorUserListRow extends AppMonitorUserEntity {
  device: {
    deviceInfo: { os: unknown, browser: unknown, type: unknown }
    ip: string | null
    locationInfo: { country: unknown }
  } | null
  user: { id: string, userName: string | null } | null
}

/**
 * B6 迁移模板（repo 层）：类名与文件名保持不变（DI token 不动），基类换成 PG 版。
 *
 * Mongo 版 list 的 $lookup（device 按 deviceId 业务键、user 按 userId）在这里以
 * LEFT JOIN 承接（均无行放大：device_id 全表唯一、user 侧 PK 对一），出参组装回
 * device / user 形态；matchConditions 里落在 populate 字段上的
 * （ip/country/os/browser/userName）转为 JOIN 别名上的 ILIKE（$regex 'i' 等价）。
 */
@Injectable()
export class AppMonitorUserBasicRepository extends WalnutAdminCommonPgBaseRepository<AppMonitorUserEntity> {
  constructor(
    @InjectDataSource(WalnutPGConnectionName)
    dataSource: DataSource,
  ) {
    super(AppMonitorUserEntity, WalnutModelName.APP_MONITOR_USER, dataSource)
  }

  public async list<T>(
    params: IWalnutAdminRequestList<T>,
    _customize?: (qb: SelectQueryBuilder<AppMonitorUserEntity>) => void,
    em?: EntityManager,
  ): Promise<{ data: IAppMonitorUserListRow[], total: number }> {
    // 数据权限三期：注册实体的读路径必须进事务（withScopedManager 负责自动事务 +
    // RLS set_config），覆写 list 与基类同口径。
    return this.withScopedManager(em, async (manager) => {
      const qb = manager
        .createQueryBuilder(AppMonitorUserEntity, 'entity')
        .leftJoin('sys_device', 'device', 'device.device_id = entity.device_id')
        .leftJoin('sys_user', 'monitor_user', 'monitor_user.id = entity.user_id')

      applyPgListQuery(qb, 'entity', buildPgListQueryOptionsFromQb<T>(qb, params))

      // 数据权限：app_monitor_user 已注册（allowAnonymous —— 匿名访客行共享）
      this.applyDataScope(qb, 'entity')

      // Mongo 版 matchConditions：populate 字段上的 $regex('i') → JOIN 别名 ILIKE
      // （字面量转义走 pg-column-op 的 escapeLikePattern；非实体列被 applyPgListQuery 的白名单跳过，在此接管）
      //
      // 批次 4-A：这几个键（ip / country / os / browser / userName）是 JOIN 别名上的
      // **虚拟字段**，不是本实体的列 —— 按 filters 的 field 逐条取，非实体的部分由
      // applyPgListQuery 的列白名单跳过，在此接管。
      const filterValue = (field: string) => getFilterValue(params.filters, field)
      const ilike = (expression: string, key: string, raw: unknown) => {
        if (raw === null || raw === undefined || raw === '') {
          return
        }
        qb.andWhere(`${expression} ILIKE :${key}`, { [key]: `%${escapeLikePattern(String(raw))}%` })
      }
      ilike('device.ip', 'monitorDeviceIp', filterValue('ip'))
      ilike(`device.location_info->>'country'`, 'monitorCountry', filterValue('country'))
      ilike(`device.device_info->>'os'`, 'monitorOs', filterValue('os'))
      ilike(`device.device_info->>'browser'`, 'monitorBrowser', filterValue('browser'))
      ilike('monitor_user.user_name', 'monitorUserName', filterValue('userName'))

      // populate 出参列（别名与实体列错开；device.id 作 JOIN 命中标记），同趟带出 total 窗口列
      qb.addSelect('device.id', 'virtual_device_id')
      qb.addSelect('device.ip', 'virtual_device_ip')
      qb.addSelect(`device.device_info->>'os'`, 'virtual_device_os')
      qb.addSelect(`device.device_info->>'browser'`, 'virtual_device_browser')
      qb.addSelect(`device.device_info->>'type'`, 'virtual_device_type')
      qb.addSelect(`device.location_info->>'country'`, 'virtual_device_country')
      qb.addSelect('monitor_user.id', 'virtual_user_id')
      qb.addSelect('monitor_user.user_name', 'virtual_user_name')
      qb.addSelect(`COUNT(*) OVER()`, WALNUT_PG_LIST_TOTAL_ALIAS)

      const { raw, entities } = await qb.getRawAndEntities()

      const total = Number((raw[0] as Record<string, unknown> | undefined)?.[WALNUT_PG_LIST_TOTAL_ALIAS] ?? 0)

      // 单行 JOIN 无放大，raw 与 entities 逐行对齐；populate 对象按行并回
      const data = entities.map((entity, index) => {
        const row = raw[index] as Record<string, unknown> | undefined

        const populatedDeviceId = row?.virtual_device_id as string | undefined
        const populatedUserId = row?.virtual_user_id as string | undefined

        const device = populatedDeviceId != null
          ? {
              deviceInfo: {
                os: row?.virtual_device_os ?? null,
                browser: row?.virtual_device_browser ?? null,
                type: row?.virtual_device_type ?? null,
              },
              ip: (row?.virtual_device_ip as string | null) ?? null,
              locationInfo: { country: row?.virtual_device_country ?? null },
            }
          : null

        const user = populatedUserId != null
          ? { id: populatedUserId, userName: (row?.virtual_user_name as string | null) ?? null }
          : null

        return Object.assign(entity, { device, user })
      })

      return { data, total }
    }, { readOnly: true })
  }
}
