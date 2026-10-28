import type { DataSource } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'

import { WalnutModelName, WalnutPGConnectionName } from '@walnut-server/db'
import { WalnutAdminCommonPgBaseRepository } from '@/common/repository/pg-base.repository'

import { SysUserOauthEntity } from './entity/user-oauth.entity'

/**
 * B7a 迁移模板（repo 层）：类名与文件名保持不变（DI token 不动），基类换成 PG 版
 * （B1 确立）。本模块无特殊查询 —— upsert 语义的绑定写在 SysUserOAuthRepositoryService。
 */
@Injectable()
export class SysUserOAuthBasicRepository extends WalnutAdminCommonPgBaseRepository<SysUserOauthEntity> {
  constructor(
    @InjectDataSource(WalnutPGConnectionName)
    dataSource: DataSource,
  ) {
    super(SysUserOauthEntity, WalnutModelName.SYS_USER_OAUTH, dataSource)
  }
}
