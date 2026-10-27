import { IWalnutAdminConstAppHTTPMethods, WalnutAdminConstAppHTTPMethods } from '@walnut-server/const/app/methods'

import { IWalnutAdminConstDecoratorLogOperateAction, IWalnutAdminConstDecoratorLogOperateType, WalnutAdminConstDecoratorLogOperateAction, WalnutAdminConstDecoratorLogOperateType } from '@walnut-server/const/decorator/logOperate'
import {
  WalnutAdminDecoratorFieldBoolean,
  WalnutAdminDecoratorFieldDate,
  WalnutAdminDecoratorFieldEnum,
  WalnutAdminDecoratorFieldNumber,
  WalnutAdminDecoratorFieldObject,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'

import { Expose } from 'class-transformer'
import { IsOptional } from 'class-validator'
import { Recordable } from 'easy-fns-ts'
import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'

export class SysLogOperateModel extends WalnutAdminCommonBasicModel {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'operate title, developer customise',
    },
  })
  title: string

  @WalnutAdminDecoratorFieldEnum(() => WalnutAdminConstDecoratorLogOperateAction, {
    swaggerOptions: {
      title: 'operate action type',
    },
  })
  actionType: IWalnutAdminConstDecoratorLogOperateAction

  @WalnutAdminDecoratorFieldEnum(() => WalnutAdminConstDecoratorLogOperateType, {
    swaggerOptions: {
      title: 'operate type',
    },
  })
  operation: IWalnutAdminConstDecoratorLogOperateType

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'http method, like get/post',
    },
    validateOptions: {
      onlyIn: [...Object.values(WalnutAdminConstAppHTTPMethods)],
    },
  })
  method: IWalnutAdminConstAppHTTPMethods

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'http url',
    },
    validateOptions: {
      url: true,
    },
  })
  url: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'http version, like 1.1/2.0',
    },
  })
  httpVersion: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'operate location, address string',
    },
  })
  location: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'operate operating system',
    },
  })
  os: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'operate browser',
    },
  })
  browser: string

  @WalnutAdminDecoratorFieldNumber({
    swaggerOptions: {
      title: 'http status code',
    },
  })
  statusCode: number

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'requset data, stringified',
    },
  })
  // B8 迁 PG（phase2 4.16 / Q7 定案）：列收 jsonb，应用新增直写对象（不再 stringify）；
  // parse 失败原文落同表 raw_request_data text 旁路列。schema 仅作 DTO 元数据基座保留，
  // TS 注解随列型放开为对象（@Prop 不再有运行时语义）；列可空，注解带 null
  requestData: Recordable | null

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'response data, stringified',
    },
  })
  // B8 迁 PG：同 requestData（jsonb 列 + raw_response_data 旁路）
  responseData: Recordable | null

  @WalnutAdminDecoratorFieldNumber({
    swaggerOptions: {
      title: 'responsed milliseconds',
    },
  })
  correspondingMS: number

  @Expose()
  // B8 迁 PG（phase2 4.16）：user_id 松引用收 uuid，列可空 —— uuid 校验在 DTO 子类
  // 重声明接管（log.operate.dto.ts 模板），TS 注解随列型放开带 null；本 schema 的
  // Mongo 装饰器仅作为 DTO 元数据基座保留（模型注册已随迁移从 log.operate.module
  // 摘除，@Prop 不再有运行时语义）
  userId: string | null

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'operater user name',
    },
  })
  userName: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: { title: 'operate device id' },
  })
  deviceId: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'operate ip',
    },
  })
  ip: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'operate invoked service and method',
    },
  })
  invokingMethod: string

  @WalnutAdminDecoratorFieldBoolean({
    swaggerOptions: {
      title: 'operate success or not',
    },
  })
  success: boolean

  @WalnutAdminDecoratorFieldDate({
    swaggerOptions: {
      title: 'operatedAt, also known as createdAt',
      required: false,
    },
  })
  @IsOptional({})
  @Expose({})
  operatedAt?: Date

  @WalnutAdminDecoratorFieldObject(Object, {
    swaggerOptions: {
      description: 'snapshot before, mask sensitive object',
    },
    validateOptions: {
      any: true,
    },
    transformOptions: {
      res: {
        maskSensitive: true,
      },
    },
  })
  snapshotBefore: Recordable

  @WalnutAdminDecoratorFieldObject(Object, {
    swaggerOptions: {
      description: 'snapshot after, mask sensitive object',
    },
    validateOptions: {
      any: true,
    },
    transformOptions: {
      res: {
        maskSensitive: true,
      },
    },
  })
  snapshotAfter: Recordable
}
