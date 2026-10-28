import type { DataSource } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { WalnutModelName, WalnutPGConnectionName } from '@walnut-server/db'

import { WalnutAdminCommonPgBaseRepository } from '@/common/repository/pg-base.repository'
import { SysMenuEntity } from './entity/menu.entity'

/**
 * B5 迁移模板（repo 层）：类名与文件名保持不变（DI token 不动 → service 零改动），
 * 基类从 Mongo 版 `WalnutAdminCommonBasicRepository` 换成 PG 版。本模块无特殊查询
 * （findAllMenus / findRootMenu 在 repo.service，菜单树组装对照 Mongo 版单次全量查询），
 * 基类方法面原样够用。
 */
@Injectable()
export class SysMenuBasicRepository extends WalnutAdminCommonPgBaseRepository<SysMenuEntity> {
  constructor(
    @InjectDataSource(WalnutPGConnectionName)
    dataSource: DataSource,
  ) {
    super(SysMenuEntity, WalnutModelName.SYS_MENU, dataSource)
  }
}
