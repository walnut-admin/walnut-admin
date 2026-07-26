import { ServiceUnavailableException } from '@nestjs/common'
import { WalnutAdminConstAppResponseCode } from '@walnut-server/const/app/responseCode'

export class WalnutAdminExceptionServiceUnavailable extends ServiceUnavailableException {
  constructor(payload?: IWalnutAdminExceptionConstructor) {
    const {
      errCode = WalnutAdminConstAppResponseCode.SERVICE_UNAVAILABLE,
      errMsg = `response.${errCode}`,
    } = payload || {}
    super({ errType: ServiceUnavailableException.name, errCode, errMsg })
  }
}

export class WalnutAdminExceptionServiceUnavailableDependencyDown extends WalnutAdminExceptionServiceUnavailable {
  constructor() {
    super({
      errCode: WalnutAdminConstAppResponseCode.SERVICE_UNAVAILABLE_DEPENDENCY_DOWN,
    })
  }
}
