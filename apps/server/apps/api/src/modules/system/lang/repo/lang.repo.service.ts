import { Injectable } from '@nestjs/common'
import { WalnutDBCollectionName, WalnutDBInjectModel, WalnutDBModelName } from '@walnut-server/db'
import { LocaleType } from '@walnut/contract'
import { Types } from 'mongoose'

import { ISysLangModel, SysLangModel } from '../schema/lang.schema'

/**
 * Lang Repository Service
 *
 * Provides simple CRUD operations for cross-module access.
 * NO business logic - only data access.
 */
@Injectable()
export class SysLangRepoService {
  constructor(
    @WalnutDBInjectModel(WalnutDBModelName.SYS_LANG)
    private readonly langModel: ISysLangModel,
  ) {}

  /**
   * @description find lang by id with locale counts
   */
  async findByIdWithLocaleCounts(id: string) {
    const res = await this.langModel.aggregate([
      {
        $match: {
          _id: new Types.ObjectId(id),
        },
      },
      {
        $lookup: {
          from: WalnutDBCollectionName.LOCALE,
          localField: '_id',
          foreignField: 'langId',
          as: 'totalCount',
        },
      },
      { $addFields: { populated_localesTotalCount: { $size: '$totalCount' } } },
      { $unset: 'totalCount' },
      {
        $lookup: {
          from: WalnutDBCollectionName.LOCALE,
          localField: '_id',
          foreignField: 'langId',
          as: 'finishedCount',
          pipeline: [
            {
              $match: {
                value: { $ne: null },
              },
            },
          ],
        },
      },
      { $addFields: { populated_localesFinishedCount: { $size: '$finishedCount' } } },
      { $unset: 'finishedCount' },
    ])

    return res[0] as SysLangModel
  }

  /**
   * @description find all langs
   */
  async findAll() {
    return this.langModel.find()
  }

  /**
   * @description find public langs (status = true)
   */
  async findPublic() {
    return this.langModel
      .find({ status: true }, { order: 1, lang: 1, description: 1, _id: 0 })
      .lean()
  }

  /**
   * @description get locale messages by language name
   */
  async findMessagesByLang(lang: LocaleType) {
    const res = await this.langModel.aggregate<Record<string, string>>([
      {
        $match: { lang },
      },
      {
        $lookup: {
          from: WalnutDBCollectionName.LOCALE,
          let: { id: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $eq: ['$langId', { $toObjectId: '$$id' }],
                },
              },
            },
          ],
          as: 'msg',
        },
      },
      {
        $project: {
          data: {
            $arrayToObject: {
              $map: {
                input: '$msg',
                as: 'm',
                in: {
                  k: '$$m.key',
                  v: '$$m.value',
                },
              },
            },
          },
        },
      },
    ])

    return res[0]
  }
}
