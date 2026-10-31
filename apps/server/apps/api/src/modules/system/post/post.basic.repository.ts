import type { DataSource, EntityManager } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { WalnutModelName, WalnutPGConnectionName, withWalnutSystemManager } from '@walnut-server/db'

import { WalnutAdminCommonPgBaseRepository } from '@walnut-server/repository'
import { SysEmployeeEntity } from '../employee/entity/employee.entity'
import { SysPostEntity } from './entity/post.entity'

/**
 * 岗位基础仓库（平表，无特殊查询）。引用计数供删除前置校验 —— 与 dept 同口径：
 * employee 模块依赖 post 模块（单向），反向计数走实体仓库，不注入 employee 模块。
 */
@Injectable()
export class SysPostBasicRepository extends WalnutAdminCommonPgBaseRepository<SysPostEntity> {
  constructor(
    @InjectDataSource(WalnutPGConnectionName)
    dataSource: DataSource,
  ) {
    super(SysPostEntity, WalnutModelName.SYS_POST, dataSource)
  }

  /**
   * @description 按业务键点查（uq_post_code）
   */
  public async findByCode(postCode: string, em?: EntityManager): Promise<SysPostEntity | null> {
    return this.getManager(em).getRepository(SysPostEntity).findOne({ where: { postCode } })
  }

  /**
   * @description 主键点查（查无返回 null；调用方要把「岗位不存在」翻译成受控 400）
   */
  public async findById(id: string, em?: EntityManager): Promise<SysPostEntity | null> {
    return this.getManager(em).getRepository(SysPostEntity).findOne({ where: { id } })
  }

  /**
   * @description 有职工计数（删除前置校验用；FK RESTRICT 是最后防线）
   */
  public async countEmployees(postId: string, em?: EntityManager): Promise<number> {
    return withWalnutSystemManager(this.dataSource, em, async manager =>
      // eslint-disable-next-line no-restricted-syntax -- 删除前置计数必须全库口径（理由同 dept.countEmployees）；这里已显式走 system 事务
      manager.getRepository(SysEmployeeEntity).count({ where: { postId } }))
  }
}
