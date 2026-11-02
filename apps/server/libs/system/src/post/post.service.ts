import type { EntityManager } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { WalnutAdminExceptionBadRequest } from '@walnut-server/exceptions/base.exception'
import { WalnutAdminExceptionDataExists } from '@walnut-server/exceptions/base/400'

import { SysPostDTOCreateRequest, SysPostDTOListRequest, SysPostDTOUpdateRequest } from './dto/post.dto'
import { SysPostEntity } from './entity/post.entity'
import { SysPostBasicRepository } from './post.basic.repository'

/**
 * 岗位服务 —— 平表 CRUD。
 *
 * 删除策略：软删（快照进回收站），删除前校验「有职工引用」并回受控错误
 * （FK `fk_employee_post` RESTRICT 兜底）。岗位编码唯一冲突回 40001
 * （uq_post_code 兜底）。
 */
@Injectable()
export class SysPostService {
  constructor(private readonly postBasicRepo: SysPostBasicRepository) {}

  /**
   * @description create post (controller: create)
   */
  async create(dto: SysPostDTOCreateRequest) {
    await this.ensureCodeAvailable(dto.postCode)
    return this.postBasicRepo.create(dto)
  }

  /**
   * @description read post by id (controller: read)
   */
  async read(id: string) {
    return this.postBasicRepo.readById(id)
  }

  /**
   * @description update post (controller: update)
   */
  async update(id: string, dto: SysPostDTOUpdateRequest, em?: EntityManager) {
    const current = await this.postBasicRepo.readById(id, em)

    if (dto.postCode !== current.postCode) {
      await this.ensureCodeAvailable(dto.postCode, em)
    }

    // 显式列映射（PUT 语义）：remark 缺省即清空；sortOrder 缺省保持原值
    const payload: Partial<SysPostEntity> = {
      postCode: dto.postCode,
      postName: dto.postName,
      status: dto.status,
      remark: dto.remark ?? null,
    }
    if (typeof dto.sortOrder === 'number') {
      payload.sortOrder = dto.sortOrder
    }

    return this.postBasicRepo.update(id, payload, em)
  }

  /**
   * @description delete post (controller: delete) —— 软删进回收站
   */
  async delete(id: string, userId: string, em?: EntityManager) {
    await this.postBasicRepo.readById(id, em)

    if (await this.postBasicRepo.countEmployees(id, em) > 0) {
      throw new WalnutAdminExceptionBadRequest({ errMsg: 'business.system.post.hasEmployees' })
    }

    return this.postBasicRepo.deleteSoftById(id, userId, em)
  }

  /**
   * @description list posts (controller: list)
   */
  async list(params: SysPostDTOListRequest) {
    return this.postBasicRepo.list(params)
  }

  /**
   * @description 岗位编码重复 → 40001（DB 的 uq_post_code 是最后防线）
   */
  private async ensureCodeAvailable(postCode: string, em?: EntityManager) {
    const existed = await this.postBasicRepo.findByCode(postCode, em)
    if (existed !== null) {
      throw new WalnutAdminExceptionDataExists()
    }
  }
}
