import type { DataSource } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { WalnutModelName, WalnutPGConnectionName } from '@walnut-server/db'

import { WalnutAdminCommonPgBaseRepository } from '@walnut-server/repository'
import { AppDemoEntity } from './entity/demo.entity'

/**
 * B1 迁移模板（repo 层）：类名与文件名保持不变（DI token 不动 → service 零改动），
 * 基类从 Mongo 版 `WalnutAdminCommonBasicRepository` 换成 PG 版；特有方法（本模块无）
 * 对照 Mongo 版逐个用 QueryBuilder / `customize` 迁移，不拼原生 SQL。
 */
@Injectable()
export class AppDemoBasicRepository extends WalnutAdminCommonPgBaseRepository<AppDemoEntity> {
  constructor(
    @InjectDataSource(WalnutPGConnectionName)
    dataSource: DataSource,
  ) {
    super(AppDemoEntity, WalnutModelName.APP_DEMO, dataSource)
  }
}
