import { Injectable, Logger } from '@nestjs/common'
import { WalnutDBInjectModel, WalnutDBModelName } from '@walnut/db'
import { ClientSession } from 'mongoose'

import { ISysMenuModel } from '../schema/menu.schema'

@Injectable()
export class SysMenuRepositoryService {
  private readonly logger = new Logger(SysMenuRepositoryService.name)

  constructor(
    @WalnutDBInjectModel(WalnutDBModelName.SYS_MENU)
    private readonly MenuModel: ISysMenuModel,
  ) { }

  /**
   * @description find all menus
   */
  async findAllMenus(dbSession?: ClientSession) {
    return this.MenuModel.find().session(dbSession!)
  }

  /**
   * @description find menu by id
   */
  async findMenuById(id: string, dbSession?: ClientSession) {
    return this.MenuModel.findById(id).session(dbSession!)
  }

  /**
   * @description find root menu (pid is undefined/null)
   */
  async findRootMenu(dbSession?: ClientSession) {
    return this.MenuModel.findOne({ pid: undefined }).session(dbSession!)
  }

  /**
   * @description find menus by ids
   */
  async findMenusByIds(ids: string[], dbSession?: ClientSession) {
    return this.MenuModel.find({ _id: { $in: ids } }).session(dbSession!)
  }
}
