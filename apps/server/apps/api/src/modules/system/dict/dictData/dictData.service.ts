import type { EntityManager } from 'typeorm'
import { Injectable } from '@nestjs/common'

import { SysLocaleSharedService } from '../../locale/shared/locale.shared.service'
import { SysDictDataBasicRepository } from './dictData.basic.repository'
import {
  SysDictDataDTOCreateRequest,
  SysDictDataDTOListRequest,
  SysDictDataDTOUpdateRequest,
} from './dto/dictData.dto'
import { SysDictDataEntity } from './entity/dict-data.entity'

@Injectable()
export class SysDictDataService {
  constructor(
    private readonly dictDataBasicRepo: SysDictDataBasicRepository,
    private readonly localeSharedService: SysLocaleSharedService,
  ) {}

  // base CRUD
  async create(dto: SysDictDataDTOCreateRequest) {
    return this.dictDataBasicRepo.create(dto)
  }

  async read(id: string) {
    return this.dictDataBasicRepo.readById(id)
  }

  async update(id: string, dto: SysDictDataDTOUpdateRequest) {
    return this.dictDataBasicRepo.update(id, dto)
  }

  async delete(id: string, userId: string, em: EntityManager) {
    const deletedDictData: SysDictDataEntity = await this.dictDataBasicRepo.deleteSoftById(id, userId, em)

    // delete all locales with deleted dict data label
    await this.localeSharedService.deleteByKey(deletedDictData.label, userId, em)

    return deletedDictData
  }

  async list(params: SysDictDataDTOListRequest) {
    return this.dictDataBasicRepo.list(params)
  }
}
