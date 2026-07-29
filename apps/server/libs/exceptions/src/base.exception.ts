import {
  BadRequestException,
  ForbiddenException,
  GatewayTimeoutException,
  HttpVersionNotSupportedException,
  InternalServerErrorException,
  NotFoundException,
  RequestTimeoutException,
  UnauthorizedException,
} from '@nestjs/common'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract'

export class WalnutAdminExceptionBadRequest extends BadRequestException {
  constructor(payload?: IWalnutAdminExceptionConstructor) {
    const {
      errCode = WalnutAdminConstAppResponseCode.BAD_REQUEST,
      errMsg = `response.${errCode}`,
      _devMsg,
    } = payload || {}
    super({ errType: BadRequestException.name, errCode, errMsg, _devMsg })
  }
}

export class WalnutAdminExceptionUnauthorized extends UnauthorizedException {
  constructor(payload?: IWalnutAdminExceptionConstructor) {
    const {
      errCode = WalnutAdminConstAppResponseCode.UNAUTHORIZED,
      errMsg = `response.${errCode}`,
      meta,
    } = payload || {}
    super({ errType: UnauthorizedException.name, errCode, errMsg, meta })
  }
}

export class WalnutAdminExceptionForbidden extends ForbiddenException {
  constructor(payload?: IWalnutAdminExceptionConstructor) {
    const {
      errCode = WalnutAdminConstAppResponseCode.FORBIDDEN,
      errMsg = `response.${errCode}`,
    } = payload || {}
    super({ errType: ForbiddenException.name, errCode, errMsg })
  }
}

export class WalnutAdminExceptionNotFound extends NotFoundException {
  constructor(payload?: IWalnutAdminExceptionConstructor) {
    const {
      errCode = WalnutAdminConstAppResponseCode.NOT_FOUND,
      errMsg = `response.${errCode}`,
    } = payload || {}
    super({ errType: NotFoundException.name, errCode, errMsg })
  }
}

export class WalnutAdminExceptionRequestTimeout extends RequestTimeoutException {
  constructor(payload?: IWalnutAdminExceptionConstructor) {
    const {
      errCode = WalnutAdminConstAppResponseCode.REQUEST_TIMEOUT,
      errMsg = `response.${errCode}`,
    } = payload || {}
    super({ errType: RequestTimeoutException.name, errCode, errMsg })
  }
}

export class WalnutAdminExceptionInternalServerError extends InternalServerErrorException {
  constructor(payload?: IWalnutAdminExceptionConstructor) {
    const {
      errCode = WalnutAdminConstAppResponseCode.INTERNAL_SERVER_ERROR,
      errMsg = `response.${errCode}`,
    } = payload || {}
    super({ errType: InternalServerErrorException.name, errCode, errMsg })
  }
}

export class WalnutAdminExceptionGatewayTimeout extends GatewayTimeoutException {
  constructor(payload?: IWalnutAdminExceptionConstructor) {
    const {
      errCode = WalnutAdminConstAppResponseCode.GATEWAY_TIMEOUT,
      errMsg = `response.${errCode}`,
    } = payload || {}
    super({ errType: GatewayTimeoutException.name, errCode, errMsg })
  }
}

export class WalnutAdminExceptionHttpVersionNotSupported extends HttpVersionNotSupportedException {
  constructor(payload?: IWalnutAdminExceptionConstructor) {
    const {
      errCode = WalnutAdminConstAppResponseCode.HTTP_VERSION_NOT_SUPPORTED,
      errMsg = `response.${errCode}`,
    } = payload || {}
    super({ errType: HttpVersionNotSupportedException.name, errCode, errMsg })
  }
}
