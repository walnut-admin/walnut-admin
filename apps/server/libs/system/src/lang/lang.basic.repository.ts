import type { IWalnutAdminRequestList } from '@walnut-server/list'
import type { DataSource, EntityManager, SelectQueryBuilder } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'

import { WalnutModelName, WalnutPGConnectionName } from '@walnut-server/db'
import { applyPgListQuery, buildPgListQueryOptions, WALNUT_PG_LIST_TOTAL_ALIAS, WalnutAdminCommonPgBaseRepository } from '@walnut-server/repository'
import { SysLocaleEntity } from '../locale/entity/locale.entity'
import { SysLangEntity } from './entity/lang.entity'

/**
 * lang 列表行：实体列 + Mongo 版 customPipeline 注入的三个加工字段
 * （localesTotalCount / localesFinishedCount / process）。
 */
export interface ISysLangListRow extends SysLangEntity {
  localesTotalCount: number
  localesFinishedCount: number
  process: number
}

/**
 * B2 迁移模板（repo 层）：类名与文件名保持不变（DI token 不动），基类换成 PG 版。
 * Mongo 版 list 的 customPipeline（双 $lookup 计数 + process）按 phase2 5.2 改写为
 * 相关子查询 + COUNT(*) OVER() 单趟，list 在此覆写（计数列不在实体映射里，需
 * getRawAndEntities 后按行并回）。
 */
@Injectable()
export class SysLangBasicRepository extends WalnutAdminCommonPgBaseRepository<SysLangEntity> {
  constructor(
    @InjectDataSource(WalnutPGConnectionName)
    dataSource: DataSource,
  ) {
    super(SysLangEntity, WalnutModelName.SYS_LANG, dataSource)
  }

  /**
   * @description Base list（附 locale 计数与翻译进度 process）。customize 钩子占位以
   * 保持与基类签名兼容（计数在覆写内以子查询实现，本 repo 无 JOIN 改写需求），传入即忽略。
   *
   * process = finished / total * 100，与 Mongo 版 $multiply($divide) 同式：无兜底，
   * 零 locale 的 lang 会像 Mongo 版一样抛错（$divide by zero / PG division by zero）。
   */
  public async list<T>(
    params: IWalnutAdminRequestList<T>,
    _customize?: (qb: SelectQueryBuilder<SysLangEntity>) => void,
    em?: EntityManager,
  ): Promise<{ data: ISysLangListRow[], total: number }> {
    const qb = this.getManager(em)
      .createQueryBuilder(SysLangEntity, 'entity')

    applyPgListQuery(qb, 'entity', buildPgListQueryOptions<T>(params))

    qb.addSelect((sub) => {
      return sub
        .select('count(*)::int')
        .from(SysLocaleEntity, 'total_locale')
        .where('total_locale.langId = entity.id')
    }, 'locales_total_count')

    qb.addSelect((sub) => {
      return sub
        .select('count(*)::int')
        .from(SysLocaleEntity, 'finished_locale')
        .where('finished_locale.langId = entity.id AND finished_locale.value IS NOT NULL')
    }, 'locales_finished_count')

    qb.addSelect(`COUNT(*) OVER()`, WALNUT_PG_LIST_TOTAL_ALIAS)

    const { raw, entities } = await qb.getRawAndEntities()

    const firstRaw = raw[0] as Record<string, unknown> | undefined
    const total = Number(firstRaw?.[WALNUT_PG_LIST_TOTAL_ALIAS] ?? 0)

    // 无 JOIN 单表查询，raw 与 entities 逐行对齐；加工列不在实体映射里，按行并回
    const data = entities.map((entity, index) => {
      const row = raw[index] as Record<string, unknown> | undefined
      const localesTotalCount = Number(row?.locales_total_count ?? 0)
      const localesFinishedCount = Number(row?.locales_finished_count ?? 0)

      return Object.assign(entity, {
        localesTotalCount,
        localesFinishedCount,
        process: (localesFinishedCount / localesTotalCount) * 100,
      })
    })

    return { data, total }
  }
}
