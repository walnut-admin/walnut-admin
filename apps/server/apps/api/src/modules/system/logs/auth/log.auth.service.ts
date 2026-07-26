import { Injectable } from '@nestjs/common'
import { ClientSession } from 'mongoose'

import { SysLogAuthDTO, SysLogAuthDTOListRequest } from './dto/log.auth.dto'
import { SysLogAuthBasicRepository } from './log.auth.basic.repository'
import { SysLogAuthRepoService } from './repo/log.auth.repo.service'

/**
 * Log Auth Service
 *
 * This service has 1:1 mapping with controller endpoints.
 * NO direct Model usage - all data access through Repository/Repo Service layer.
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
  async create(dto: Omit<SysLogAuthDTO, '_id'>, dbSession?: ClientSession) {
    return this.logAuthRepoService.create(dto, dbSession)
  }

  /**
   * @description delete auth log (controller: delete)
   */
  async delete(id: string, userId: string, dbSession: ClientSession) {
    return this.logAuthBasicRepo.deleteSoftById(id, userId, dbSession)
  }

  /**
   * @description batch delete (controller: deleteMany)
   */
  async deleteMany(ids: string[], userId: string, dbSession: ClientSession) {
    return this.logAuthBasicRepo.deleteSoftByIdMany(ids, userId, dbSession)
  }

  /**
   * @description list auth logs (controller: list)
   */
  async list(params: SysLogAuthDTOListRequest) {
    return this.logAuthBasicRepo.list(params)
  }
}
