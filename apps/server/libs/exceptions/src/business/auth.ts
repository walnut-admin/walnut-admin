import { WalnutAdminConstAppResponseCode } from '@walnut/contract'
import { WalnutAdminExceptionForbidden, WalnutAdminExceptionInternalServerError, WalnutAdminExceptionUnauthorized } from '../base.exception'

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
 * 时拒绝查询 —— 对应 apps/docs/src/zh-CN/content/plans/data-scope-design.md §7 的「fail-closed 上下文」
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

/**
 * 数据权限三期（RLS）：已注册实体在**外层事务已开启**时被无 em 调用 —— 基类无法把
 * `set_config` 写进外层事务的连接（再开一个事务会拿另一条连接，既不是同一事务，也
 * 失去原子性），继续执行等于绕过 RLS 天花板。
 *
 * 语义是**服务端编程错误**（调用方拿到 `@WalnutTxSession().em` 却没往下传），映射
 * 500 而不是 403：403 表示「用户无权」，这里用户可能完全有权，错的是代码路径。
 * 修复方式是把 `em` 透传到终结层。
 */
export class WalnutAdminExceptionDataScopeTransactionRequired extends WalnutAdminExceptionInternalServerError {
  constructor() {
    super({
      errCode: WalnutAdminConstAppResponseCode.INTERNAL_SERVER_ERROR,
      errMsg: 'response.50000',
    })
  }
}
