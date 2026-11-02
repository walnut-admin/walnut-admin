import type { EntityManager } from 'typeorm'
import { Injectable } from '@nestjs/common'

import { SysDictDataBasicRepository } from '../dictData/dictData.basic.repository'
import { SysDictDataEntity } from '../dictData/entity/dict-data.entity'
import { SysDictTypeBasicRepository } from './dictType.basic.repository'
import {
  SysDictTypeDTOCreateRequest,
  SysDictTypeDTOListRequest,
  SysDictTypeDTOUpdateRequest,
} from './dto/dictType.dto'

@Injectable()
export class SysDictTypeService {
  constructor(
    private readonly dictTypeBasicRepo: SysDictTypeBasicRepository,
    private readonly dictDataBasicRepo: SysDictDataBasicRepository,
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

  /**
   * @description delete dict type
   *
   * P2-8 修复（2026-10-28）：旧实现只把 type 行做成 sys_deleted 快照后硬删，关联的
   * dictData 由 `fk_dict_data_type ON DELETE CASCADE` 静默清掉 —— 数据行直接消失、
   * 不进回收站。现在同事务内先逐行软删 dictData（每行各落一条 `SYS_DICT_DATA`
   * 快照），再软删 type 行；随后 type 的硬删不再有 data 行可级联。
   */
  async delete(id: string, userId: string, em: EntityManager) {
    await this.dictDataBasicRepo.deleteSoftManyByCondition({ typeId: id }, userId, em)
    return this.dictTypeBasicRepo.deleteSoftById(id, userId, em)
  }

  async list(params: SysDictTypeDTOListRequest) {
    return this.dictTypeBasicRepo.list(params)
  }

  /**
   * @description: get dict by type
   *
   * Mongo 版 findOne + populate（match { status: true }）；PG 版拆成两次取数
   * （findByType + findActiveByTypeId），出参形态不变：{ type, name, dictData }。
   */
  async getByType(type: string) {
    const dictType = await this.dictTypeBasicRepo.findByType(type)

    if (!dictType)
      return []

    const data: SysDictDataEntity[] = await this.dictDataBasicRepo.findActiveByTypeId(dictType.id)

    return {
      type: dictType.type,
      name: dictType.name,
      dictData: data,
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
