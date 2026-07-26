import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose'
import { WalnutDBCollectionName } from '@walnut-server/db'
import {
  WalnutAdminDecoratorFieldBoolean,
  WalnutAdminDecoratorFieldDate,
  WalnutAdminDecoratorFieldEnum,
  WalnutAdminDecoratorFieldMongoId,
  WalnutAdminDecoratorFieldNumber,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'
import { WalnutAdminDecoratorFieldObject } from '@walnut-server/decorators/field/object.decorator'

import { ValueOf } from 'easy-fns-ts'
import { HydratedDocument, Model, Types } from 'mongoose'
import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'

const DemoConst = {
  TYPE1: 1,
  TYPE2: 2,
  TYPE3: 3,
  TYPE4: 4,
} as const

type DemoConstType = ValueOf<typeof DemoConst>

export type IAppDemoDocument = HydratedDocument<AppDemoModel & IAppDemoMethods>

export type IAppDemoModel = Model<IAppDemoDocument> & IAppDemoStatics

export interface IAppDemoMethods {}

export interface IAppDemoStatics { }

class DemoObject {
  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'this is title',
      description: 'this is description',
      example: 'this is an example',
    },
    validateOptions: {
      upper: true,
    },
  })
  o1: string

  @WalnutAdminDecoratorFieldNumber({
    default: null,
    swaggerOptions: {
      title: 'this is title',
      description: 'this is description',
      example: 123,
    },
    validateOptions: {
      int: true,
    },
  })
  o2: number

  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: {
      title: 'this is title',
      description: 'this is description',
      example: true,
    },
  })
  o3: boolean
}

@Schema({
  collection: WalnutDBCollectionName.APP_DEMO,
  versionKey: false,
  timestamps: true,
})
export class AppDemoModel extends WalnutAdminCommonBasicModel {
  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'this is title',
      description: 'this is description',
      example: 'this is an example',
    },
    validateOptions: {
      upper: true,
    },
    transformOptions: { req: { trim: true }, res: { lower: true } },
  })
  // unique: true => collection index
  @Prop({ type: String, default: null, unique: true })
  demoString: string

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'this is title',
      description: 'this is description',
      example: 'this is an example',
    },
    validateOptions: {
      // TODO too strict
      // phoneNumber: true,
    },
    transformOptions: { req: { trim: true }, res: { phoneNumberMask: true } },
  })
  // unique: true => collection index
  @Prop({ type: String, default: null, unique: true })
  demoPhoneNumber: string

  @WalnutAdminDecoratorFieldString({
    default: [],
    isArray: true,
    arrayOptions: {
      minSize: 1,
      maxSize: 3,
      contains: ['1'],
      notContains: ['2'],
      unique: true,
    },
    swaggerOptions: {
      title: 'this is title',
      description: 'this is description',
      example: [
        'this is an example',
        'this is an example',
        'this is an example',
      ],
    },
    validateOptions: {
      lower: true,
    },
    transformOptions: {
      res: { upper: true },
    },
  })
  @Prop([{ type: String, default: null }])
  demoStringArray: string[]

  @WalnutAdminDecoratorFieldNumber({
    default: null,
    swaggerOptions: {
      title: 'this is title',
      description: 'this is description',
      example: 123,
    },
    validateOptions: {
      precision: 4,
    },
    transformOptions: {
      res: {
        precision: 2,
        round: true,
      },
    },
  })
  @Prop({ type: Number, default: null })
  demoNumber: number

  @WalnutAdminDecoratorFieldNumber({
    default: [],
    isArray: true,
    arrayOptions: {
      minSize: 1,
      maxSize: 3,
      contains: [-1],
      notContains: [-2],
      unique: true,
    },
    swaggerOptions: {
      title: 'this is title',
      description: 'this is description',
      example: [123, 123, 123],
    },
    validateOptions: {
      positive: false,
    },
  })
  @Prop([{ type: Number, default: null }])
  demoNumberArray: number[]

  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: {
      title: 'this is title',
      description: 'this is description',
      example: true,
    },
  })
  @Prop({ type: Boolean, default: false })
  demoBoolean: boolean

  @WalnutAdminDecoratorFieldBoolean({
    default: [],
    isArray: true,
    arrayOptions: {
      minSize: 1,
      maxSize: 3,
    },
    swaggerOptions: {
      title: 'this is title',
      description: 'this is description',
      example: [true, false, true],
    },
  })
  @Prop([{ type: Boolean, default: false }])
  demoBooleanArray: boolean[]

  @WalnutAdminDecoratorFieldDate({
    default: null,
    swaggerOptions: {
      title: 'this is title',
      description: 'this is description',
      example: '2023-11-11 00:00:00',
    },
  })
  @Prop({ type: Date, default: null })
  demoDate: Date

  @WalnutAdminDecoratorFieldDate({
    default: [],
    isArray: true,
    arrayOptions: {
      minSize: 1,
      maxSize: 3,
      unique: true,
    },
    swaggerOptions: {
      title: 'this is title',
      description: 'this is description',
      example: [
        '2023-11-11 00:00:00',
        '2023-11-11 00:00:00',
        '2023-11-11 00:00:00',
      ],
    },
  })
  @Prop([{ type: Date, default: null }])
  demoDateArray: Date[]

  @WalnutAdminDecoratorFieldEnum(() => DemoConst, {
    default: DemoConst.TYPE1,
    swaggerOptions: {
      title: 'this is title',
      description: 'this is description',
      example: DemoConst.TYPE1,
    },
  })
  @Prop({ type: Number, enum: DemoConst, default: DemoConst.TYPE1 })
  demoEnum: DemoConstType

  @WalnutAdminDecoratorFieldEnum(() => DemoConst, {
    default: [],
    isArray: true,
    arrayOptions: {
      minSize: 1,
      maxSize: 3,
      unique: true,
    },
    swaggerOptions: {
      title: 'this is title',
      description: 'this is description',
      example: [DemoConst.TYPE1, DemoConst.TYPE2],
    },
  })
  @Prop([{ type: Number, enum: DemoConst, default: null }])
  demoEnumArray: DemoConstType[]

  @WalnutAdminDecoratorFieldMongoId({
    default: null,
    swaggerOptions: {
      title: 'this is title',
      description: 'this is description',
      example: '628f238fb7f0c07915e4c859',
    },
  })
  @Prop({ type: Types.ObjectId, default: null })
  demoMongoId: Types.ObjectId

  @WalnutAdminDecoratorFieldMongoId({
    default: [],
    isArray: true,
    arrayOptions: {
      minSize: 1,
      maxSize: 3,
      unique: true,
    },
    swaggerOptions: {
      title: 'this is title',
      description: 'this is description',
      example: ['628f238fb7f0c07915e4c859'],
    },
  })
  @Prop([{ type: Types.ObjectId, default: null }])
  demoMongoIdArray: Types.ObjectId[]

  @WalnutAdminDecoratorFieldObject(DemoObject, {
    default: null,
    swaggerOptions: {
      title: 'this is title',
      description: 'this is description',
      example: {
        o1: 'this is an example',
        o2: 123,
        o3: true,
      },
    },

  })
  @Prop({
    _id: false,
    type: {
      o1: String,
      o2: Number,
      o3: Boolean,
    },
  })
  demoObject: {
    o1: string
    o2: number
    o3: boolean
  }
}

export const AppDemoSchema = SchemaFactory.createForClass(AppDemoModel)
