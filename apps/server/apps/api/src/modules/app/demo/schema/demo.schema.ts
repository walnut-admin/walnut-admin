import {
  WalnutAdminDecoratorFieldBoolean,
  WalnutAdminDecoratorFieldDate,
  WalnutAdminDecoratorFieldEnum,
  WalnutAdminDecoratorFieldNumber,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'

import { WalnutAdminDecoratorFieldObject } from '@walnut-server/decorators/field/object.decorator'
import { Expose } from 'class-transformer'

import { ValueOf } from 'easy-fns-ts'
import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'

const DemoConst = {
  TYPE1: 1,
  TYPE2: 2,
  TYPE3: 3,
  TYPE4: 4,
} as const

type DemoConstType = ValueOf<typeof DemoConst>

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
  demoNumberArray: number[]

  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: {
      title: 'this is title',
      description: 'this is description',
      example: true,
    },
  })
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
  demoBooleanArray: boolean[]

  @WalnutAdminDecoratorFieldDate({
    default: null,
    swaggerOptions: {
      title: 'this is title',
      description: 'this is description',
      example: '2023-11-11 00:00:00',
    },
  })
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
  demoDateArray: Date[]

  @WalnutAdminDecoratorFieldEnum(() => DemoConst, {
    default: DemoConst.TYPE1,
    swaggerOptions: {
      title: 'this is title',
      description: 'this is description',
      example: DemoConst.TYPE1,
    },
  })
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
  demoEnumArray: DemoConstType[]

  @Expose()
  // B1 迁 PG（phase2 4.20 demo_uuid）：属性 TS 类型随列型放开为 string；uuid 校验在
  // DTO 子类重声明接管（demo.dto.ts 模板），本 schema 的 Mongo 装饰器仅作为 DTO 元数据
  // 基座保留（模型注册已随迁移从 demo.module 摘除，@Prop 不再有运行时语义）
  demoMongoId: string

  @Expose()
  demoMongoIdArray: string[]

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
  demoObject: {
    o1: string
    o2: number
    o3: boolean
  }
}
