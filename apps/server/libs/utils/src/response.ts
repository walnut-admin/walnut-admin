import type { ValidationError } from '@nestjs/common'

import type { IWalnutAdminConstAppResponseCode } from '@walnut/contract'
import type { DeepKeyOf, Recordable } from 'easy-fns-ts'
import { isDev } from '@walnut-server/const/app/env'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract'

export interface IWalnutAdminResponsePayload {
  requestId?: string
  errCode?: IWalnutAdminConstAppResponseCode
  errMsg?: DeepKeyOf<Recordable>
  meta?: Recordable
  _devMsg?: string
}

// base response structure
function WalnutAdminResponseBase<T>(data: T, code: IWalnutAdminConstAppResponseCode, msg: string, requestId: string, _devMsg?: string, meta?: Recordable): IWalnutAdminResponseBase<T> {
  if (isDev) {
    return {
      data,
      code,
      msg,
      meta,
      requestId,
      _devMsg,
    }
  }

  return {
    data,
    code,
    msg,
    meta,
    requestId,
  }
}

// success
/**
 * 成功响应壳。
 *
 * `meta` 是**可选**的可观测通道（批次 8 / B2 起由成功拦截器传 `{ riskDegraded }`）：
 * 只在有内容时传，缺省时 JSON 序列化会把 undefined 键丢掉 ⇒ 既有响应形态零变化。
 */
export function WalnutAdminResponseSuccess<T>(
  data: T,
  requestId: string,
  msg: string = `response.${WalnutAdminConstAppResponseCode.SUCCESS}`,
  meta?: Recordable,
) {
  return WalnutAdminResponseBase<T>(data, WalnutAdminConstAppResponseCode.SUCCESS, msg, requestId, undefined, meta)
}

// exception
export function WalnutAdminResponseException<T>(payload: IWalnutAdminResponsePayload) {
  const {
    errCode = WalnutAdminConstAppResponseCode.BAD_REQUEST,
    errMsg = `response.${errCode}`,
    requestId,
    _devMsg,
    meta,
  } = payload
  return WalnutAdminResponseBase<T>(
    null as T,
    errCode,
    errMsg,
    requestId!,
    _devMsg,
    meta,
  )
}

// https://stackoverflow.com/questions/71975630/how-to-return-a-clean-message-for-nested-validation-error-on-nestjs
export function getAllConstraints(errors: ValidationError[]): string[] {
  const constraints: string[] = []

  for (const error of errors) {
    if (error.constraints) {
      const constraintValues = Object.values(error.constraints)
      constraints.push(...constraintValues)
    }

    if (error.children) {
      const childConstraints = getAllConstraints(error.children)
      constraints.push(...childConstraints)
    }
  }

  return constraints
}
