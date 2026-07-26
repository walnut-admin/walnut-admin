import { WalnutAdminConstAppResponseCode } from '@walnut/const/app/responseCode'
import { WalnutAdminExceptionNotFound } from '../base.exception'

export class WalnutAdminExceptionDataNotFound extends WalnutAdminExceptionNotFound {
  constructor() {
    super({
      errCode: WalnutAdminConstAppResponseCode.NOT_FOUND_DATA_NOT_FOUND,
    })
  }
}

// TODO not used
export class WalnutAdminExceptionRouteNotFound extends WalnutAdminExceptionNotFound {
  constructor() {
    super({
      errCode: WalnutAdminConstAppResponseCode.NOT_FOUND_ROUTE_NOT_FOUND,
    })
  }
}
