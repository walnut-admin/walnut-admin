import type { IWalnutAdminConstAppResponseCode } from '@walnut/contract'
import type { Recordable } from 'easy-fns-ts'
import type { I18nContext } from 'nestjs-i18n'

import { HttpException, HttpStatus } from '@nestjs/common'
import { WalnutAdminResponseException } from '@walnut-server/utils/response'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract'
import { QueryFailedError } from 'typeorm'

export function WalnutAdminExceptionHandler(e: Error, requestId: string, i18n: I18nContext): IWalnutAdminResponseBase {
  // ========== 1. HttpException (NestJS Built-in or Custom) ==========
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

  // ========== 2. QueryFailedError（TypeORM 驱动层）==========
  // PG 约束类错误统一收敛为受控 40000（约束名进 _devMsg 供排查），无映射时兜底 50000：
  // - 23514 check_violation：字段值违反 CHECK（枚举/数值域列收到越值），2026-10-27 先行收敛；
  // - 23505 unique_violation：唯一键冲突（如 uq_user_name / uq_dict_type），P1-7 修复；
  // - 23503 foreign_key_violation：外键引用不存在（如 role create 的 junction 腿），P1-7 修复。
  // CHECK 值集与 DTO/const 的三方一致性由 dto-entity.drift.spec 的枚举守卫钉住。
  if (e instanceof QueryFailedError) {
    const driverError = e.driverError as { code?: string, constraint?: string, column?: string } | undefined

    if (driverError?.code === '23514') {
      const detail = [driverError.constraint, driverError.column]
        .filter((field): field is string => field !== undefined)
        .join(' / ')

      return WalnutAdminResponseException({
        errCode: WalnutAdminConstAppResponseCode.BAD_REQUEST,
        requestId,
        _devMsg: `DB check constraint violated${detail.length > 0 ? `: ${detail}` : ''}`,
      })
    }

    if (driverError?.code === '23505' || driverError?.code === '23503') {
      const constraint = driverError.constraint

      return WalnutAdminResponseException({
        errCode: WalnutAdminConstAppResponseCode.BAD_REQUEST,
        requestId,
        _devMsg: `DB ${driverError.code === '23505' ? 'unique' : 'foreign key'} constraint violated${constraint !== undefined ? `: ${constraint}` : ''}`,
      })
    }
  }

  // ========== 3. TypeError (Runtime Error) ==========
  if (e instanceof TypeError) {
    return WalnutAdminResponseException(
      {
        errCode: WalnutAdminConstAppResponseCode.INTERNAL_SERVER_ERROR,
        requestId,
        _devMsg: e.message,
      },
    )
  }

  // ========== 4. Fallback ==========
  return WalnutAdminResponseException(
    {
      errCode: WalnutAdminConstAppResponseCode.INTERNAL_SERVER_ERROR,
      requestId,
      _devMsg: e.message ?? 'Unknown Error',
    },
  )
}
