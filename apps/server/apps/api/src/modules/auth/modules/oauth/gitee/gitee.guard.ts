import type { ExecutionContext } from '@nestjs/common'
import { Injectable } from '@nestjs/common'
import { WalnutAdminConstCookieKeys } from '@walnut-server/const/app/cookie'
import { WalnutAdminConstAppAuthStrategy } from '@walnut-server/const/app/strategy'
import { WalnutAdminExceptionBadRequest } from '@walnut-server/exceptions/base.exception'
import { isObservable, lastValueFrom } from 'rxjs'
import { getWalnutAdminCookie } from '@/decorators/walnut/cookie.decorator'
import { WalnutAdminGuardAuth } from '@/guard/auth.guard'
import { OAuthStateService } from '../shared/oauth-state.service'

@Injectable()
export class OAuthGiteeGuard extends WalnutAdminGuardAuth(WalnutAdminConstAppAuthStrategy.OAUTH_GITEE) {
  constructor(private readonly oauthStateService: OAuthStateService) {
    super()
  }

  /**
   * P3-3：缺 code 时 passport-oauth2 的 authorize 腿会直接 302 跳回 IdP（无统一响应壳）。
   * 前置校验让缺码走受控 40000；有 code 才交给 passport 换 token。
   *
   * P2-13（2026-10-28）：换 code 之前先验 state —— 签名（防篡改）+ 设备绑定 +
   * Redis DEL 一次性消费（防重放/登录 CSRF）。失败走同一受控 40000 壳，
   * 不进入外部 token 交换。
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<IWalnutAdminExpressRequest>()
    const code = (req.query as { code?: unknown } | undefined)?.code

    if (typeof code !== 'string' || code.length === 0) {
      throw new WalnutAdminExceptionBadRequest({
        _devMsg: 'oauth callback requires code query parameter',
      })
    }

    const deviceId = getWalnutAdminCookie(req, WalnutAdminConstCookieKeys.DEVICE_ID)
    const state = (req.query as { state?: unknown } | undefined)?.state

    const payload = await this.oauthStateService.consumeState(
      typeof state === 'string' ? state : undefined,
      deviceId,
    )

    if (payload === null) {
      throw new WalnutAdminExceptionBadRequest({
        _devMsg: 'oauth callback state invalid, expired, replayed or issued to another device',
      })
    }

    // passport AuthGuard 在该分支返回 Observable<boolean>；本方法按 Promise 收口
    const result = super.canActivate(context)
    return isObservable(result) ? lastValueFrom(result) : result
  }
}
