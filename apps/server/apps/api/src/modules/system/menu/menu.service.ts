import type { EntityManager } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { SysLocaleSharedService } from '../locale/shared/locale.shared.service'
import {
  flattenSysMenuMeta,
  SysMenuDTOCreateRequest,
  SysMenuDTOListRequest,
  SysMenuDTOUpdateRequest,
} from './dto/menu.dto'
import { SysMenuBasicRepository } from './menu.basic.repository'
import { SysMenuSharedService } from './shared/menu.shared.service'

@Injectable()
export class SysMenuService {
  constructor(
    private readonly menuBasicRepo: SysMenuBasicRepository,
    private readonly menuSharedService: SysMenuSharedService,
    private readonly localeSharedService: SysLocaleSharedService,
  ) { }

  /**
   * @description get full menu tree (delegate to shared)
   */
  async getMenuTreeAndTreeWithoutTypeElement() {
    return this.menuSharedService.getMenuTreeAndTreeWithoutTypeElement()
  }

  // base CRUD
  async create(dto: SysMenuDTOCreateRequest) {
    // TODO remove all cache auth data when menu changed
    // meta 对象 → 19 个拍平列（B5；meta 缺省时零列，DB 默认值兜底）
    return this.menuBasicRepo.create(flattenSysMenuMeta(dto))
  }

  async read(id: string) {
    return this.menuBasicRepo.readById(id)
  }

  async update(id: string, dto: SysMenuDTOUpdateRequest) {
    // TODO remove all cache auth data when menu changed
    // meta 给 出时 19 列全量产出（未给键回填 schema 默认值），对齐 Mongo 版整体替换
    // meta 子文档的语义；meta 未给 时 meta 列原样不动
    return this.menuBasicRepo.update(id, flattenSysMenuMeta(dto))
  }

  /**
   * B5 迁移：menu 本体已迁 PG，级联删 locale 也是 PG —— 单一 em 句柄贯通
   * （软删 menu + sys_deleted 快照 + 级联 locale 同一事务）。
   * title 为空的菜单没有对应 locale（key 非空列），跳过级联与 Mongo 版
   * 「按 undefined 键删除命中 0 行」的行为等价。
   */
  async delete(id: string, userId: string, cascade: number, em?: EntityManager) {
    const deletedMenu = await this.menuBasicRepo.deleteSoftById(id, userId, em)

    if (cascade === 1 && deletedMenu.title !== null) {
      // delete all locales with deleted menu title
      await this.localeSharedService.deleteByKey(deletedMenu.title, userId, em)
    }

    // TODO remove all cache auth data when menu changed

    return deletedMenu
  }

  async list(params: SysMenuDTOListRequest) {
    return this.menuBasicRepo.list(params)
  }
}
