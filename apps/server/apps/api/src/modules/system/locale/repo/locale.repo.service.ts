import type { EntityManager } from 'typeorm'
import type { IWalnutAdminRequestList } from '@/common/dto/list.dto'
import { Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'
import { isNil } from 'lodash'

import { DataSource } from 'typeorm'
import { buildPgListQueryOptions, ILIKE_ESCAPE_REGEX, WALNUT_PG_LIST_TOTAL_ALIAS } from '@/common/repository/pg-list.builder'
import { SysLocaleEntity } from '../entity/locale.entity'

/** locale list 分组行（Mongo 版投影出参：_id=key 分组键、key、process、createdAt、updatedAt） */
export interface ISysLocaleListGroupRow {
  /** Mongo 版 `_id` 的分组键语义（= key），PG 响应契约随 B1 模板改名为 id */
  id: string
  key: string
  process: number
  createdAt: Date
  updatedAt: Date
}

export interface ISysLocaleAggregateListOptions {
  /** 文档级模糊过滤（Mongo：$unwind 后 `docs.value` $regex） */
  value?: string
  /** 文档级缺翻译过滤（Mongo：`docs.langId` 等值 + `docs.value` 为 null） */
  langId?: string
  /** 翻译进度分母：语言总数（langRepoService.findAll 的行数） */
  langsCount: number
}

/**
 * Locale Repository Service
 *
 * Provides simple CRUD operations for cross-module access.
 * NO business logic - only data access.
 */
@Injectable()
export class SysLocaleRepoService {
  constructor(
    @InjectDataSource(WalnutPGConnectionName)
    private readonly dataSource: DataSource,
  ) {}

  /**
   * @description find locales by key
   */
  async findByKey(key: string, em?: EntityManager) {
    return this.getManager(em).getRepository(SysLocaleEntity).find({ where: { key } })
  }

  /**
   * @description check if key exists（消费方只做真值判断，形态 entity | null 与 Mongo 版一致）
   */
  async existsByKey(key: string, em?: EntityManager) {
    return this.getManager(em).getRepository(SysLocaleEntity).findOne({ where: { key } })
  }

  /**
   * @description aggregate for list —— locale.service.list 原 Mongo 聚合的 SQL 重写
   *
   * Mongo 版分段（语义对账，phase2 5.2 同批）：
   * 1. 公共 $match 打在原始 locale 文档列上（key 模糊 / createdAt / updatedAt 范围）；
   * 2. `finished`（每 key 已翻译计数）按 key 开窗计算 —— 必须发生在文档级过滤**之前**
   *    （Mongo 里 $group 在 value/langId $match 之前），process 分子不受文档过滤影响；
   * 3. value 模糊 / langId 缺翻译过滤打在「文档」粒度上（对应 $unwind 之后的 $match），
   *    未命中文档的 key 整组消失；
   * 4. 分组投影首条文档的 createdAt / updatedAt（Mongo $arrayElemAt [0]，即插入序首条 ——
   *    PG 用 created_at, id 排序取首）。
   *
   * 出参 `{ data, total }`：total = 分组数（对应 $facet total）；process 与 Mongo 版
   * `$divide: ['$finished', langs.length]` 同式无兜底 —— langsCount 为 0 时同样报错。
   * value / data 聚合数组响应 DTO 不消费，不再物化。
   */
  async aggregateList<T>(
    params: IWalnutAdminRequestList<T>,
    options: ISysLocaleAggregateListOptions,
    em?: EntityManager,
  ): Promise<{ data: ISysLocaleListGroupRow[], total: number }> {
    const { match, sort, skip, limit } = buildPgListQueryOptions<T>(params)

    const values: unknown[] = []
    const bind = (value: unknown) => `$${values.push(value)}`

    // 公共过滤只收 locale 实体列（防御性收敛，与 pg-list.builder 同口径；
    // value/langId 已被 service 抽出，不在 commonQuery 里）
    const MATCH_COLUMN_MAP: Record<string, string> = {
      id: 't.id',
      key: 't.key',
      createdAt: 't.created_at',
      updatedAt: 't.updated_at',
    }

    const where: string[] = []
    Object.entries(match).forEach(([property, condition]) => {
      const column = MATCH_COLUMN_MAP[property]
      if (!column || isNil(condition) || typeof condition !== 'object') {
        return
      }

      const { op, value } = condition as { op: string, value: unknown }

      if (op === 'ilike') {
        const escaped = String(value).replace(ILIKE_ESCAPE_REGEX, c => `\\${c}`)
        where.push(`${column} ILIKE ${bind(`%${escaped}%`)}`)
        return
      }

      if (op === 'eq') {
        where.push(`${column} = ${bind(value)}`)
        return
      }

      if (op === 'range') {
        const [start, end] = value as [Date, Date]
        where.push(`${column} >= ${bind(start)} AND ${column} < ${bind(end)}`)
      }
    })

    // 文档级过滤（Mongo $unwind 后的 $match 等价物）
    const docWhere: string[] = []
    if (!isNil(options.value)) {
      const escaped = String(options.value).replace(ILIKE_ESCAPE_REGEX, c => `\\${c}`)
      docWhere.push(`d.value ILIKE ${bind(`%${escaped}%`)}`)
    }
    // Mongo 版为 `langId ? [...] : []` 的真值口径：undefined / 空串都不加过滤
    if (options.langId !== undefined && options.langId !== '') {
      docWhere.push(`d.lang_id = ${bind(options.langId)}`, 'd.value IS NULL')
    }

    // 排序打在分组投影后的别名上（Mongo sortAfter = true）；只收投影列
    const SORT_ALIAS_MAP: Record<string, string> = {
      key: 'key',
      id: 'key',
      process: 'process',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    }
    const orderParts = Object.entries(sort)
      .map(([property, direction]) => {
        const alias = SORT_ALIAS_MAP[property]
        return alias ? `${alias} ${direction}` : undefined
      })
      .filter((part): part is string => part !== undefined)
    const orderSql = orderParts.length > 0 ? orderParts.join(', ') : 'created_at DESC'

    const sql = `
      WITH matched AS (
        SELECT t.id,
               t.lang_id,
               t.key,
               t.value,
               t.created_at,
               t.updated_at,
               COUNT(t.value) OVER (PARTITION BY t.key) AS finished
        FROM sys_locale t
        ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
      ),
      docfiltered AS (
        SELECT d.*
        FROM matched d
        ${docWhere.length > 0 ? `WHERE ${docWhere.join(' AND ')}` : ''}
      )
      SELECT d.key AS key,
             (ARRAY_AGG(d.created_at ORDER BY d.created_at, d.id))[1] AS created_at,
             (ARRAY_AGG(d.updated_at ORDER BY d.created_at, d.id))[1] AS updated_at,
             MAX(d.finished)::float8 / ${bind(options.langsCount)} AS process,
             COUNT(*) OVER() AS ${WALNUT_PG_LIST_TOTAL_ALIAS}
      FROM docfiltered d
      GROUP BY d.key
      ORDER BY ${orderSql}
      LIMIT ${Number(limit)} OFFSET ${Number(skip)}
    `

    // manager.query 的返回由驱动决定；本查询的列集固定，用泛型参数收窄为行记录数组
    const rows = await this.getManager(em).query<Record<string, unknown>[]>(sql, values)

    const firstRaw = rows[0]
    const total = Number(firstRaw?.[WALNUT_PG_LIST_TOTAL_ALIAS] ?? 0)

    const data = rows.map(row => ({
      id: row.key as string,
      key: row.key as string,
      process: Number(row.process),
      createdAt: row.created_at as Date,
      updatedAt: row.updated_at as Date,
    }))

    return { data, total }
  }

  private getManager(em?: EntityManager): EntityManager {
    return em ?? this.dataSource.manager
  }
}
