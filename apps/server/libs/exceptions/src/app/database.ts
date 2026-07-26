import { WalnutAdminConstAppResponseCode } from '@walnut/const/app/responseCode'
import { WalnutAdminExceptionInternalServerError } from '../base.exception'

// TODO not used
export class WalnutAdminExceptionDatabaseError extends WalnutAdminExceptionInternalServerError {
  constructor() {
    super({
      errCode: WalnutAdminConstAppResponseCode.INTERNAL_SERVER_ERROR_DATABASE,
    })
  }
}
