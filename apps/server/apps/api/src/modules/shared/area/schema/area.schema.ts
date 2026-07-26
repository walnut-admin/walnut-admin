import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { WalnutDBCollectionName, WalnutDBModelName } from '@walnut-server/db'
import { WalnutAdminDecoratorFieldString } from '@walnut-server/decorators/field'

import { HydratedDocument, Model } from 'mongoose'
import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'

export type ISharedAreaDocument = HydratedDocument<
  SharedAreaModel & ISharedAreaMethods
>

export type ISharedAreaModel = Model<ISharedAreaDocument> & ISharedAreaStatics

export interface ISharedAreaMethods {}

export interface ISharedAreaStatics {}

@Schema({
  collection: WalnutDBCollectionName.SHARED_AREA,
  versionKey: false,
  timestamps: false,
})
export class SharedAreaModel extends WalnutAdminCommonBasicModel {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'unique area code, length 1/2/4/6/9',
    },
  })
  @Prop({ type: String, index: true, unique: true, required: true })
  code: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'area name',
    },
  })
  @Prop({ type: String, required: true })
  name: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'parent area code',
    },
  })
  @Prop({
    type: String,
    ref: WalnutDBModelName.SHARED_AREA,
    required: true,
  })
  pcode: string
}

export const SharedAreaSchema = SchemaFactory.createForClass(SharedAreaModel)

SharedAreaSchema.virtual('children', {
  ref: 'SharedAreaModel',
  localField: 'code',
  foreignField: 'pcode',
})

SharedAreaSchema.virtual('parent', {
  ref: 'SharedAreaModel',
  localField: 'pcode',
  foreignField: 'code',
})
