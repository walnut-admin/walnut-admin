import type { DataSource } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { WalnutDBModelName, WalnutPGConnectionName } from '@walnut-server/db'

import { WalnutAdminCommonPgBaseRepository } from '@/common/repository/pg-base.repository'
import { AppErrorEntity } from './entity/error.entity'

/**
 * B1 迁移模板（repo 层，error 模块原先无 repo、service 直持 model —— 随迁移补齐）：
 * 基类用 PG 版 `WalnutAdminCommonPgBaseRepository`；错误写入是旁路 fire-and-forget，
 * 只用 create（非事务路径，不传 em），不继承软删/列表语义。
 */
@Injectable()
export class AppErrorBasicRepository extends WalnutAdminCommonPgBaseRepository<AppErrorEntity> {
  constructor(
    @InjectDataSource(WalnutPGConnectionName)
    dataSource: DataSource,
  ) {
    super(AppErrorEntity, WalnutDBModelName.APP_ERROR, dataSource)
  }
}
