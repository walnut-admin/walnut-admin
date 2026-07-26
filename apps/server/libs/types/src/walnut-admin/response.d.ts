import type { IWalnutAdminConstAppResponseCode } from '@walnut/const/app/responseCode'
import { Recordable } from 'easy-fns-ts'

declare global {
  interface IWalnutAdminResponseBase<T = any> {
    data: T
    code?: IWalnutAdminConstAppResponseCode
    msg?: string
    requestId: string
    meta?: Recordable
    _devMsg?: string
  }

  interface IWalnutAdminResponseExceptionBase {
    errType: string
    errMsg: string
    errCode: IWalnutAdminConstAppResponseCode
    requestId: string
    meta?: Recordable
    _devMsg?: string
  }
}
export {}
