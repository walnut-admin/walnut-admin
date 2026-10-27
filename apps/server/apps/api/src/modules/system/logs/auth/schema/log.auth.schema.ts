import { IWalnutAdminConstDecoratorLogAuthType, WalnutAdminConstDecoratorLogAuthType } from '@walnut-server/const/decorator/logAuth'

import {
  WalnutAdminDecoratorFieldBoolean,
  WalnutAdminDecoratorFieldDate,
  WalnutAdminDecoratorFieldEnum,
  WalnutAdminDecoratorFieldString,
} from '@walnut-server/decorators/field'

import { Expose } from 'class-transformer'

import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'

export class SysLogAuthModel extends WalnutAdminCommonBasicModel {
  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'ip address when auth',
    },
    validateOptions: {
      ip: true,
    },
  })
  ip: string

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'location when auth',
    },
  })
  location: string | null

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'operating system when auth',
    },
  })
  os: string

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'browser when auth',
    },
  })
  browser: string

  @Expose()
  // B8 迁 PG（phase2 4.15）：user_id 松引用收 uuid —— uuid 校验在 DTO 子类重声明接管
  // （log.auth.dto.ts 模板），本 schema 的 Mongo 装饰器仅作为 DTO 元数据基座保留
  // （模型注册已随迁移从 log.auth.module 摘除，@Prop 不再有运行时语义）
  userId: string | null

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'user name when auth',
    },
  })
  userName: string | null

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'identifier when auth, e.g. email, phone number',
    },
  })
  identifier: string

  @WalnutAdminDecoratorFieldBoolean({
    default: false,
    swaggerOptions: {
      title: 'auth success or not',
    },
  })
  success: boolean

  @WalnutAdminDecoratorFieldString({
    default: null,
    swaggerOptions: {
      title: 'messages returned when auth',
    },
  })
  msg: string

  @WalnutAdminDecoratorFieldEnum(() => WalnutAdminConstDecoratorLogAuthType, {
    default: null,
    swaggerOptions: {
      title: 'auth type',
      example: WalnutAdminConstDecoratorLogAuthType.OPAQUE,
    },
  })
  type: IWalnutAdminConstDecoratorLogAuthType

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: { title: 'authenticate device id' },
  })
  deviceId: string

  @WalnutAdminDecoratorFieldDate({
    swaggerOptions: {
      title: 'authenticatedAt, also known as createdAt',
      required: false,
    },
  })
  authenticatedAt?: Date
}
