import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { WalnutDBCollectionName, WalnutDBModelName } from '@walnut/db'
import {
  WalnutAdminDecoratorFieldMongoId,
  WalnutAdminDecoratorFieldString,
} from '@walnut/decorators/field'

import { HydratedDocument, Model, Types } from 'mongoose'
import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'

import { LocaleLangIdValidate } from '../locale.validate'

export type ISysLocaleDocument = HydratedDocument<
  SysLocaleModel & ISysLocaleMethods
>

export type ISysLocaleModel = Model<ISysLocaleDocument> & ISysLocaleStatics

export interface ISysLocaleMethods {}

export interface ISysLocaleStatics {}

@Schema({
  collection: WalnutDBCollectionName.LOCALE,
  versionKey: false,
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
})
export class SysLocaleModel extends WalnutAdminCommonBasicModel {
  @WalnutAdminDecoratorFieldMongoId({
    swaggerOptions: {
      title: 'language Id',
    },
    validateOptions: {
      // experience
      // you can write your own validate function and pass it through
      validate: LocaleLangIdValidate,
    },
  })
  @Prop({
    type: Types.ObjectId,
    required: true,
    ref: WalnutDBModelName.SYS_LANG,
  })
  langId: Types.ObjectId

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      required: true,
      title: 'i18n key',
    },
  })
  @Prop({ type: String, index: true, required: true })
  key: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'i18n value',
    },
    validateOptions: {
      nullable: true,
    },
  })
  @Prop({ type: String, default: null })
  value: string
}

export const SysLocaleSchema = SchemaFactory.createForClass(SysLocaleModel)
