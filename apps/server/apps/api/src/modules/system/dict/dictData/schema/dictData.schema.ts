import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { WalnutDBCollectionName, WalnutDBModelName } from '@walnut-server/db'
import {
  WalnutAdminDecoratorFieldBoolean,
  WalnutAdminDecoratorFieldEnum,
  WalnutAdminDecoratorFieldMongoId,
  WalnutAdminDecoratorFieldNumber,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'
import { ValueOf } from 'easy-fns-ts'

import { HydratedDocument, Model, Types } from 'mongoose'
import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'

export type ISysDictDataDocument = HydratedDocument<SysDictDataModel & ISysDictDataMethods>

export type ISysDictDataModel = Model<ISysDictDataDocument> & ISysDictDataStatics

export interface ISysDictDataMethods {}

export interface ISysDictDataStatics {}

export const SysDictDataTagTypeConst = {
  PRIMARY: 'primary',
  INFO: 'info',
  SUCCESS: 'success',
  WARNING: 'warning',
  ERROR: 'error',
} as const

export type SysDictDataTagTypeConstType = ValueOf<typeof SysDictDataTagTypeConst>

/**
 * B3 迁移后仅作为 DTO 元数据基座保留（模型注册已随迁移从 dictData.module /
 * dictType.module 摘除，@Prop 不再有运行时语义）；PG 列型见 entity/dict-data.entity.ts。
 */
@Schema({
  collection: WalnutDBCollectionName.DICT_DATA,
  versionKey: false,
  timestamps: true,
})
export class SysDictDataModel extends WalnutAdminCommonBasicModel {
  @WalnutAdminDecoratorFieldMongoId({
    swaggerOptions: {
      title: 'dict type id',
      required: true,
    },
  })
  @Prop({
    required: true,
    type: Types.ObjectId,
    ref: WalnutDBModelName.SYS_DICT_TYPE,
  })
  // B3：TS 类型随 PG 列型放开为 string（uuid FK，phase2 4.7），uuid 校验在 DTO 子类接管
  typeId: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'dict data label',
      required: true,
    },
  })
  @Prop({ type: String, required: true })
  label: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'dict data value',
      required: true,
    },
  })
  @Prop({ type: String, required: true })
  value: string

  @WalnutAdminDecoratorFieldNumber({
    default: 0,
    swaggerOptions: {
      title: 'dict data order in array',
    },
    validateOptions: {
      int: true,
    },
  })
  @Prop({ type: Number, default: 0 })
  order: number

  @WalnutAdminDecoratorFieldBoolean({
    default: true,
    swaggerOptions: {
      title: 'dict data status, false will not be extracted',
    },
  })
  @Prop({ type: Boolean, default: true })
  status: boolean

  @WalnutAdminDecoratorFieldEnum(() => SysDictDataTagTypeConst, {
    default: SysDictDataTagTypeConst.PRIMARY,
    swaggerOptions: {
      title: 'dict data render tag type, see more in naive ui tag',
    },
  })
  @Prop({
    type: () => SysDictDataTagTypeConst,
    enum: [...Object.values(SysDictDataTagTypeConst)],
    default: SysDictDataTagTypeConst.PRIMARY,
  })
  tagType: SysDictDataTagTypeConstType

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'dict data description',
    },
  })
  @Prop({ type: String, default: null })
  description: string
}

export const SysDictDataSchema = SchemaFactory.createForClass(SysDictDataModel)
