import type { CanActivate, ExecutionContext } from '@nestjs/common'
import { Injectable } from '@nestjs/common'
import { WalnutAdminConstAppAuthStrategy } from '@walnut-server/const/app/strategy'
import { WalnutAdminExceptionBadRequest } from '@walnut-server/exceptions/base.exception'
import { WalnutAdminGuardAuth } from '@/guard/auth.guard'

@Injectable()
export class OAuthGiteeGuard extends WalnutAdminGuardAuth(WalnutAdminConstAppAuthStrategy.OAUTH_GITEE) {
  constructor() {
    super()
  }

  /**
   * P3-3：缺 code 时 passport-oauth2 的 authorize 腿会直接 302 跳回 IdP（无统一响应壳）。
   * 前置校验让缺码走受控 40000；有 code 才交给 passport 换 token。
   */
  canActivate(context: ExecutionContext): ReturnType<CanActivate['canActivate']> {
    const req = context.switchToHttp().getRequest<IWalnutAdminExpressRequest>()
    const code = (req.query as { code?: unknown } | undefined)?.code

    if (typeof code !== 'string' || code.length === 0) {
      throw new WalnutAdminExceptionBadRequest({
        _devMsg: 'oauth callback requires code query parameter',
      })
    }

    return super.canActivate(context)
  }
}
