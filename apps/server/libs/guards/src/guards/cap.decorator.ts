import { SetMetadata } from '@nestjs/common'

/**
 * CAP-free 的元数据键。
 *
 * 单独成文件的原因见 cap.guard.ts 头注释：本文件**不 import 任何 @walnut-server/security**，
 * 所以经 guards barrel 拿到它的 49 个 controller 不会把 cap.js 拖进自己的求值闭包。
 * 键与装饰器必须与 guard 共用一个真源，因此它 export 出来给 cap.guard.ts 用
 * （与 libs/auth 的 otp-throttle.const.ts 同款口径）。
 */
export const WalnutAdminConstDecoratorCapFreeKey = Symbol('WALNUT_ADMIN_CONST_DECORATOR_CAP_FREE')

/**
 * cap.js token 的形态：<id>:<vertoken>，两段都是小写 hex。
 * 出处 @cap.js/server@4.0.5 的 redeemChallenge：id = randomHex(8)、
 * vertoken = randomHex(15)，最终 token: `${id}:${vertoken}`（index.js:342-364）。
 *
 * 只校验**形态**，不校验内容（内容归 validateToken）—— 目的是把"客户端交的根本不是
 * 一枚 cap.js 凭据"与"凭据过期/已被消费"分开，前者才配 40111。
 */
const WALNUT_ADMIN_CAP_JS_TOKEN_PATTERN = /^[\da-f]+:[\da-f]+$/i

export function isWellFormedCapJsToken(token: unknown): token is string {
  return typeof token === 'string' && WALNUT_ADMIN_CAP_JS_TOKEN_PATTERN.test(token)
}

/**
 * 装饰器：跳过 CAP 验证
 */
export function WalnutAdminGuardCapFree() {
  return SetMetadata(WalnutAdminConstDecoratorCapFreeKey, true)
}
