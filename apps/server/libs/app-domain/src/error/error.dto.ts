import { IWalnutAdminConstAppEnv, WalnutAdminConstAppEnv } from '@walnut-server/const/app/env'

import { IWalnutAdminConstAppHTTPMethods, WalnutAdminConstAppHTTPMethods } from '@walnut-server/const/app/methods'
import { WalnutAdminDecoratorFieldEnum, WalnutAdminDecoratorFieldNumber, WalnutAdminDecoratorFieldString } from '@walnut-server/decorators/field'
import { WalnutAdminDecoratorFieldObject } from '@walnut-server/decorators/field/object.decorator'
import { WalnutAdminCommonBasicModel } from '@walnut-server/identity'
import { RealOmitType, RealPickType } from '@walnut-server/utils/dto'
import { IWalnutAdminConstAppResponseCode, WalnutAdminConstAppResponseCode } from '@walnut/contract'
import { Expose } from 'class-transformer'

// 批 4 结构重构：schema 文件（原 error.schema.ts，与 dto 同级）并入 dto/，
// AppErrorModel 改名 AppErrorDTOBase，AppErrorPayload 随基座类一并搬入，
// 装饰器与字段本体零改动

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

export class AppErrorDTOBase extends RealPickType(WalnutAdminCommonBasicModel, ['createdAt'] as const) {
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

  @WalnutAdminDecoratorFieldObject(Object, {
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

class AppErrorDTO extends AppErrorDTOBase {
  constructor(partial: Partial<AppErrorDTO>) {
    super()
    Object.assign(this, partial)
  }
}

export class AppErrorDTOSafe extends RealOmitType(AppErrorDTO, [] as const) {
  constructor(partial: Partial<AppErrorDTOSafe>) {
    super()
    Object.assign(this, partial)
  }
}
