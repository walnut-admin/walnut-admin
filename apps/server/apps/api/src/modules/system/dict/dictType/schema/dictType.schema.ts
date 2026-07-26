import { Prop, Schema, SchemaFactory, Virtual } from '@nestjs/mongoose'
import { WalnutDBCollectionName, WalnutDBModelName } from '@walnut/db'

import {
  WalnutAdminDecoratorFieldBoolean,
  WalnutAdminDecoratorFieldNumber,
  WalnutAdminDecoratorFieldObject,
  WalnutAdminDecoratorFieldString,
} from '@walnut/decorators/field'

import { HydratedDocument, Model } from 'mongoose'
import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'
import { SysDictDataDTOPopulatedDictData } from '../../dictData/dto/dictData.dto'

export type ISysDictTypeDocument = HydratedDocument<
  SysDictTypeModel & ISysDictTypeMethods
>

export type ISysDictTypeModel = Model<ISysDictTypeDocument>
  & ISysDictTypeStatics

export interface ISysDictTypeMethods { }

export interface ISysDictTypeStatics { }

@Schema({
  collection: WalnutDBCollectionName.DICT_TYPE,
  versionKey: false,
  timestamps: true,
})
export class SysDictTypeModel extends WalnutAdminCommonBasicModel {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'dict name',
      required: true,
    },
  })
  @Prop({ type: String, required: true })
  name: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'dict type or can be treated as dict key',
      required: true,
    },
  })
  @Prop({ type: String, required: true, unique: true, index: true })
  type: string

  @WalnutAdminDecoratorFieldBoolean({
    swaggerOptions: {
      title: 'dict status',
    },
  })
  @Prop({ type: Boolean, default: true })
  status: boolean

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'description',
    },
  })
  @Prop({ type: String, default: null })
  description: string

  // virtual
  @WalnutAdminDecoratorFieldObject(SysDictDataDTOPopulatedDictData, {
    swaggerOptions: {
      title: 'populated dict data',
    },
  })
  @Virtual({
    options: {
      ref: WalnutDBModelName.SYS_DICT_DATA,
      localField: '_id',
      foreignField: 'typeId',
    },
  })
  populated_dictData?: SysDictDataDTOPopulatedDictData

  @WalnutAdminDecoratorFieldNumber({
    swaggerOptions: {
      title: `populated dict data count`,
    },
  })
  @Virtual({
    options: {
      ref: WalnutDBModelName.SYS_DICT_DATA,
      localField: '_id',
      foreignField: 'typeId',
      count: true,
    },
  })
  populated_dictDataCount?: number
}

export const SysDictTypeSchema = SchemaFactory.createForClass(SysDictTypeModel)
