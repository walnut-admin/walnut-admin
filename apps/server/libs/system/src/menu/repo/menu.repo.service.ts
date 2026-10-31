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
 * （findAllMenus 全量、findAllRootMenus 取全部 pid 为空的根、findMenusByIds $in → In）。
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
   * @description find all root menus（P3-18：DDL 没有「单根」唯一性约束，多根部署下
   * 非 root 用户的 permission tree 需要全部根才能把授权菜单挂回各自根节点）。
   * 排序按 meta.order（列 sort_order）+ createdAt，保证多根拼接顺序确定。
   *
   * 旧 `findRootMenu`（findOne）随 P3-18 退役：单根口径会把其他根的子树整棵丢弃。
   */
  async findAllRootMenus(em?: EntityManager) {
    return this.getRepository(em).find({
      where: { pid: IsNull() },
      order: { order: 'ASC', createdAt: 'ASC' },
    })
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
