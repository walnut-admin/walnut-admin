import type { IWalnutAdminConstAppResponseCode } from '@walnut/const/app/responseCode'
import type { DeepKeyOf, Recordable } from 'easy-fns-ts'

declare global {
  type IWalnutAdminExceptionConstructorErrMsg = DeepKeyOf<Recordable>

  interface IWalnutAdminExceptionConstructor {
    requestId?: string
    errCode?: IWalnutAdminConstAppResponseCode
    errMsg?: IWalnutAdminExceptionConstructorErrMsg
    meta?: Recordable
    _devMsg?: string
  }

}
export { }