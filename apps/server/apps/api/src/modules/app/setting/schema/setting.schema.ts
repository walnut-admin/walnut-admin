import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { IWalnutAdminConstAppSettingType, WalnutAdminConstAppSettingType } from '@walnut/const/app/setting'

import { WalnutDBCollectionName } from '@walnut/db'

import { WalnutAdminDecoratorFieldEnum, WalnutAdminDecoratorFieldString } from '@walnut/decorators/field'
import { HydratedDocument, Model } from 'mongoose'

import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'

export type IAppSettingDocument = HydratedDocument<
  AppSettingModel & IAppSettingMethods
>

export type IAppSettingModel = Model<IAppSettingDocument> & IAppSettingStatics

export interface IAppSettingMethods { }

export interface IAppSettingStatics { }

@Schema({
  collection: WalnutDBCollectionName.APP_SETTING,
  versionKey: false,
  timestamps: true,
})
export class AppSettingModel extends WalnutAdminCommonBasicModel {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'setting name',
    },
  })
  @Prop({ type: String, required: true })
  settingName: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'setting key',
    },
  })
  @Prop({ type: String, required: true, unique: true })
  settingKey: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'setting value',
    },
  })
  @Prop({ type: String, required: true })
  settingValue: string

  @WalnutAdminDecoratorFieldEnum(() => WalnutAdminConstAppSettingType, {
    swaggerOptions: {
      title: 'setting type',
    },
  })
  @Prop({
    type: String,
    required: true,
    enums: [...Object.values(WalnutAdminConstAppSettingType)],
  })
  settingType: IWalnutAdminConstAppSettingType

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'setting remark',
    },
  })
  @Prop({ type: String, default: null })
  remark: string
}

export const AppSettingSchema = SchemaFactory.createForClass(AppSettingModel)
