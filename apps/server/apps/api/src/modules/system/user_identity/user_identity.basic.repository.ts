import type { DataSource } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'

import { WalnutModelName, WalnutPGConnectionName } from '@walnut-server/db'
import { WalnutAdminCommonPgBaseRepository } from '@/common/repository/pg-base.repository'

import { SysUserIdentityEntity } from './entity/user-identity.entity'

/**
 * B7a 迁移模板（repo 层）：类名与文件名保持不变（DI token 不动），基类从 Mongo 版
 * `WalnutAdminCommonBasicRepository` 换成 PG 版（B1 确立）。本模块无特殊查询 ——
 * 带 key 的读写走 SysUserIdentityRepositoryService，base CRUD 走本类。
 */
@Injectable()
export class SysUserIdentityBasicRepository extends WalnutAdminCommonPgBaseRepository<SysUserIdentityEntity> {
  constructor(
    @InjectDataSource(WalnutPGConnectionName)
    dataSource: DataSource,
  ) {
    super(SysUserIdentityEntity, WalnutModelName.SYS_USER_IDENTITY, dataSource)
  }
}
