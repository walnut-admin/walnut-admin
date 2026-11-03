import type { EntityManager } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { WalnutAdminExceptionBadRequest } from '@walnut-server/exceptions/base.exception'

import { WalnutAdminExceptionDataExists } from '@walnut-server/exceptions/base/400'
import { getFilterValue, omitFilters } from '@walnut-server/list'
import { Locale, LocaleType } from '@walnut/contract'

import { Recordable } from 'easy-fns-ts'

import { SysLangRepoService } from '../lang/repo/lang.repo.service'
import {
  SysLocaleDTOCreateRequest,
  SysLocaleDTOListRequest,
  SysLocaleDTOUpdateRequest,
} from './dto/locale.dto'
import { SysLocaleEntity } from './entity/locale.entity'
import { SysLocaleBasicRepository } from './locale.basic.repository'
import { SysLocaleRepoService } from './repo/locale.repo.service'
import { SysLocaleSharedService } from './shared/locale.shared.service'

/**
 * LocaleType Service
 *
 * This service has 1:1 mapping with controller endpoints.
 * NO direct Model usage - all data access through Repository/Repo Service layer.
 */
@Injectable()
export class SysLocaleService {
  constructor(
    private readonly localeBasicRepo: SysLocaleBasicRepository,
    private readonly localeRepoService: SysLocaleRepoService,
    private readonly localeSharedService: SysLocaleSharedService,
    private readonly langRepoService: SysLangRepoService,
  ) {}

  /**
   * @description: create locale messages (controller: create)
   */
  async create(payload: SysLocaleDTOCreateRequest[], em: EntityManager) {
    const isExisted = await this.localeRepoService.existsByKey(payload[0].key, em)
    if (isExisted) {
      throw new WalnutAdminExceptionDataExists()
    }

    const res: SysLocaleEntity[] = []
    for (const locale of payload) {
      const target = await this.localeBasicRepo.create(locale, em)
      res.push(target)
    }

    this.localeSharedService.triggerCacheRefresh()

    return res
  }

  /**
   * @description: locale read (controller: read)
   */
  async read(key: string, em?: EntityManager) {
    const data = await this.localeRepoService.findByKey(key, em)

    // langId 在 PG 侧即 uuid 字符串（Mongo 版的 ObjectId.toString() 不再需要）
    const result: Recordable = Object.fromEntries(data.map(i => [i.langId, i.value]))

    return {
      ...result,
      key,
    }
  }

  /**
   * @description: update (controller: update)
   */
  async update(payload: SysLocaleDTOUpdateRequest[], em: EntityManager) {
    if (payload[0].key !== payload[0].oldKey) {
      const isExist = await this.localeRepoService.existsByKey(payload[0].key, em)
      if (isExist) {
        throw new WalnutAdminExceptionBadRequest({ errMsg: 'business.system.locale.updateExist' })
      }
    }

    const res: SysLocaleEntity[] = []
    for (const i of payload) {
      const target = await this.localeBasicRepo.updateByField({ key: i.oldKey, langId: i.langId }, { ...i }, em)
      res.push(target)
    }

    this.localeSharedService.triggerCacheRefresh()

    return res
  }

  /**
   * @description: delete locales through key (controller: delete)
   */
  async deleteByKey(key: string, userId: string, em: EntityManager) {
    return this.localeSharedService.deleteByKey(key, userId, em)
  }

  /**
   * @description: batch delete (controller: deleteMany)
   */
  async deleteManyByKey(keys: string[], userId: string, em: EntityManager) {
    return this.localeSharedService.deleteManyByKey(keys, userId, em)
  }

  /**
   * @description: base list (controller: list)
   *
   * Mongo 版 extraPipeline（$group/$unwind/$match/$project 分组聚合）随 B2 SQL 重写收口进
   * locale.repo.service 的 aggregateList；这里只保留入参拆分（value/langId 是文档级过滤，
   * 不进公共 query）与语言总数的取数。
   */
  async list(params: SysLocaleDTOListRequest, em?: EntityManager) {
    const langs = await this.langRepoService.findAll()

    // 批次 4-A：value / langId 是**文档级**（sys_locale 行级）过滤，语义与实体列过滤不同，
    // 从 filters 里摘出来单独下传；其余过滤照常进 aggregateList 的列白名单通道。
    const value = getFilterValue(params.filters, 'value')
    const langId = getFilterValue(params.filters, 'langId')

    return this.localeRepoService.aggregateList(
      { ...params, filters: omitFilters(params.filters, ['value', 'langId']) },
      {
        value: typeof value === 'string' ? value : undefined,
        langId: typeof langId === 'string' ? langId : undefined,
        langsCount: langs.length,
      },
      em,
    )
  }

  /**
   * @description: get locale message (controller: getLocaleMessage)
   */
  async getLocaleMessage(lang: LocaleType, needCache: boolean) {
    if (!Object.values(Locale).includes(lang)) {
      return this.localeSharedService.getLocaleMessage(Locale.en_US, needCache)
    }

    return this.localeSharedService.getLocaleMessage(lang, needCache)
  }
}
