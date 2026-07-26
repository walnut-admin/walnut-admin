import { WalnutAdminConstAppResponseCode } from '@walnut/const/app/responseCode'
import { WalnutAdminExceptionBadRequest } from '../base.exception'

export class WalnutAdminExceptionDataExists extends WalnutAdminExceptionBadRequest {
  constructor() {
    super({
      errCode: WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_EXISTS,
    })
  }
}

export class WalnutAdminExceptionInvalidID extends WalnutAdminExceptionBadRequest {
  constructor() {
    super({
      errCode: WalnutAdminConstAppResponseCode.BAD_REQUEST_INVALID_ID,
    })
  }
}

export class WalnutAdminExceptionRequestDataError extends WalnutAdminExceptionBadRequest {
  constructor(msg?: string) {
    super({
      errCode: WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR,
      _devMsg: msg,
    })
  }
}
