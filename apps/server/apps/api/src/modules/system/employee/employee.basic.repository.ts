/* eslint-disable no-restricted-syntax -- 职工模块的系统前置校验：工号/绑定账号的唯一性判断与账号存在性检查必须全库口径（数据权限过滤会让重复工号在 scoped 视图里"看不见"而漏拦）。 */
import type { DataSource, EntityManager } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { WalnutModelName, WalnutPGConnectionName, withWalnutSystemManager } from '@walnut-server/db'

import { WalnutAdminCommonPgBaseRepository } from '@walnut-server/repository'
import { SysUserEntity } from '../user/entity/user.entity'
import { SysEmployeeEntity } from './entity/employee.entity'

/**
 * 职工基础仓库。
 *
 * - `findByEmployeeNo` / `findByUserId`：业务唯一键点查（uq_employee_no、partial
 *   uq_employee_user），服务层用它们做「工号重复」「一号一职工」的前置受控校验；
 * - `countUserById`：绑定前的账号存在性校验。`sys_employee.user_id` 是**松引用
 *   （无 FK）**，数据库不会帮我们拦「绑定到不存在的账号」，所以存在性必须由应用层查
 *   sys_user —— 与「账号删除不级联销毁人事记录」是一个取舍的两面。
 */
@Injectable()
export class SysEmployeeBasicRepository extends WalnutAdminCommonPgBaseRepository<SysEmployeeEntity> {
  constructor(
    @InjectDataSource(WalnutPGConnectionName)
    dataSource: DataSource,
  ) {
    super(SysEmployeeEntity, WalnutModelName.SYS_EMPLOYEE, dataSource)
  }

  /**
   * @description 按工号点查（uq_employee_no）
   */
  public async findByEmployeeNo(employeeNo: string, em?: EntityManager): Promise<SysEmployeeEntity | null> {
    // 数据权限三期：系统前置校验（全库口径），无 em 时走 system 事务
    return withWalnutSystemManager(this.dataSource, em, async manager =>
      manager.getRepository(SysEmployeeEntity).findOne({ where: { employeeNo } }))
  }

  /**
   * @description 按绑定账号点查（uq_employee_user partial：未绑定的 NULL 行不会命中）
   */
  public async findByUserId(userId: string, em?: EntityManager): Promise<SysEmployeeEntity | null> {
    return withWalnutSystemManager(this.dataSource, em, async manager =>
      manager.getRepository(SysEmployeeEntity).findOne({ where: { userId } }))
  }

  /**
   * @description 绑定前的账号存在性计数（松引用无 FK，存在性由应用层保证）
   */
  public async countUserById(userId: string, em?: EntityManager): Promise<number> {
    return withWalnutSystemManager(this.dataSource, em, async manager =>
      manager.getRepository(SysUserEntity).count({ where: { id: userId } }))
  }
}
