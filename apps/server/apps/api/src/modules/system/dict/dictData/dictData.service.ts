import { Injectable } from '@nestjs/common'
import { WalnutDBInjectModel, WalnutDBModelName } from '@walnut-server/db'
import { ClientSession } from 'mongoose'

import { SysLocaleSharedService } from '../../locale/shared/locale.shared.service'
import { SysDictDataBasicRepository } from './dictData.basic.repository'
import {
  SysDictDataDTOCreateRequest,
  SysDictDataDTOListRequest,
  SysDictDataDTOUpdateRequest,
} from './dto/dictData.dto'
import { ISysDictDataModel } from './schema/dictData.schema'

@Injectable()
export class SysDictDataService {
  constructor(
    @WalnutDBInjectModel(WalnutDBModelName.SYS_DICT_DATA)
    private readonly dictDataModel: ISysDictDataModel,
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

  async delete(id: string, userId: string, dbSession: ClientSession) {
    const deletedDictData = await this.dictDataBasicRepo.deleteSoftById(id, userId, dbSession)

    // delete all locales with deleted dict data label
    await this.localeSharedService.deleteByKey(deletedDictData.label, userId, dbSession)

    return deletedDictData
  }

  async list(params: SysDictDataDTOListRequest) {
    return this.dictDataBasicRepo.list(params)
  }
}
