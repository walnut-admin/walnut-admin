import type { DataSource } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'
import { LocaleType } from '@walnut/contract'

import { SysLocaleEntity } from '../../locale/entity/locale.entity'
import { SysLangEntity } from '../entity/lang.entity'

/**
 * Lang Repository Service
 *
 * Provides simple CRUD operations for cross-module access.
 * NO business logic - only data access.
 *
 * B2 迁 PG：两条聚合管道按 phase2 5.2 SQL 重写（原 Mongo 双 $lookup + $size 计数、
 * $expr+$toObjectId+$arrayToObject 动态消息 map —— PG 侧 langId 是 uuid 强类型 FK，
 * $toObjectId 那一类历史坑不复存在），输出形态与 Mongo 版逐字段一致。
 */
@Injectable()
export class SysLangRepoService {
  constructor(
    @InjectDataSource(WalnutPGConnectionName)
    private readonly dataSource: DataSource,
  ) {}

  /**
   * @description find lang by id with locale counts
   *
   * Mongo 版两次 $lookup 拉全量数组只为 $size 计数；SQL 版用相关子查询计数，不物化明细
   * （phase2 5.2 草图）。count(*) 返回 bigint，pg 驱动回字符串，统一 ::int 收敛；
   * 查无此 lang 时与 Mongo 版一致返回 undefined。
   */
  async findByIdWithLocaleCounts(id: string) {
    const qb = this.dataSource
      .createQueryBuilder(SysLangEntity, 'lang')
      .addSelect((sub) => {
        return sub
          .select('count(*)::int')
          .from(SysLocaleEntity, 'total_locale')
          .where('total_locale.langId = lang.id')
      }, 'locales_total_count')
      .addSelect((sub) => {
        return sub
          .select('count(*)::int')
          .from(SysLocaleEntity, 'finished_locale')
          .where('finished_locale.langId = lang.id AND finished_locale.value IS NOT NULL')
      }, 'locales_finished_count')
      .where('lang.id = :id', { id })

    const { raw, entities } = await qb.getRawAndEntities()

    const entity = entities[0]
    if (entity === undefined) {
      return undefined
    }

    // 无 JOIN 的单表查询，raw 与 entities 逐行对齐；计数列不在实体映射里，手工并回去
    const row = raw[0] as Record<string, unknown>

    return Object.assign(entity, {
      localesTotalCount: Number(row.locales_total_count ?? 0),
      localesFinishedCount: Number(row.locales_finished_count ?? 0),
    })
  }

  /**
   * @description find all langs
   */
  async findAll() {
    return this.dataSource.getRepository(SysLangEntity).find()
  }

  /**
   * @description find public langs (status = true)
   *
   * Mongo 版投影 `{ order: 1, lang: 1, description: 1, _id: 0 }`（无 id、无 status、
   * 无时间戳），PG 版 select 同一列集，出参键保持 order/lang/description 三个。
   */
  async findPublic() {
    // Mongo 版 `.lean()` 出纯对象；PG 版用 getRawMany 对齐（不能回实体实例 ——
    // 全局 ClassSerializerInterceptor excludeExtraneousValues 只放行带 @Expose 的
    // DTO，未装饰的实体实例会被序列化成 {}）
    return this.dataSource
      .getRepository(SysLangEntity)
      .createQueryBuilder('lang')
      .select('lang.order', 'order')
      .addSelect('lang.lang', 'lang')
      .addSelect('lang.description', 'description')
      .where('lang.status = :status', { status: true })
      .getRawMany<{ order: number | null, lang: string, description: string | null }>()
  }

  /**
   * @description get locale messages by language name
   *
   * Mongo 版把某语言全部 locale 折叠成 `{key: value}` 动态 map；SQL 版 jsonb_object_agg
   * （phase2 5.2 草图）：value IS NULL 的条目产出 `"key": null`，与 $arrayToObject 一致；
   * 无匹配语言时 Mongo 版 res[0] 为 undefined（上层 .data 会炸），SQL 版 COALESCE 兜底
   * 成 `{ data: {} }` —— 消费方（admin 启动拉 locale message）拿到的形态不变。
   */
  async findMessagesByLang(lang: LocaleType) {
    const row = await this.dataSource
      .createQueryBuilder()
      .select('COALESCE(jsonb_object_agg(locale.key, locale.value), \'{}\'::jsonb)', 'data')
      .from(SysLocaleEntity, 'locale')
      .innerJoin(SysLangEntity, 'lang', 'lang.id = locale.langId')
      .where('lang.lang = :lang', { lang })
      .getRawOne<{ data: Record<string, string | null> }>()

    return { data: row?.data ?? {} }
  }
}
