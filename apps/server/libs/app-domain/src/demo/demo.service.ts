import type { EntityManager } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { AppDemoBasicRepository } from './demo.basic.repository'
import {
  AppDemoDTOCreateRequest,
  AppDemoDTOListRequest,
  AppDemoDTOUpdateRequest,
} from './dto/demo.dto'

/**
 * B1 迁移模板（service 层）：除事务句柄签名 `dbSession?: ClientSession` →
 * `em?: EntityManager`（纯透传给 repo，取自 `WalnutTxContext.em`）外零逻辑改动。
 */
@Injectable()
export class AppDemoService {
  constructor(private readonly demoBasicRepo: AppDemoBasicRepository) { }

  async create(payload: AppDemoDTOCreateRequest) {
    return this.demoBasicRepo.create(payload)
  }

  async read(id: string) {
    return this.demoBasicRepo.readById(id)
  }

  async update(id: string, payload: AppDemoDTOUpdateRequest) {
    return this.demoBasicRepo.update(id, payload)
  }

  async delete(id: string, userId: string, em?: EntityManager) {
    return this.demoBasicRepo.deleteSoftById(id, userId, em)
  }

  async deleteMany(ids: string[], userId: string, em?: EntityManager) {
    return this.demoBasicRepo.deleteSoftByIdMany(ids, userId, em)
  }

  async list(payload: AppDemoDTOListRequest) {
    return this.demoBasicRepo.list(payload)
  }
}
