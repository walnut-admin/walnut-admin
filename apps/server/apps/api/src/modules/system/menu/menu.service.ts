import type { ClientSession } from 'mongoose'
import type { EntityManager } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { SysLocaleSharedService } from '../locale/shared/locale.shared.service'
import {
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
    return this.menuBasicRepo.create(dto)
  }

  async read(id: string) {
    return this.menuBasicRepo.readById(id)
  }

  async update(id: string, dto: SysMenuDTOUpdateRequest) {
    // TODO remove all cache auth data when menu changed
    return this.menuBasicRepo.update(id, dto)
  }

  /**
   * B2 迁移接线：locale 已迁 PG，级联删 locale 需要事务内的 PG 句柄 em —— menu 本体
   * 仍是 Mongo（B5），两个句柄并存透传，事务语义不变。
   */
  async delete(id: string, userId: string, cascade: number, dbSession: ClientSession, em?: EntityManager) {
    const deletedMenu = await this.menuBasicRepo.deleteSoftById(id, userId, dbSession)

    if (cascade === 1) {
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
