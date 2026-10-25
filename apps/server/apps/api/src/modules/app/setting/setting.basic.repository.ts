import type { DataSource } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { WalnutDBModelName, WalnutPGConnectionName } from '@walnut-server/db'

import { WalnutAdminCommonPgBaseRepository } from '@/common/repository/pg-base.repository'
import { AppSettingEntity } from './entity/setting.entity'

/**
 * B4 迁移（repo 层，模板同 demo）：类名与文件名保持不变（DI token 不动），基类从
 * Mongo 版 `WalnutAdminCommonBasicRepository` 换成 PG 版；本模块无特殊查询 ——
 * 按 key 的读写走 `repo/setting.repo.service.ts`（跨模块消费的仓库服务）。
 */
@Injectable()
export class AppSettingBasicRepository extends WalnutAdminCommonPgBaseRepository<AppSettingEntity> {
  constructor(
    @InjectDataSource(WalnutPGConnectionName)
    dataSource: DataSource,
  ) {
    super(AppSettingEntity, WalnutDBModelName.APP_SETTING, dataSource)
  }
}
