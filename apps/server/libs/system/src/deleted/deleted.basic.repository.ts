import type { IWalnutAdminRequestList } from '@walnut-server/list'
import type { DataSource, EntityManager, SelectQueryBuilder } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { WalnutModelName, WalnutPGConnectionName } from '@walnut-server/db'
import { WalnutAdminExceptionRequestDataError } from '@walnut-server/exceptions/base/400'

import { getFilterValue, omitFilters } from '@walnut-server/list'
import { applyPgListQuery, buildPgListQueryOptionsFromQb, escapeLikePattern, SysDeletedEntity, WALNUT_PG_LIST_TOTAL_ALIAS, WalnutAdminCommonPgBaseRepository } from '@walnut-server/repository'

/** 回收站列表行：实体列 + Mongo 版 $lookup 注入的 user（仅 userName 通道） */
export interface ISysDeletedListRow extends SysDeletedEntity {
  user: { id: string, userName: string | null } | null
}

/**
 * B9 迁移模板（repo 层）：类名与文件名保持不变（DI token 不动 → service 零改动），
 * 基类从 Mongo 版 `WalnutAdminCommonBasicRepository` 换成 PG 版。
 *
 * list 覆写承接 Mongo 版 $lookup（deletedBy → sys_user）：LEFT JOIN 无行放大
 * （PK 对一），user 按行并回；`content` 是 jsonb 列，查询条件里的模糊
 * 关键字走 `::text` cast（对齐 Mongo 版对 stringify 文本的 $regex 语义 ——
 * pg-list.builder 的白名单 ILIKE 直排 jsonb 列会被 PG 拒绝）。
 */
@Injectable()
export class SysDeletedBasicRepository extends WalnutAdminCommonPgBaseRepository<SysDeletedEntity> {
  constructor(
    @InjectDataSource(WalnutPGConnectionName)
    dataSource: DataSource,
  ) {
    super(SysDeletedEntity, WalnutModelName.SYS_DELETED, dataSource)
  }

  /**
   * @description 按 id + deletedId 双键读快照（recoverMine 的定位条件，属主校验在 service）
   */
  public async findByIdAndDeletedId(id: string, deletedId: string, em?: EntityManager): Promise<SysDeletedEntity | null> {
    // 数据权限三期：注册实体的 scoped 读走 withScopedManager（无 em 时自动事务 +
    // RLS set_config），与基类 readById 同口径。
    return this.withScopedManager(em, async (manager) => {
      const where = this.buildScopedWhere({ id, deletedId })

      if (where === 'deny') {
        return null
      }

      // where 已由基类 buildScopedWhere 并入数据权限谓词（sys_deleted 已注册）
      // eslint-disable-next-line no-restricted-syntax -- 谓词构造已走基类，这里的直连仅执行已 scoped 的 where
      return manager.getRepository(SysDeletedEntity).findOne({ where })
    }, { readOnly: true })
  }

  /** content 过滤值只接受字符串（jsonb 旁路的关键字，非字符串会被 String() 成怪串） */
  private toContentKeyword(value: unknown): string | undefined {
    if (value === undefined || value === null || value === '') {
      return undefined
    }
    if (typeof value !== 'string') {
      throw new WalnutAdminExceptionRequestDataError('filters[content] 只接受字符串')
    }
    return value
  }

  public async list<T>(
    params: IWalnutAdminRequestList<T>,
    _customize?: (qb: SelectQueryBuilder<SysDeletedEntity>) => void,
    em?: EntityManager,
  ): Promise<{ data: ISysDeletedListRow[], total: number }> {
    // 数据权限三期：注册实体的读路径必须进事务（withScopedManager 负责自动事务 +
    // RLS set_config），覆写 list 与基类同口径。
    return this.withScopedManager(em, async (manager) => {
      const qb = manager
        .createQueryBuilder(SysDeletedEntity, 'entity')
        .leftJoin('sys_user', 'deleted_by_user', 'deleted_by_user.id = entity.deleted_by')

      // content 的模糊搜索从白名单通道摘出，走 jsonb ::text cast（见类注释）
      // 批次 4-A：content 是 jsonb 列，显式 `{ op: 'like' }` 打在上面会被列类型裁决拒成 40099；
      // 它的模糊语义由下面对 `::text` 表达式的旁路 SQL 承担，所以先从 filters 里摘出去。
      const contentKeyword = this.toContentKeyword(getFilterValue(params.filters, 'content'))

      applyPgListQuery(qb, 'entity', buildPgListQueryOptionsFromQb<T>(qb, {
        ...params,
        filters: omitFilters(params.filters, ['content']),
      }))

      // 数据权限：sys_deleted 已注册（SELF = 本人删除的快照）
      this.applyDataScope(qb, 'entity')

      if (contentKeyword !== undefined) {
        // jsonb ::text cast 之后是文本，ILIKE 在该表达式上合法；转义走共享字面量口径
        qb.andWhere('entity.content::text ILIKE :deleted_content_keyword', { deleted_content_keyword: `%${escapeLikePattern(contentKeyword)}%` })
      }

      // populate 出参列（别名与实体列错开；user.id 作 JOIN 命中标记），同趟带出 total 窗口列
      qb.addSelect('deleted_by_user.id', 'deleted_by_user_id')
      qb.addSelect('deleted_by_user.user_name', 'deleted_by_user_name')
      qb.addSelect(`COUNT(*) OVER()`, WALNUT_PG_LIST_TOTAL_ALIAS)

      const { raw, entities } = await qb.getRawAndEntities()

      const total = Number((raw[0] as Record<string, unknown> | undefined)?.[WALNUT_PG_LIST_TOTAL_ALIAS] ?? 0)

      // 单行 JOIN 无放大，raw 与 entities 逐行对齐；user 按行并回
      const data = entities.map((entity, index) => {
        const row = raw[index] as Record<string, unknown> | undefined
        const populatedUserId = row?.deleted_by_user_id as string | undefined

        const user = populatedUserId != null
          ? { id: populatedUserId, userName: (row?.deleted_by_user_name as string | null) ?? null }
          : null

        return Object.assign(entity, { user })
      })

      return { data, total }
    }, { readOnly: true })
  }
}
