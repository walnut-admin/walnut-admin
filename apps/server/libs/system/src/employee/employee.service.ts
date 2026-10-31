import type { EntityManager } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { WalnutAdminExceptionBadRequest } from '@walnut-server/exceptions/base.exception'
import { WalnutAdminExceptionDataExists } from '@walnut-server/exceptions/base/400'

import { SysDeptBasicRepository } from '../dept/dept.basic.repository'
import { SysPostBasicRepository } from '../post/post.basic.repository'
import {
  SysEmployeeDTOCreateRequest,
  SysEmployeeDTOListRequest,
  SysEmployeeDTOUpdateRequest,
} from './dto/employee.dto'
import { SysEmployeeBasicRepository } from './employee.basic.repository'
import { SysEmployeeEntity } from './entity/employee.entity'

/**
 * 职工服务 —— CRUD + 账号绑定 / 解绑。
 *
 * 关键语义（表注释同口径）：
 * - **一号一职工**：`sys_employee.user_id` 的 partial unique（WHERE user_id IS NOT NULL）
 *   是数据库级保证；服务层的 `ensureUserNotBound` 前置查重把它翻译成受控 40001
 *   （并发窗口由唯一索引兜底）。
 * - **松引用无 FK**：`user_id` 指向 sys_user 但不建外键 —— 账号彻底删除不级联销毁人事
 *   记录。代价是绑定前必须由应用层校验账号存在（`countUserById`）。
 * - **离职不删账号**：status 只是人事事实，改成 resigned 不会删除/解绑 sys_user；
 *   账号生命周期（禁用 / 删除）走账号侧自己的通道。
 * - 部门 / 岗位引用都是 RESTRICT：校验存在性后落库，FK 是最后防线。
 */
@Injectable()
export class SysEmployeeService {
  constructor(
    private readonly employeeBasicRepo: SysEmployeeBasicRepository,
    private readonly deptBasicRepo: SysDeptBasicRepository,
    private readonly postBasicRepo: SysPostBasicRepository,
  ) {}

  /**
   * @description create employee (controller: create)
   */
  async create(dto: SysEmployeeDTOCreateRequest) {
    await this.ensureEmployeeNoAvailable(dto.employeeNo)
    await this.ensureDeptExists(dto.deptId)

    if (dto.postId !== null && dto.postId !== undefined) {
      await this.ensurePostExists(dto.postId)
    }

    // 账号绑定不进 create 白名单：新职工先录入人事档案，绑定走 bind-user 动作端点
    return this.employeeBasicRepo.create(dto)
  }

  /**
   * @description read employee by id (controller: read)
   */
  async read(id: string) {
    return this.employeeBasicRepo.readById(id)
  }

  /**
   * @description update employee (controller: update)
   */
  async update(id: string, dto: SysEmployeeDTOUpdateRequest, em?: EntityManager) {
    const current = await this.employeeBasicRepo.readById(id, em)

    if (dto.employeeNo !== current.employeeNo) {
      await this.ensureEmployeeNoAvailable(dto.employeeNo, em)
    }

    await this.ensureDeptExists(dto.deptId, em)

    if (dto.postId !== null && dto.postId !== undefined) {
      await this.ensurePostExists(dto.postId, em)
    }

    // 显式列映射（PUT 语义）：postId 缺省即 null（未定岗）；**userId 不入 payload** ——
    // 绑定关系只经 bind-user / unbind-user 变更，编辑人事档案不会顺手解绑账号
    const payload: Partial<SysEmployeeEntity> = {
      employeeNo: dto.employeeNo,
      employeeName: dto.employeeName,
      deptId: dto.deptId,
      postId: dto.postId ?? null,
      entryDate: dto.entryDate,
      status: dto.status,
    }

    return this.employeeBasicRepo.update(id, payload, em)
  }

  /**
   * @description delete employee (controller: delete) —— 软删进回收站
   */
  async delete(id: string, userId: string, em?: EntityManager) {
    return this.employeeBasicRepo.deleteSoftById(id, userId, em)
  }

  /**
   * @description list employees (controller: list)
   */
  async list(params: SysEmployeeDTOListRequest) {
    return this.employeeBasicRepo.list(params)
  }

  /**
   * @description bind employee to a login account (controller: bindUser)
   */
  async bindUser(id: string, userId: string, em?: EntityManager) {
    await this.employeeBasicRepo.readById(id, em)
    await this.ensureUserExists(userId, em)
    await this.ensureUserNotBound(userId, id, em)

    return this.employeeBasicRepo.update(id, { userId }, em)
  }

  /**
   * @description unbind employee from its login account (controller: unbindUser)
   * 幂等：未绑定时原样返回（对齐 password/clear 的幂等语义，UI 双击安全）。
   */
  async unbindUser(id: string, em?: EntityManager) {
    const employee = await this.employeeBasicRepo.readById(id, em)

    if (employee.userId === null) {
      return employee
    }

    return this.employeeBasicRepo.update(id, { userId: null }, em)
  }

  /**
   * @description 工号重复 → 40001（含「更新成别人的工号」；uq_employee_no 兜底）
   */
  private async ensureEmployeeNoAvailable(employeeNo: string, em?: EntityManager) {
    const existed = await this.employeeBasicRepo.findByEmployeeNo(employeeNo, em)
    if (existed !== null) {
      throw new WalnutAdminExceptionDataExists()
    }
  }

  private async ensureDeptExists(deptId: string, em?: EntityManager) {
    const dept = await this.deptBasicRepo.findById(deptId, em)
    if (dept === null) {
      throw new WalnutAdminExceptionBadRequest({ errMsg: 'business.system.employee.deptNotFound' })
    }
  }

  private async ensurePostExists(postId: string, em?: EntityManager) {
    const post = await this.postBasicRepo.findById(postId, em)
    if (post === null) {
      throw new WalnutAdminExceptionBadRequest({ errMsg: 'business.system.employee.postNotFound' })
    }
  }

  private async ensureUserExists(userId: string, em?: EntityManager) {
    if (await this.employeeBasicRepo.countUserById(userId, em) === 0) {
      throw new WalnutAdminExceptionBadRequest({ errMsg: 'business.system.employee.userNotFound' })
    }
  }

  /**
   * @description 一号一职工：该账号已被**其他**职工绑定 → 40001。
   * selfId 用于 update / bind 场景排除职工自身（重复绑定同一账号是幂等的）。
   */
  private async ensureUserNotBound(userId: string, selfId?: string, em?: EntityManager) {
    const existed = await this.employeeBasicRepo.findByUserId(userId, em)
    if (existed !== null && existed.id !== selfId) {
      throw new WalnutAdminExceptionDataExists()
    }
  }
}
