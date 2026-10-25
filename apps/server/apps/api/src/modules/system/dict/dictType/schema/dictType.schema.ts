import { Prop, Schema, SchemaFactory, Virtual } from '@nestjs/mongoose'
import { WalnutDBCollectionName, WalnutDBModelName } from '@walnut-server/db'

import {
  WalnutAdminDecoratorFieldBoolean,
  WalnutAdminDecoratorFieldNumber,
  WalnutAdminDecoratorFieldObject,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'

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

/**
 * B3 迁移后仅作为 DTO 元数据基座保留（模型注册已随迁移从 dictType.module 摘除，
 * @Prop/@Virtual 不再有运行时语义）；PG 列型见 entity/dict-type.entity.ts，
 * populated_dictData / populated_dictDataCount 两个 virtual 在 PG 侧改为相关子查询
 * （dictType.basic.repository 的 list 覆写 / getByType 的两次取数）。
 */
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
