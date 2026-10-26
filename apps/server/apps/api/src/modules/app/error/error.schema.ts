import { IWalnutAdminConstAppEnv, WalnutAdminConstAppEnv } from '@walnut-server/const/app/env'

import { IWalnutAdminConstAppHTTPMethods, WalnutAdminConstAppHTTPMethods } from '@walnut-server/const/app/methods'
import { WalnutAdminDecoratorFieldEnum, WalnutAdminDecoratorFieldNumber, WalnutAdminDecoratorFieldString } from '@walnut-server/decorators/field'
import { WalnutAdminDecoratorFieldObject } from '@walnut-server/decorators/field/object.decorator'
import { RealPickType } from '@walnut-server/utils/dto'
import { IWalnutAdminConstAppResponseCode, WalnutAdminConstAppResponseCode } from '@walnut/contract'
import { Expose } from 'class-transformer'
import { WalnutAdminCommonBasicModel } from '@/common/model/base.model'

class WalnutAdminRequestHeaders {}

class AppErrorPayload {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'request body, json.stringify',
    },
  })
  body: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'request params, json.stringify',
    },
  })
  params: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'request query, json.stringify',
    },
  })
  query: string
}

export class AppErrorModel extends RealPickType(WalnutAdminCommonBasicModel, ['_id', 'createdAt'] as const) {
  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'error message',
    },
  })
  message: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'error stack',
    },
  })
  stack: string

  @WalnutAdminDecoratorFieldNumber({
    swaggerOptions: {
      title: 'http status code',
    },
  })
  statusCode: number

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'path',
    },
  })
  path: string

  @WalnutAdminDecoratorFieldEnum(() => WalnutAdminConstAppHTTPMethods, {
    swaggerOptions: {
      title: 'http method, like get/post',
    },
  })
  method: IWalnutAdminConstAppHTTPMethods

  @WalnutAdminDecoratorFieldObject(WalnutAdminRequestHeaders, {
    swaggerOptions: {
      title: 'request headers',
    },
  })
  headers: object

  @WalnutAdminDecoratorFieldObject(AppErrorPayload, {
    swaggerOptions: {
      title: 'request payload',
    },
  })
  payload: AppErrorPayload

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'error type',
    },
  })
  errorType: string

  @Expose()
  userId: string

  @WalnutAdminDecoratorFieldEnum(() => WalnutAdminConstAppResponseCode, {
    swaggerOptions: {
      title: 'custom response code',
    },
  })
  responseCode: IWalnutAdminConstAppResponseCode

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'custom response message',
    },
  })
  responseMsg: string

  @WalnutAdminDecoratorFieldString({
    swaggerOptions: {
      title: 'ip address',
    },
  })
  ip: string

  @WalnutAdminDecoratorFieldEnum(() => WalnutAdminConstAppEnv, {
    swaggerOptions: {
      title: 'environment',
    },
  })
  env: IWalnutAdminConstAppEnv
}
