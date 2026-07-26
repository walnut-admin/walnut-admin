import { Injectable } from '@nestjs/common'
import { WalnutDBCollectionName, WalnutDBInjectModel, WalnutDBModelName } from '@walnut-server/db'
import { ClientSession } from 'mongoose'

import { ISysDictDataDocument } from '../dictData/schema/dictData.schema'

import { SysDictTypeBasicRepository } from './dictType.basic.repository'
import {
  SysDictTypeDTOCreateRequest,
  SysDictTypeDTOListRequest,
  SysDictTypeDTOUpdateRequest,
} from './dto/dictType.dto'
import { ISysDictTypeModel } from './schema/dictType.schema'

@Injectable()
export class SysDictTypeService {
  constructor(
    @WalnutDBInjectModel(WalnutDBModelName.SYS_DICT_TYPE)
    private readonly dictTypeModel: ISysDictTypeModel,
    private readonly dictTypeBasicRepo: SysDictTypeBasicRepository,
  ) {}

  // base CRUD
  async create(dto: SysDictTypeDTOCreateRequest) {
    return this.dictTypeBasicRepo.create(dto)
  }

  async read(id: string) {
    return this.dictTypeBasicRepo.readById(id)
  }

  async update(id: string, dto: SysDictTypeDTOUpdateRequest) {
    return this.dictTypeBasicRepo.update(id, dto)
  }

  async delete(id: string, userId: string, dbSession: ClientSession) {
    return this.dictTypeBasicRepo.deleteSoftById(id, userId, dbSession)
  }

  async list(params: SysDictTypeDTOListRequest) {
    return this.dictTypeBasicRepo.list(params, [
      {
        $lookup: {
          from: WalnutDBCollectionName.DICT_DATA,
          localField: '_id',
          foreignField: 'typeId',
          as: 'count',
        },
      },
      { $addFields: { populated_dictDataCount: { $size: '$count' } } },
      { $unset: 'count' },
    ])
  }

  /**
   * @description: get dict by type
   */
  async getByType(type: string) {
    const dictType = await this.dictTypeModel.findOne({ type })

    if (!dictType)
      return []

    const data = await dictType.populate<{
      populated_dictData: ISysDictDataDocument[]
    }>({
      path: 'populated_dictData',
      select: 'value label order tagType _id -typeId',
      match: { status: true },
      options: {
        lean: true,
      },
    })

    return {
      type: data.type,
      name: data.name,
      dictData: data.populated_dictData,
    }
  }

  /**
   * @description: get dict by type many
   */
  async getByTypeMany(types: string[]) {
    return (
      await Promise.all(types.map(async type => this.getByType(type)))
    ).flat()
  }
}
