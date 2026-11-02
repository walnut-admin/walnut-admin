import type { EntityManager } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { WalnutAdminExceptionBadRequest } from '@walnut-server/exceptions/base.exception'

import { WalnutAdminExceptionDataExists } from '@walnut-server/exceptions/base/400'
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

    const { value, langId, ...commonQuery } = params.query

    return this.localeRepoService.aggregateList(
      { ...params, query: commonQuery },
      { value, langId, langsCount: langs.length },
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
