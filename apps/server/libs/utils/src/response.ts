import type { ValidationError } from '@nestjs/common'

import type { IWalnutAdminConstAppResponseCode } from '@walnut-server/const/app/responseCode'
import type { DeepKeyOf, Recordable } from 'easy-fns-ts'
import { isDev } from '@walnut-server/config/utils/env'
import { WalnutAdminConstAppResponseCode } from '@walnut-server/const/app/responseCode'

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
export function WalnutAdminResponseSuccess<T>(data: T, requestId: string, msg: string = `response.${WalnutAdminConstAppResponseCode.SUCCESS}`) {
  return WalnutAdminResponseBase<T>(data, WalnutAdminConstAppResponseCode.SUCCESS, msg, requestId)
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
