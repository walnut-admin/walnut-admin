import { NotAcceptableException } from '@nestjs/common'
import { WalnutAdminConstAppResponseCode } from '@walnut-server/const/app/responseCode'

export class WalnutAdminExceptionNotAcceptable extends NotAcceptableException {
  constructor(payload?: IWalnutAdminExceptionConstructor) {
    const {
      errCode = WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE,
      errMsg = `response.${errCode}`,
    } = payload || {}
    super({ errType: NotAcceptableException.name, errCode, errMsg })
  }
}

export class WalnutAdminExceptionUserAgentOSNotAcceptable extends WalnutAdminExceptionNotAcceptable {
  constructor() {
    super({
      errCode: WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_OS_UNSUPPORTED,
    })
  }
}

export class WalnutAdminExceptionUserAgentBrowserNotAcceptable extends WalnutAdminExceptionNotAcceptable {
  constructor() {
    super({
      errCode: WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_BROWSER_UNSUPPORTED,
    })
  }
}

export class WalnutAdminExceptionIPNotAcceptable extends WalnutAdminExceptionNotAcceptable {
  constructor() {
    super({
      errCode: WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_IP_BLOCKED,
    })
  }
}

export class WalnutAdminExceptionUserAgentNotAcceptable extends WalnutAdminExceptionNotAcceptable {
  constructor() {
    super({
      errCode: WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_USER_AGENT_UNSUPPORTED,
    })
  }
}

export class WalnutAdminExceptionDeviceNotAcceptable extends WalnutAdminExceptionNotAcceptable {
  constructor() {
    super({
      errCode: WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_DEVICE_UNSUPPORTED,
    })
  }
}

export class WalnutAdminExceptionDeviceLocked extends WalnutAdminExceptionNotAcceptable {
  constructor() {
    super({
      errCode: WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_DEVICE_LOCKED,
    })
  }
}

export class WalnutAdminExceptionDeviceBanned extends WalnutAdminExceptionNotAcceptable {
  constructor() {
    super({
      errCode: WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_DEVICE_BANNED,
    })
  }
}

export class WalnutAdminExceptionBotDetected extends WalnutAdminExceptionNotAcceptable {
  constructor() {
    super({
      errCode: WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_BOT_DETECTED,
    })
  }
}

export class WalnutAdminExceptionSuspiciousRequest extends WalnutAdminExceptionNotAcceptable {
  constructor() {
    super({
      errCode: WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_SUSPICIOUS_REQUEST,
    })
  }
}

export class WalnutAdminExceptionBlackListPathDetected extends WalnutAdminExceptionNotAcceptable {
  constructor() {
    super({
      errCode: WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_BLACK_LIST_PATH_DETECTED,
    })
  }
}

export class WalnutAdminExceptionRiskTooHigh extends WalnutAdminExceptionNotAcceptable {
  constructor() {
    super({
      errCode: WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_RISK_TOO_HIGH,
    })
  }
}
