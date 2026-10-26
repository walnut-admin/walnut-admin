import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { WalnutDBCollectionName, WalnutDBModelName } from '@walnut-server/db'
import {
  WalnutAdminDecoratorFieldDate,
  WalnutAdminDecoratorFieldMongoId,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'

import { RealPickType } from '@walnut-server/utils/dto'
import { Recordable } from 'easy-fns-ts'
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
  // B9 迁 PG（phase2 4.17）：列收 jsonb，应用侧直存对象（不再 stringify）。
  // schema 仅作 DTO 元数据基座保留，TS 注解随列型放开为对象（B8 同款，@Prop 无运行时语义）
  @Prop({ type: String, required: true })
  content: Recordable

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
  // B9 迁 PG：uuid 列，注解随列型放开为 string（uuid 校验在 DTO 子类重声明）
  @Prop({ type: Types.ObjectId, required: true })
  deletedId: string

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
  // B9 迁 PG：uuid 松引用（Q3：删除者自己也可能被删，不建 FK），注解放开为 string
  @Prop({
    type: Types.ObjectId,
    ref: WalnutDBModelName.SYS_USER,
    required: true,
  })
  deletedBy: string

  @WalnutAdminDecoratorFieldMongoId({
    swaggerOptions: { title: 'log operate id' },
  })
  // B9 迁 PG：uuid 松引用可空（logOperateId 回填见 SysDeletedPgRepoService）
  @Prop({
    type: Types.ObjectId,
    ref: WalnutDBModelName.SYS_LOG_OPERATE,
  })
  logOperateId?: string | null
}

export const SysDeletedSchema = SchemaFactory.createForClass(SysDeletedModel)

// Virtual
addVirtualUserThroughUserId(SysDeletedSchema, 'deletedBy')
addVirtualLogOperateThroughLogId(SysDeletedSchema)
