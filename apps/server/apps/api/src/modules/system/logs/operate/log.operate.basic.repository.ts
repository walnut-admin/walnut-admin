import type { DataSource } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { WalnutModelName, WalnutPGConnectionName } from '@walnut-server/db'

import { WalnutAdminCommonPgBaseRepository } from '@/common/repository/pg-base.repository'
import { SysLogOperateEntity } from './entity/log-operate.entity'

/**
 * B8 迁移（repo 层，B1 模板）：类名与文件名保持不变（DI token 不动 → service 零改动），
 * 基类从 Mongo 版 `WalnutAdminCommonBasicRepository` 换成 PG 版。
 *
 * 追加型审计大表：本模块无软删端点，list/readById 走基类默认实现即可。
 */
@Injectable()
export class SysLogOperateBasicRepository extends WalnutAdminCommonPgBaseRepository<SysLogOperateEntity> {
  constructor(
    @InjectDataSource(WalnutPGConnectionName)
    dataSource: DataSource,
  ) {
    super(SysLogOperateEntity, WalnutModelName.SYS_LOG_OPERATE, dataSource)
  }
}
