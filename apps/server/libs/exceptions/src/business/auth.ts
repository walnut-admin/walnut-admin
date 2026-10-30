import { WalnutAdminConstAppResponseCode } from '@walnut/contract'
import { WalnutAdminExceptionForbidden, WalnutAdminExceptionUnauthorized } from '../base.exception'

export class WalnutAdminExceptionAccessTokenExpired extends WalnutAdminExceptionUnauthorized {
  constructor() {
    super({
      errCode: WalnutAdminConstAppResponseCode.UNAUTHORIZED_ACCESS_TOKEN_EXPIRED,
    })
  }
}

export class WalnutAdminExceptionRefreshTokenExpired extends WalnutAdminExceptionUnauthorized {
  constructor() {
    super({
      errCode: WalnutAdminConstAppResponseCode.UNAUTHORIZED_REFRESH_TOKEN_EXPIRED,
    })
  }
}

export class WalnutAdminExceptionInvalidCredential extends WalnutAdminExceptionUnauthorized {
  constructor() {
    super({
      errCode: WalnutAdminConstAppResponseCode.UNAUTHORIZED_INVALID_CREDENTIALS,
    })
  }
}

export class WalnutAdminExceptionUserBannedToSignin extends WalnutAdminExceptionUnauthorized {
  constructor() {
    super({
      errCode: WalnutAdminConstAppResponseCode.UNAUTHORIZED_ACCOUNT_BANNED,
    })
  }
}

export class WalnutAdminExceptionNoAccessPermission extends WalnutAdminExceptionUnauthorized {
  constructor() {
    super({
      errCode: WalnutAdminConstAppResponseCode.UNAUTHORIZED_NO_PERMISSION,
    })
  }
}

export class WalnutAdminExceptionNoAccessRolePermission extends WalnutAdminExceptionUnauthorized {
  constructor() {
    super({
      errCode: WalnutAdminConstAppResponseCode.UNAUTHORIZED_NO_ROLE_PERMISSION,
    })
  }
}

export class WalnutAdminExceptionOAuthFailed extends WalnutAdminExceptionUnauthorized {
  constructor() {
    super({
      errCode: WalnutAdminConstAppResponseCode.UNAUTHORIZED_OAUTH_FAILED,
    })
  }
}

export class WalnutAdminExceptionSignupBanned extends WalnutAdminExceptionUnauthorized {
  constructor() {
    super({
      errCode: WalnutAdminConstAppResponseCode.UNAUTHORIZED_SIGNUP_BANNED,
    })
  }
}

export class WalnutAdminExceptionDuplicateSignIn extends WalnutAdminExceptionUnauthorized {
  constructor() {
    super({
      errCode: WalnutAdminConstAppResponseCode.UNAUTHORIZED_DUPLICATE_AUTH,
    })
  }
}

export class WalnutAdminExceptionSignoutFailed extends WalnutAdminExceptionUnauthorized {
  constructor() {
    super({
      errCode: WalnutAdminConstAppResponseCode.UNAUTHORIZED_SIGNOUT_FAILED,
    })
  }
}

export class WalnutAdminExceptionYouAreBot extends WalnutAdminExceptionUnauthorized {
  constructor() {
    super({
      errCode: WalnutAdminConstAppResponseCode.UNAUTHORIZED_BOT_VERIFY_FAILED,
    })
  }
}

export class WalnutAdminExceptionCapInteractionRequired extends WalnutAdminExceptionUnauthorized {
  constructor() {
    super({
      errCode: WalnutAdminConstAppResponseCode.UNAUTHORIZED_CAPTCHA_INTERACTION_REQUIRED,
    })
  }
}

export class WalnutAdminExceptionCapRefreshRequired extends WalnutAdminExceptionUnauthorized {
  constructor() {
    super({
      errCode: WalnutAdminConstAppResponseCode.UNAUTHORIZED_CAPTCHA_REFRESH_REQUIRED,
    })
  }
}

export class WalnutAdminExceptionInvalidSignature extends WalnutAdminExceptionUnauthorized {
  constructor() {
    super({
      errCode: WalnutAdminConstAppResponseCode.UNAUTHORIZED_INVALID_SIGNATURE,
    })
  }
}

export class WalnutAdminExceptionExpiredSignature extends WalnutAdminExceptionUnauthorized {
  constructor() {
    super({
      errCode: WalnutAdminConstAppResponseCode.UNAUTHORIZED_EXPIRED_SIGNATURE,
    })
  }
}

export class WalnutAdminExceptionMfaRequired extends WalnutAdminExceptionUnauthorized {
  constructor() {
    super({
      errCode: WalnutAdminConstAppResponseCode.UNAUTHORIZED_MFA_REQUIRED,
    })
  }
}

export class WalnutAdminExceptionMfaVerifyFailed extends WalnutAdminExceptionUnauthorized {
  constructor() {
    super({
      errCode: WalnutAdminConstAppResponseCode.UNAUTHORIZED_MFA_VERIFY_FAILED,
    })
  }
}

export class WalnutAdminExceptionUserLocked extends WalnutAdminExceptionUnauthorized {
  constructor() {
    super({
      errCode: WalnutAdminConstAppResponseCode.UNAUTHORIZED_ACCOUNT_LOCKED,
    })
  }
}

export class WalnutAdminExceptionSensitiveVerificationFailed extends WalnutAdminExceptionUnauthorized {
  constructor(payload?: Pick<IWalnutAdminExceptionConstructor, 'meta'>) {
    super({
      errCode: WalnutAdminConstAppResponseCode.UNAUTHORIZED_SENSITIVE_VERIFICATION_REQUIRED,
      meta: payload?.meta,
    })
  }
}

/**
 * 数据权限 fail-closed：已注册实体（含 owner 列的业务表）在没有 ALS 数据权限上下文
 * 时拒绝查询 —— 对应 docs/plans/data-scope-design.md §7 的「fail-closed 上下文」
 * 机制（TenancyJS 同款语义：不默认 ALL，直接抛错）。
 *
 * 触发面只有两类：① 请求内但拦截器没种入描述符（装配错误）；② 非 HTTP 通道
 * （cron / 脚本 / 测试）直接走基类查询业务表 —— 后者必须显式用
 * `ALSRequestService.runAsSystem()` 进入系统通道（等价 RLS 的 BYPASSRLS 角色）。
 */
export class WalnutAdminExceptionDataScopeContextMissing extends WalnutAdminExceptionForbidden {
  constructor() {
    super({
      errCode: WalnutAdminConstAppResponseCode.FORBIDDEN,
      errMsg: 'response.40300',
    })
  }
}
