import type { DataSource } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { WalnutDBModelName, WalnutPGConnectionName } from '@walnut-server/db'

import { WalnutAdminCommonPgBaseRepository } from '@/common/repository/pg-base.repository'
import { SysLocaleEntity } from './entity/locale.entity'

/**
 * B2 迁移模板（repo 层）：类名与文件名保持不变（DI token 不动），基类换成 PG 版。
 */
@Injectable()
export class SysLocaleBasicRepository extends WalnutAdminCommonPgBaseRepository<SysLocaleEntity> {
  constructor(
    @InjectDataSource(WalnutPGConnectionName)
    dataSource: DataSource,
  ) {
    super(SysLocaleEntity, WalnutDBModelName.SYS_LOCALE, dataSource)
  }
}
