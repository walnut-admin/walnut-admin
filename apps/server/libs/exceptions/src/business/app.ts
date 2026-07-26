import { WalnutAdminConstAppResponseCode } from '@walnut/const/app/responseCode'
import { WalnutAdminExceptionServiceUnavailable } from '../base/503'

export class WalnutAdminExceptionEndPointUnavailable extends WalnutAdminExceptionServiceUnavailable {
  constructor() {
    super({
      errCode: WalnutAdminConstAppResponseCode.SERVICE_UNAVAILABLE_ENDPOINT_DOWN,
    })
  }
}
