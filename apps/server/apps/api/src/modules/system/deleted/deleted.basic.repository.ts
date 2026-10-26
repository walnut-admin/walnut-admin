import type { DataSource, EntityManager, SelectQueryBuilder } from 'typeorm'
import type { IWalnutAdminRequestList } from '@/common/dto/list.dto'
import { Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { WalnutDBModelName, WalnutPGConnectionName } from '@walnut-server/db'

import { WalnutAdminCommonPgBaseRepository } from '@/common/repository/pg-base.repository'
import {
  applyPgListQuery,
  buildPgListQueryOptions,
  ILIKE_ESCAPE_REGEX,
  WALNUT_PG_LIST_TOTAL_ALIAS,
} from '@/common/repository/pg-list.builder'
import { SysDeletedEntity } from './entity/deleted.entity'

/** 回收站列表行：实体列 + Mongo 版 $lookup 注入的 populated_user（仅 userName 通道） */
export interface ISysDeletedListRow extends SysDeletedEntity {
  populated_user: { id: string, userName: string | null } | null
}

/**
 * B9 迁移模板（repo 层）：类名与文件名保持不变（DI token 不动 → service 零改动），
 * 基类从 Mongo 版 `WalnutAdminCommonBasicRepository` 换成 PG 版。
 *
 * list 覆写承接 Mongo 版 $lookup（deletedBy → sys_user）：LEFT JOIN 无行放大
 * （PK 对一），populated_user 按行并回；`content` 是 jsonb 列，查询条件里的模糊
 * 关键字走 `::text` cast（对齐 Mongo 版对 stringify 文本的 $regex 语义 ——
 * pg-list.builder 的白名单 ILIKE 直排 jsonb 列会被 PG 拒绝）。
 */
@Injectable()
export class SysDeletedBasicRepository extends WalnutAdminCommonPgBaseRepository<SysDeletedEntity> {
  constructor(
    @InjectDataSource(WalnutPGConnectionName)
    dataSource: DataSource,
  ) {
    super(SysDeletedEntity, WalnutDBModelName.SYS_DELETED, dataSource)
  }

  /**
   * @description 按 id + deletedId 双键读快照（recoverMine 的定位条件，属主校验在 service）
   */
  public async findByIdAndDeletedId(id: string, deletedId: string, em?: EntityManager): Promise<SysDeletedEntity | null> {
    return this.getManager(em).getRepository(SysDeletedEntity).findOne({ where: { id, deletedId } })
  }

  public async list<T>(
    params: IWalnutAdminRequestList<T>,
    _customize?: (qb: SelectQueryBuilder<SysDeletedEntity>) => void,
    em?: EntityManager,
  ): Promise<{ data: ISysDeletedListRow[], total: number }> {
    const qb = this.getManager(em)
      .createQueryBuilder(SysDeletedEntity, 'entity')
      .leftJoin('sys_user', 'deleted_by_user', 'deleted_by_user.id = entity.deleted_by')

    // content 的模糊搜索从白名单通道摘出，走 jsonb ::text cast（见类注释）
    const query = { ...((params.query ?? {}) as Record<string, unknown>) }
    const contentKeyword = typeof query.content === 'string' && query.content !== '' ? query.content : undefined
    delete query.content

    applyPgListQuery(qb, 'entity', buildPgListQueryOptions<T>({ ...params, query: query as never }))

    if (contentKeyword !== undefined) {
      const escaped = contentKeyword.replace(ILIKE_ESCAPE_REGEX, c => `\\${c}`)
      qb.andWhere('entity.content::text ILIKE :deleted_content_keyword', { deleted_content_keyword: `%${escaped}%` })
    }

    // populate 出参列（别名与实体列错开；user.id 作 JOIN 命中标记），同趟带出 total 窗口列
    qb.addSelect('deleted_by_user.id', 'populated_user_id')
    qb.addSelect('deleted_by_user.user_name', 'populated_user_user_name')
    qb.addSelect(`COUNT(*) OVER()`, WALNUT_PG_LIST_TOTAL_ALIAS)

    const { raw, entities } = await qb.getRawAndEntities()

    const total = Number((raw[0] as Record<string, unknown> | undefined)?.[WALNUT_PG_LIST_TOTAL_ALIAS] ?? 0)

    // 单行 JOIN 无放大，raw 与 entities 逐行对齐；populated_user 按行并回
    const data = entities.map((entity, index) => {
      const row = raw[index] as Record<string, unknown> | undefined
      const populatedUserId = row?.populated_user_id as string | undefined

      const populated_user = populatedUserId != null
        ? { id: populatedUserId, userName: (row?.populated_user_user_name as string | null) ?? null }
        : null

      return Object.assign(entity, { populated_user })
    })

    return { data, total }
  }
}
