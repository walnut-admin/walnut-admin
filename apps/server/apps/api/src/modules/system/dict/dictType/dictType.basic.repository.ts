import type { IWalnutAdminRequestList } from '@walnut-server/list'
import type { DataSource, EntityManager, SelectQueryBuilder } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'

import { WalnutModelName, WalnutPGConnectionName } from '@walnut-server/db'
import { WalnutAdminCommonPgBaseRepository } from '@/common/repository/pg-base.repository'
import {
  applyPgListQuery,
  buildPgListQueryOptions,
  WALNUT_PG_LIST_TOTAL_ALIAS,
} from '@/common/repository/pg-list.builder'
import { SysDictDataEntity } from '../dictData/entity/dict-data.entity'
import { SysDictTypeEntity } from './entity/dict-type.entity'

/**
 * dict type 列表行：实体列 + Mongo 版 customPipeline 注入的 dictDataCount。
 */
export interface ISysDictTypeListRow extends SysDictTypeEntity {
  dictDataCount: number
}

/**
 * B3 迁移模板（repo 层）：类名与文件名保持不变（DI token 不动），基类换成 PG 版。
 * Mongo 版 list 的 customPipeline（$lookup + $size 计数）改写为相关子查询，list 在此
 * 覆写（计数列不在实体映射里，需 getRawAndEntities 后按行并回）。
 */
@Injectable()
export class SysDictTypeBasicRepository extends WalnutAdminCommonPgBaseRepository<SysDictTypeEntity> {
  constructor(
    @InjectDataSource(WalnutPGConnectionName)
    dataSource: DataSource,
  ) {
    super(SysDictTypeEntity, WalnutModelName.SYS_DICT_TYPE, dataSource)
  }

  /**
   * @description Base list（附 dict data 计数）。customize 钩子占位以保持与基类签名
   * 兼容（计数在覆写内以子查询实现，本 repo 无 JOIN 改写需求），传入即忽略。
   */
  public async list<T>(
    params: IWalnutAdminRequestList<T>,
    _customize?: (qb: SelectQueryBuilder<SysDictTypeEntity>) => void,
    em?: EntityManager,
  ): Promise<{ data: ISysDictTypeListRow[], total: number }> {
    const qb = this.getManager(em)
      .createQueryBuilder(SysDictTypeEntity, 'entity')

    applyPgListQuery(qb, 'entity', buildPgListQueryOptions<T>(params))

    qb.addSelect((sub) => {
      return sub
        .select('count(*)::int')
        .from(SysDictDataEntity, 'dict_data')
        .where('dict_data.typeId = entity.id')
    }, 'dict_data_count')

    qb.addSelect(`COUNT(*) OVER()`, WALNUT_PG_LIST_TOTAL_ALIAS)

    const { raw, entities } = await qb.getRawAndEntities()

    const firstRaw = raw[0] as Record<string, unknown> | undefined
    const total = Number(firstRaw?.[WALNUT_PG_LIST_TOTAL_ALIAS] ?? 0)

    // 无 JOIN 单表查询，raw 与 entities 逐行对齐；计数列不在实体映射里，按行并回
    const data = entities.map((entity, index) => {
      const row = raw[index] as Record<string, unknown> | undefined

      return Object.assign(entity, {
        dictDataCount: Number(row?.dict_data_count ?? 0),
      })
    })

    return { data, total }
  }

  /**
   * @description find dict type by its business `type` key（getByType 的取数腿）
   */
  async findByType(type: string, em?: EntityManager) {
    return this.getManager(em).getRepository(SysDictTypeEntity).findOne({ where: { type } })
  }
}
