import type { IWalnutAdminConstCookieKeys } from '@walnut-server/const/app/cookie'
import { WalnutAdminExceptionBadRequest } from '@walnut-server/exceptions/base.exception'

/**
 * 读取签名 cookie（批 4：操作日志拦截器随 decorator 层下沉后需要在 lib 内共用，
 * 从 app 的 `decorators/walnut/cookie.decorator.ts` 原样迁入，行为不变）。
 */
export function getWalnutAdminCookie(req: IWalnutAdminExpressRequest, key: IWalnutAdminConstCookieKeys) {
  try {
    return req.signedCookies[key as keyof typeof req.signedCookies] as string
  }
  catch {
    throw new WalnutAdminExceptionBadRequest()
  }
}
