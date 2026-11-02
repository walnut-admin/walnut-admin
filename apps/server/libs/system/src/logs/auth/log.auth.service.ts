import type { EntityManager } from 'typeorm'
import { Injectable } from '@nestjs/common'

import { SysLogAuthDTO, SysLogAuthDTOListRequest } from './dto/log.auth.dto'
import { SysLogAuthBasicRepository } from './log.auth.basic.repository'
import { SysLogAuthRepoService } from './repo/log.auth.repo.service'

/**
 * Log Auth Service
 *
 * This service has 1:1 mapping with controller endpoints.
 * NO direct Model usage - all data access through Repository/Repo Service layer.
 *
 * B8 迁移（service 层，B1 模板）：事务句柄签名 `dbSession: ClientSession` →
 * `em?: EntityManager`（取自 WalnutTxContext.em 纯透传）；create 走 PG 旁路写
 * （repo 刻意不收事务句柄，见 log.auth.repo.service）。
 */
@Injectable()
export class SysLogAuthService {
  constructor(
    private readonly logAuthBasicRepo: SysLogAuthBasicRepository,
    private readonly logAuthRepoService: SysLogAuthRepoService,
  ) {}

  /**
   * @description create auth log (controller: create)
   */
  async create(dto: SysLogAuthDTO) {
    return this.logAuthRepoService.create(dto)
  }

  /**
   * @description delete auth log (controller: delete)
   */
  async delete(id: string, userId: string, em?: EntityManager) {
    return this.logAuthBasicRepo.deleteSoftById(id, userId, em)
  }

  /**
   * @description batch delete (controller: deleteMany)
   */
  async deleteMany(ids: string[], userId: string, em?: EntityManager) {
    return this.logAuthBasicRepo.deleteSoftByIdMany(ids, userId, em)
  }

  /**
   * @description list auth logs (controller: list)
   */
  async list(params: SysLogAuthDTOListRequest) {
    return this.logAuthBasicRepo.list(params)
  }
}
