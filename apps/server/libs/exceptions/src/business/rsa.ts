import { WalnutAdminConstAppResponseCode } from '@walnut/const/app/responseCode'
import { WalnutAdminExceptionBadRequest } from '../base.exception'

export class WalnutAdminExceptionRsaDecryptFailed extends WalnutAdminExceptionBadRequest {
  constructor() {
    super({
      errCode: WalnutAdminConstAppResponseCode.BAD_REQUEST_DECRYPT_FAILED,
    })
  }
}

export class WalnutAdminExceptionRsaPubKeyNotFound extends WalnutAdminExceptionBadRequest {
  constructor() {
    super({
      errCode: WalnutAdminConstAppResponseCode.BAD_REQUEST_RSA_PUB_KEY_NOT_FOUND,
    })
  }
}
