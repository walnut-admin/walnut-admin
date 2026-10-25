import type { DataSource, EntityManager } from 'typeorm'
import { Injectable, Logger } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'
import { In, IsNull } from 'typeorm'

import { SysMenuEntity } from '../entity/menu.entity'

/**
 * Menu Repository Service
 *
 * Provides simple CRUD operations for cross-module access.
 * NO business logic - only data access.
 *
 * B5 迁移：Mongo model → PG 命名连接 DataSource，查询语义逐一对齐 Mongo 版
 * （findAllMenus 全量、findRootMenu 取 pid 为空的根、findMenusByIds $in → In）。
 * 菜单树组装（children）对照 Mongo 版口径：**单次全量查询 + 内存建树**，不做
 * 逐层懒加载（phase3-plan §1 B5「克制实现」，同 area 批口径）。
 */
@Injectable()
export class SysMenuRepositoryService {
  private readonly logger = new Logger(SysMenuRepositoryService.name)

  constructor(
    @InjectDataSource(WalnutPGConnectionName)
    private readonly dataSource: DataSource,
  ) {}

  /**
   * @description find all menus（对应 Mongo 版 find() 全量；dbSession → em 纯透传）
   */
  async findAllMenus(em?: EntityManager) {
    return this.getRepository(em).find()
  }

  /**
   * @description find menu by id
   */
  async findMenuById(id: string, em?: EntityManager) {
    return this.getRepository(em).findOne({ where: { id } })
  }

  /**
   * @description find root menu (pid is null —— 根节点 pid=NULL，phase2 4.3；
   * 对齐 Mongo 版 findOne({ pid: undefined }))
   */
  async findRootMenu(em?: EntityManager) {
    return this.getRepository(em).findOne({ where: { pid: IsNull() } })
  }

  /**
   * @description find menus by ids（$in → In(uuid[])，phase3-plan §4）
   */
  async findMenusByIds(ids: string[], em?: EntityManager) {
    if (ids.length === 0) {
      return []
    }

    return this.getRepository(em).find({ where: { id: In(ids) } })
  }

  private getRepository(em?: EntityManager) {
    return (em ?? this.dataSource.manager).getRepository(SysMenuEntity)
  }
}
