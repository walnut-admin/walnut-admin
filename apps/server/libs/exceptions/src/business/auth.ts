import { WalnutAdminConstAppResponseCode } from '@walnut/const/app/responseCode'
import { WalnutAdminExceptionUnauthorized } from '../base.exception'

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
