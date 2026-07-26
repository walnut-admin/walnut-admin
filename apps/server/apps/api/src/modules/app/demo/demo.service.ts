import { Injectable } from '@nestjs/common'
import { ClientSession } from 'mongoose'
import { AppDemoBasicRepository } from './demo.basic.repository'
import {
  AppDemoDTOCreateRequest,
  AppDemoDTOListRequest,
  AppDemoDTOUpdateRequest,
} from './dto/demo.dto'

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

  async delete(id: string, userId: string, dbSession: ClientSession) {
    return this.demoBasicRepo.deleteSoftById(id, userId, dbSession)
  }

  async deleteMany(ids: string[], userId: string, dbSession: ClientSession) {
    return this.demoBasicRepo.deleteSoftByIdMany(ids, userId, dbSession)
  }

  async list(payload: AppDemoDTOListRequest) {
    return this.demoBasicRepo.list(payload)
  }
}
