import type { IWalnutAdminConstAppResponseCode } from '@walnut/const/app/responseCode'
import type { Recordable } from 'easy-fns-ts'
import type { I18nContext } from 'nestjs-i18n'

import { HttpException, HttpStatus } from '@nestjs/common'
import { WalnutAdminConstAppResponseCode } from '@walnut/const/app/responseCode'
import { WalnutAdminResponseException } from '@walnut/utils/response'
import { mongo, MongooseError } from 'mongoose'

export function WalnutAdminExceptionHandler(e: Error, requestId: string, i18n: I18nContext): IWalnutAdminResponseBase {
  // ========== 1. MongoDB Driver Errors (mongo.MongoError) ==========
  // 这一层主要捕获底层的驱动错误，比如连接断开、重复键等
  if (e instanceof mongo.MongoError) {
    // 11000: Unique constraint violated (Duplicate Key)
    if (e.code === 11000) {
      return WalnutAdminResponseException(
        {
          errCode: WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_EXISTS,
          _devMsg: e.message,
          requestId,
        },
      )
    }

    return WalnutAdminResponseException(
      {
        errCode: WalnutAdminConstAppResponseCode.INTERNAL_SERVER_ERROR_DATABASE,
        _devMsg: e.message,
        requestId,
      },
    )
  }

  // ========== 2. Mongoose Errors (MongooseError) ==========
  // 这一层捕获 Mongoose 特有的逻辑错误，如类型转换失败、Schema校验失败
  if (e instanceof MongooseError) {
    // CastError: 类型转换失败，最常见的是传了无效的 ID (ObjectId)
    if (e.name === 'CastError') {
      return WalnutAdminResponseException(
        {
          errCode: WalnutAdminConstAppResponseCode.BAD_REQUEST_INVALID_ID,
          _devMsg: e.message,
          requestId,
        },
      )
    }

    // ValidationError: Schema 校验失败
    if (e.name === 'ValidationError') {
      return WalnutAdminResponseException(
        {
          errCode: WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR,
          _devMsg: e.message,
          requestId,
        },
      )
    }

    // 其他 Mongoose 错误 (如 VersionError, ObjectParameterError 等)
    return WalnutAdminResponseException(
      {
        errCode: WalnutAdminConstAppResponseCode.INTERNAL_SERVER_ERROR_DATABASE,
        _devMsg: e.message,
        requestId,
      },
    )
  }

  // ========== 3. HttpException (NestJS Built-in or Custom) ==========
  if (e instanceof HttpException) {
    const status = e.getStatus()
    const response = e.getResponse()

    // 处理自定义异常（带有 errCode 字段）
    if (typeof response === 'object' && response !== null && 'errCode' in response) {
      const err = response as IWalnutAdminResponseExceptionBase
      const errCode = err.errCode
      const errMsg = err.errMsg
      const devMsg = err._devMsg ?? errMsg
      const _meta = err.meta as Recordable

      return WalnutAdminResponseException(
        {
          errCode,
          errMsg: errMsg ? i18n.t(errMsg) : undefined,
          _devMsg: devMsg,
          requestId,
          meta: _meta,
        },
      )
    }

    // 处理 NestJS 原生异常（如 BadRequestException, NotFoundException 等）
    // 将标准的 HTTP 状态码映射到我们的自定义业务错误码
    let mappedErrCode: IWalnutAdminConstAppResponseCode = WalnutAdminConstAppResponseCode.INTERNAL_SERVER_ERROR
    const devMessage: string = typeof response === 'string' ? response : (response as Error).message

    switch (status) {
      case HttpStatus.BAD_REQUEST:
        mappedErrCode = WalnutAdminConstAppResponseCode.BAD_REQUEST
        break
      case HttpStatus.UNAUTHORIZED:
        mappedErrCode = WalnutAdminConstAppResponseCode.UNAUTHORIZED
        break
      case HttpStatus.FORBIDDEN:
        mappedErrCode = WalnutAdminConstAppResponseCode.FORBIDDEN
        break
      case HttpStatus.NOT_FOUND:
        mappedErrCode = WalnutAdminConstAppResponseCode.NOT_FOUND
        break
      case HttpStatus.TOO_MANY_REQUESTS:
        mappedErrCode = WalnutAdminConstAppResponseCode.TOO_MANY_REQUESTS
        break
      case HttpStatus.REQUEST_TIMEOUT:
        mappedErrCode = WalnutAdminConstAppResponseCode.REQUEST_TIMEOUT
        break
      default:
        mappedErrCode = WalnutAdminConstAppResponseCode.INTERNAL_SERVER_ERROR
        break
    }

    return WalnutAdminResponseException(
      {
        errCode: mappedErrCode,
        requestId,
        _devMsg: devMessage || e.message,
      },
    )
  }

  // ========== 4. TypeError (Runtime Error) ==========
  if (e instanceof TypeError) {
    return WalnutAdminResponseException(
      {
        errCode: WalnutAdminConstAppResponseCode.INTERNAL_SERVER_ERROR,
        requestId,
        _devMsg: e.message,
      },
    )
  }

  // ========== 5. Fallback ==========
  return WalnutAdminResponseException(
    {
      errCode: WalnutAdminConstAppResponseCode.INTERNAL_SERVER_ERROR,
      requestId,
      _devMsg: e.message ?? 'Unknown Error',
    },
  )
}
