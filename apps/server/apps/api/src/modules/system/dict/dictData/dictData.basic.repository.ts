import type { DataSource, EntityManager } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { WalnutModelName, WalnutPGConnectionName } from '@walnut-server/db'

import { WalnutAdminCommonPgBaseRepository } from '@walnut-server/repository'
import { SysDictDataEntity } from './entity/dict-data.entity'

/**
 * B3 迁移模板（repo 层）：类名与文件名保持不变（DI token 不动），基类换成 PG 版。
 */
@Injectable()
export class SysDictDataBasicRepository extends WalnutAdminCommonPgBaseRepository<SysDictDataEntity> {
  constructor(
    @InjectDataSource(WalnutPGConnectionName)
    dataSource: DataSource,
  ) {
    super(SysDictDataEntity, WalnutModelName.SYS_DICT_DATA, dataSource)
  }

  /**
   * @description find active dict data rows of one dict type, ordered by sort order
   * （getByType 的 populate 腿：match { status: true }，idx_dict_data_type_order 使
   * sort_order 顺序即索引序，phase2 4.7）
   */
  async findActiveByTypeId(typeId: string, em?: EntityManager) {
    return this.getManager(em).getRepository(SysDictDataEntity).find({
      where: { typeId, status: true },
      order: { order: 'ASC' },
    })
  }
}
