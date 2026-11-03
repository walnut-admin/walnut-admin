import type { IWalnutAdminConstCookieKeys } from '@walnut-server/const/app/cookie'
import { WalnutAdminExceptionBadRequest } from '@walnut-server/exceptions/base.exception'

/**
 * 读取签名 cookie（批 4：操作日志拦截器随 decorator 层下沉后需要在 lib 内共用，
 * 从 app 的 `decorators/walnut/cookie.decorator.ts` 原样迁入，行为不变）。
 *
 * 注意：返回值**不是** `string | undefined`：`cookie-parser` 对「带 `s:` 前缀但签名不对」
 * 的值返回 **`false`**（cookie-parser@1.4.7 index.js:150），所以这里的类型断言是假的。
 * 需要「拿不到就当没有」语义的调用方请用 {@link getWalnutAdminCookieString}。
 */
export function getWalnutAdminCookie(req: IWalnutAdminExpressRequest, key: IWalnutAdminConstCookieKeys) {
  try {
    return req.signedCookies[key as keyof typeof req.signedCookies] as string
  }
  catch {
    throw new WalnutAdminExceptionBadRequest()
  }
}

/**
 * 读取签名 cookie 并归一化成「可用的字符串」（缺失 / 空串 / 签名错的 `false` → `undefined`）。
 *
 * 为什么需要它（review CAP-4）：`cookie-parser` 对 `s:<坏签名>` 的值返回 `false`，
 * 而 `isNil(false)` 是 false ⇒ 只判 `isNil` 的调用方会拿着 `false` 继续往下走。
 * CAP guard 就是这么撞上 `createHash().update(false)` 的 `ERR_INVALID_ARG_TYPE`（body.code 50000）。
 * 判「凭据存在不存在」的一律用本函数，别再自己 `typeof` 一遍。
 */
export function getWalnutAdminCookieString(
  req: IWalnutAdminExpressRequest,
  key: IWalnutAdminConstCookieKeys,
): string | undefined {
  const value = getWalnutAdminCookie(req, key)

  if (typeof value !== 'string' || value.length === 0) {
    return undefined
  }

  return value
}
