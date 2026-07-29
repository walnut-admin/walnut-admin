import { Injectable } from '@nestjs/common'
import { Locale,  LocaleType } from '@walnut/contract'
import { WalnutDBInjectModel, WalnutDBModelName } from '@walnut-server/db'

import { WalnutAdminExceptionBadRequest } from '@walnut-server/exceptions/base.exception'
import { WalnutAdminExceptionDataExists } from '@walnut-server/exceptions/base/400'
import {
  buildListPipelineFromRequest,
} from '@walnut-server/utils/listAggregate'

import { Recordable } from 'easy-fns-ts'
import { isNil } from 'lodash'

import { ClientSession, PipelineStage } from 'mongoose'
import { SysLangRepoService } from '../lang/repo/lang.repo.service'
import {
  SysLocaleDTOCreateRequest,
  SysLocaleDTOListRequest,
  SysLocaleDTOUpdateRequest,
} from './dto/locale.dto'
import { SysLocaleBasicRepository } from './locale.basic.repository'
import { SysLocaleRepoService } from './repo/locale.repo.service'
import { ISysLocaleDocument, ISysLocaleModel } from './schema/locale.schema'
import { SysLocaleSharedService } from './shared/locale.shared.service'

/**
 * LocaleType Service
 *
 * This service has 1:1 mapping with controller endpoints.
 * NO direct Model usage - all data access through Repository/Repo Service/Shared Service layer.
 */
@Injectable()
export class SysLocaleService {
  constructor(
    @WalnutDBInjectModel(WalnutDBModelName.SYS_LOCALE)
    private readonly localeModel: ISysLocaleModel,
    private readonly localeBasicRepo: SysLocaleBasicRepository,
    private readonly localeRepoService: SysLocaleRepoService,
    private readonly localeSharedService: SysLocaleSharedService,
    private readonly langRepoService: SysLangRepoService,
  ) {}

  /**
   * @description: create locale messages (controller: create)
   */
  async create(payload: SysLocaleDTOCreateRequest[], dbSession: ClientSession) {
    const isExisted = await this.localeRepoService.existsByKey(payload[0].key, dbSession)
    if (isExisted) {
      throw new WalnutAdminExceptionDataExists()
    }

    const res: ISysLocaleDocument[] = []
    for (const locale of payload) {
      const target = await this.localeBasicRepo.create(locale, dbSession)
      res.push(target)
    }

    this.localeSharedService.triggerCacheRefresh()

    return res
  }

  /**
   * @description: locale read (controller: read)
   */
  async read(key: string, dbSession?: ClientSession) {
    const data = await this.localeRepoService.findByKey(key, dbSession)

    const result: Recordable = Object.fromEntries(data.map(i => [i.langId.toString(), i.value]))

    return {
      ...result,
      key,
    }
  }

  /**
   * @description: update (controller: update)
   */
  async update(payload: SysLocaleDTOUpdateRequest[], dbSession: ClientSession) {
    if (payload[0].key !== payload[0].oldKey) {
      const isExist = await this.localeRepoService.existsByKey(payload[0].key, dbSession)
      if (isExist) {
        throw new WalnutAdminExceptionBadRequest({ errMsg: 'business.system.locale.updateExist' })
      }
    }

    const res: ISysLocaleDocument[] = []
    for (const i of payload) {
      const target = await this.localeBasicRepo.updateByField({ key: i.oldKey, langId: i.langId }, { ...i }, dbSession)
      res.push(target)
    }

    this.localeSharedService.triggerCacheRefresh()

    return res
  }

  /**
   * @description: delete locales through key (controller: delete)
   */
  async deleteByKey(key: string, userId: string, dbSession: ClientSession) {
    return this.localeSharedService.deleteByKey(key, userId, dbSession)
  }

  /**
   * @description: batch delete (controller: deleteMany)
   */
  async deleteManyByKey(keys: string[], userId: string, dbSession: ClientSession) {
    return this.localeSharedService.deleteManyByKey(keys, userId, dbSession)
  }

  /**
   * @description: base list (controller: list)
   */
  async list(params: SysLocaleDTOListRequest, dbSession?: ClientSession) {
    const langs = await this.langRepoService.findAll()

    const { value, langId, ...commonQuery } = params.query

    const extraPipeline: PipelineStage[] = [
      { $group: { _id: '$key', finished: { $sum: { $cond: [{ $ne: ['$value', null] }, 1, 0] } }, docs: { $push: '$$ROOT' } } },
      { $unwind: '$docs' },
      ...(!isNil(value) ? [{ $match: { 'docs.value': { $regex: value, $options: 'i' } } }] : []),
      ...(langId ? [{ $match: { 'docs.langId': langId, 'docs.value': null } }] : []),
      { $group: { _id: '$_id', finished: { $first: '$finished' }, data: { $push: '$docs' } } },
      {
        $project: {
          _id: 1,
          key: '$_id',
          value: '$data.value',
          data: 1,
          createdAt: { $arrayElemAt: ['$data.createdAt', 0] },
          updatedAt: { $arrayElemAt: ['$data.updatedAt', 0] },
          process: { $divide: ['$finished', langs.length] },
        },
      },
    ]

    const pipeline = buildListPipelineFromRequest(
      { ...params, query: commonQuery },
      extraPipeline,
      true,
    )

    const [result] = await this.localeModel.aggregate<{
      data: ISysLocaleDocument[]
      total: number
    }>(pipeline).session(dbSession!)

    return result
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
