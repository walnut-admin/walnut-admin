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
  typeId: Types.ObjectId | string

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
