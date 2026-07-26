import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { WalnutDBCollectionName, WalnutDBModelName } from '@walnut-server/db'
import {
  WalnutAdminDecoratorFieldDate,
  WalnutAdminDecoratorFieldMongoId,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'

import { RealPickType } from '@walnut-server/utils/dto'
import { HydratedDocument, Model, Types } from 'mongoose'
import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'
import { addVirtualLogOperateThroughLogId, IVirtualLogOperate } from '@/common/model/virtual/logOperate'
import { addVirtualUserThroughUserId, IVirtualUser } from '@/common/model/virtual/user'

export type ISysDeletedDocument = HydratedDocument<
  SysDeletedModel & ISysDeletedMethods & IVirtualUser & IVirtualLogOperate
>

export type ISysDeletedModel = Model<ISysDeletedDocument> & ISysDeletedStatics

interface ISysDeletedMethods {}

interface ISysDeletedStatics {}

@Schema({
  collection: WalnutDBCollectionName.DELETED,
  versionKey: false,
  timestamps: {
    createdAt: 'deletedAt',
    updatedAt: false,
  },
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
})
export class SysDeletedModel extends RealPickType(WalnutAdminCommonBasicModel, ['_id'] as const) {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'Deleted Stringify Content',
      description: 'use `JSON.stringify` to store the deleted document',
    },
  })
  @Prop({ type: String, required: true })
  content: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'Deleted Document Model Name',
      description: 'use `modelName` to ensure the right model',
    },
  })
  @Prop({ type: String, required: true })
  modelName: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'Deleted Document Collection Name',
      description: 'use `modelName` to recover, this field is only a record',
    },
  })
  @Prop({ type: String, required: true })
  collectionName: string

  @WalnutAdminDecoratorFieldMongoId({
    swaggerOptions: {
      title: 'Deleted Document Id',
      description: 'use `deletedId` to recover the deleted document',
    },
  })
  @Prop({ type: Types.ObjectId, required: true })
  deletedId: Types.ObjectId | string

  @WalnutAdminDecoratorFieldDate({
    swaggerOptions: {
      title: 'Deleted time',
      description: 'which means `createdAt`',
    },
  })
  @Prop({ type: Date })
  deletedAt?: Date

  @WalnutAdminDecoratorFieldMongoId({
    swaggerOptions: { title: 'operater user id' },
  })
  @Prop({
    type: Types.ObjectId,
    ref: WalnutDBModelName.SYS_USER,
    required: true,
  })
  deletedBy: Types.ObjectId | string

  @WalnutAdminDecoratorFieldMongoId({
    swaggerOptions: { title: 'log operate id' },
  })
  @Prop({
    type: Types.ObjectId,
    ref: WalnutDBModelName.SYS_LOG_OPERATE,
  })
  logOperateId?: Types.ObjectId | string
}

export const SysDeletedSchema = SchemaFactory.createForClass(SysDeletedModel)

// Virtual
addVirtualUserThroughUserId(SysDeletedSchema, 'deletedBy')
addVirtualLogOperateThroughLogId(SysDeletedSchema)
