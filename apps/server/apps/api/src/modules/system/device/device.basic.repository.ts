import type { DataSource } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { WalnutModelName, WalnutPGConnectionName } from '@walnut-server/db'

import { WalnutAdminCommonPgBaseRepository } from '@walnut-server/repository'
import { SysDeviceEntity } from './entity/device.entity'

/**
 * B6 迁移模板（repo 层）：类名与文件名保持不变（DI token 不动），基类从 Mongo 版
 * `WalnutAdminCommonBasicRepository` 换成 PG 版。device 自身的 CRUD 全走基类公共面；
 * 按业务键 device_id 的特有查询在 `SysDeviceRepositoryService`（QueryBuilder 语义对照
 * Mongo 版，不拼原生 SQL）。
 */
@Injectable()
export class SysDeviceBasicRepository extends WalnutAdminCommonPgBaseRepository<SysDeviceEntity> {
  constructor(
    @InjectDataSource(WalnutPGConnectionName)
    dataSource: DataSource,
  ) {
    super(SysDeviceEntity, WalnutModelName.SYS_DEVICE, dataSource)
  }
}
