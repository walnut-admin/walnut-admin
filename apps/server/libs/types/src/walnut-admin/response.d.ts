import type { IWalnutAdminConstAppResponseCode } from '@walnut-server/const/app/responseCode'
import type { ResponseBase } from '@walnut/contract/response'
import type { Recordable } from 'easy-fns-ts'

declare global {
  /** Standard API success response — extends contract base with stricter code type */
  interface IWalnutAdminResponseBase<T = any> extends ResponseBase<T> {
    code?: IWalnutAdminConstAppResponseCode
    requestId: string
    meta?: Recordable
  }

  /** Exception/error response shape (backend-specific — not shared in contract) */
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
