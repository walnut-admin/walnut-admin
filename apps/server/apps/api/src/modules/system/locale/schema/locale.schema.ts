import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { WalnutDBCollectionName, WalnutDBModelName } from '@walnut-server/db'
import {
  WalnutAdminDecoratorFieldMongoId,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'

import { HydratedDocument, Model, Types } from 'mongoose'
import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'

import { LocaleLangIdValidate } from '../locale.validate'

export type ISysLocaleDocument = HydratedDocument<
  SysLocaleModel & ISysLocaleMethods
>

export type ISysLocaleModel = Model<ISysLocaleDocument> & ISysLocaleStatics

export interface ISysLocaleMethods {}

export interface ISysLocaleStatics {}

/**
 * B2 迁移后仅作为 DTO 元数据基座保留（模型注册已随迁移从 locale.module /
 * locale.repo.module / locale.shared.module 摘除，@Prop 不再有运行时语义）；
 * PG 列型见 entity/locale.entity.ts —— langId 由 ObjectId 放开为 uuid 字符串
 * （phase2 4.5），uuid 校验在 DTO 子类重声明接管。
 */
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
  // B2：TS 类型随 PG 列型放开为 string（uuid），校验在 DTO 子类接管
  langId: string

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
