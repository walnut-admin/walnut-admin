import type { DataSource } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { WalnutModelName, WalnutPGConnectionName } from '@walnut-server/db'

import { WalnutAdminCommonPgBaseRepository } from '@/common/repository/pg-base.repository'
import { SysLogAuthEntity } from './entity/log-auth.entity'

/**
 * B8 迁移（repo 层，B1 模板）：类名与文件名保持不变（DI token 不动 → service 零改动），
 * 基类从 Mongo 版 `WalnutAdminCommonBasicRepository` 换成 PG 版；delete/deleteMany
 * 走基类 deleteSoftById(Many)（快照进 PG sys_deleted，B9 归一回收站读侧）。
 */
@Injectable()
export class SysLogAuthBasicRepository extends WalnutAdminCommonPgBaseRepository<SysLogAuthEntity> {
  constructor(
    @InjectDataSource(WalnutPGConnectionName)
    dataSource: DataSource,
  ) {
    super(SysLogAuthEntity, WalnutModelName.SYS_LOG_AUTH, dataSource)
  }
}
