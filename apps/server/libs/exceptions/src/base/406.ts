import { NotAcceptableException } from '@nestjs/common'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract'

export class WalnutAdminExceptionNotAcceptable extends NotAcceptableException {
  constructor(payload?: IWalnutAdminExceptionConstructor) {
    const {
      errCode = WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE,
      errMsg = `response.${errCode}`,
      // 2026-11（批次 8 / B2）：406 家族此前把 _devMsg 丢了 —— 新加的 40667 需要一个
      // 可排查的降级原因（no-device-id / risk-evaluation-failed @ POST /auth/refresh），
      // 只打日志不落响应壳等于运维侧看不见。与 400 家族（BadRequest）同形。
      _devMsg,
    } = payload || {}
    super({ errType: NotAcceptableException.name, errCode, errMsg, _devMsg })
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

/**
 * 风控不可用（40667）—— **敏感端点**在「无法完成风险评估」时的 fail-close 拒绝。
 *
 * 与 40666（RiskTooHigh）分开是刻意的：40666 表示「算出来了，分数太高」，本码表示
 * 「压根没算出来」（风控服务抛异常 / 请求没有 deviceId 可评估）。合成一个码会让值班
 * 分不清「有人在爆破」与「风控服务挂了」。
 *
 * 只有敏感端点走 fail-close —— 分级清单的唯一真源是 `guards/risk.sensitivity.ts`；
 * 其余端点维持 fail-open，并把降级原因写进响应壳的 meta.riskDegraded（可观测通道，
 * 不只是日志）。不做全局 fail-close 的理由：本仓没有风控 SLA，全局关闭等于把风控服务
 * 变成全站单点。
 */
export class WalnutAdminExceptionRiskUnavailable extends WalnutAdminExceptionNotAcceptable {
  constructor(reason?: string) {
    super({
      errCode: WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_RISK_UNAVAILABLE,
      _devMsg: reason,
    })
  }
}
