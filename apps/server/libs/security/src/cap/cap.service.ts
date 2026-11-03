import Cap, { Solution } from '@cap.js/server'
import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { AppTechCacheAppSettingsService } from '@walnut-server/cache'
import { resolveCapChallengeExpiresMs, resolveCapCookieMaxAgeMs } from '@walnut-server/const/app/cap'
import { WalnutAdminConstCookieKeys } from '@walnut-server/const/app/cookie'
import { AppTechCookieService } from '@walnut-server/cookie'

/**
 * cap.js 的 token 存储路径 —— 进程内**本地文件**。
 *
 * 注意：这是「单实例前提」的物理来源（review CAP-3）：副本 A 在 `redeem` 里签发的 token 只写进
 * 副本 A 的文件，副本 B 的 `validateToken` 在它自己的文件里查不到 ⇒ 校验必失败 ⇒ 40116/40117
 * 风暴。本轮**只声明前提、不改存储**（分布式存储改造另批）。启动日志见 {@link SecurityCapService.onModuleInit}。
 */
export const WALNUT_ADMIN_CAP_TOKEN_STORE_PATH = '.data/tokensList.json'

export const AppCapJS = new Cap({
  tokens_store_path: WALNUT_ADMIN_CAP_TOKEN_STORE_PATH,
})

@Injectable()
export class SecurityCapService implements OnModuleInit {
  private readonly logger = new Logger(SecurityCapService.name)

  constructor(
    private readonly cacheAppSettingsService: AppTechCacheAppSettingsService,
    private readonly cookieService: AppTechCookieService,
  ) { }

  /**
   * 单实例前提的**启动期显式声明**（review CAP-3 的 (a) 方案：本轮不做分布式存储改造）。
   *
   * 用 `warn` 而不是 `debug`：这条信息决定「能不能起第二个副本」，运维必须在启动日志里看见。
   * 判据不是「起不来」（本轮无强断言），而是**把它从静默假设变成日志事实**。
   */
  onModuleInit() {
    this.logger.warn(
      `CAP token store = local file (${WALNUT_ADMIN_CAP_TOKEN_STORE_PATH}) — `
      + 'CAP MUST run as a SINGLE instance (or all replicas must share this file via a persistent volume). '
      + 'Multi-replica deployments without shared storage always fail validation (40116/40117 storm): '
      + 'see reports/review-cap/review.md CAP-3.',
    )
  }

  async challenge() {
    const config = await this.cacheAppSettingsService.getCapJSConfig()

    return AppCapJS.createChallenge({
      challengeCount: config.count,
      challengeSize: config.size,
      challengeDifficulty: config.difficulty,
      // ttl 配置单位是**秒**，cap.js 要毫秒 —— 换算只走 resolve*（见 @walnut-server/const/app/cap）
      expiresMs: resolveCapChallengeExpiresMs(config.ttl),
    })
  }

  async redeem(payload: Solution, req: IWalnutAdminExpressRequest) {
    const res = await AppCapJS.redeemChallenge(payload)

    const config = await this.cacheAppSettingsService.getCapJSConfig()

    // 注意 cap.js 的 token 本体寿命是硬编码 20 分钟（与 ttl 无关），cookie 的 maxAge 跟着 ttl 走
    // 只表示「浏览器何时丢掉这枚凭据」，不表示「服务端认它多久」—— 权威解释见 const/app/cap.ts
    this.cookieService.setResponseCookie(req, [{ key: WalnutAdminConstCookieKeys.CAPJS_TOKEN, value: res.token!, options: { maxAge: resolveCapCookieMaxAgeMs(config.ttl) } }])

    return res
  }
}
