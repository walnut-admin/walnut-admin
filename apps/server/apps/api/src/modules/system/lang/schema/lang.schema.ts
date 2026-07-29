import { Prop, Schema, SchemaFactory, Virtual } from '@nestjs/mongoose'
import { LocaleType, LocaleType } from '@walnut/contract'

import { WalnutDBCollectionName, WalnutDBModelName } from '@walnut-server/db'

import {
  WalnutAdminDecoratorFieldBoolean,
  WalnutAdminDecoratorFieldNumber,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'
import { HydratedDocument, Model } from 'mongoose'
import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'

export type ISysLangDocument = HydratedDocument<SysLangModel & ISysLangMethods>

export type ISysLangModel = Model<ISysLangDocument> & ISysLangStatics

export interface ISysLangMethods { }

export interface ISysLangStatics { }

@Schema({
  collection: WalnutDBCollectionName.LANG,
  versionKey: false,
  timestamps: true,
})
export class SysLangModel extends WalnutAdminCommonBasicModel {
  /**
   * @description how to remove indexes in mongodb
   * @link https://stackoverflow.com/questions/12337388/mongodb-remove-unique-constraint
   */
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'language short',
    },
  })
  @Prop({
    type: String,
    required: true,
    enums: [...Object.values(LocaleType)],
  })
  lang: LocaleType

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'language describe',
    },
  })
  @Prop({ type: String })
  description: string

  @WalnutAdminDecoratorFieldNumber({
    default: null,
    swaggerOptions: {
      title: 'language order',
      description: 'should be int',
    },
    validateOptions: { int: true },
  })
  @Prop({ type: Number, default: null })
  order: number

  @WalnutAdminDecoratorFieldBoolean({
    default: true,
    swaggerOptions: {
      title: 'language is in use or not',
    },
  })
  @Prop({ type: Boolean, default: true })
  status: boolean

  @WalnutAdminDecoratorFieldNumber({
    swaggerOptions: {
      title: `current lang's locales total count`,
    },
  })
  @Virtual({
    options: {
      ref: WalnutDBModelName.SYS_LOCALE,
      localField: '_id',
      foreignField: 'langId',
      count: true,
    },
  })
  populated_localesTotalCount: number

  @WalnutAdminDecoratorFieldNumber({
    swaggerOptions: {
      title: `current lang's locales finished count`,
    },
  })
  @Virtual({
    options: {
      ref: WalnutDBModelName.SYS_LOCALE,
      localField: '_id',
      foreignField: 'langId',
      match: {
        value: { $ne: null },
      },
      count: true,
    },
  })
  populated_localesFinishedCount: number
}

export const SysLangSchema = SchemaFactory.createForClass(SysLangModel)
