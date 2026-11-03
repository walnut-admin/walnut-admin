import type { BeforeApplicationShutdown } from '@nestjs/common'
import Cap, { Solution } from '@cap.js/server'
import { Injectable, Logger, OnModuleInit } from '@nestjs/common'
import { AppTechCacheAppSettingsService } from '@walnut-server/cache'
import { resolveCapChallengeExpiresMs, resolveCapCookieMaxAgeMs } from '@walnut-server/const/app/cap'
import { WalnutAdminConstCookieKeys } from '@walnut-server/const/app/cookie'
import { AppTechCookieService } from '@walnut-server/cookie'

import { createCapDetachedFromProcessHooks } from './cap.shutdown'

/**
 * cap.js 的 token 存储路径 —— 进程内**本地文件**。
 *
 * 注意：这是「单实例前提」的物理来源（review CAP-3）：副本 A 在 `redeem` 里签发的 token 只写进
 * 副本 A 的文件，副本 B 的 `validateToken` 在它自己的文件里查不到 ⇒ 校验必失败 ⇒ 40116/40117
 * 风暴。本轮**只声明前提、不改存储**（分布式存储改造另批）。启动日志见 {@link SecurityCapService.onModuleInit}。
 */
export const WALNUT_ADMIN_CAP_TOKEN_STORE_PATH = '.data/tokensList.json'

/**
 * cap.js 实例 + 被摘下来的进程监听器。
 *
 * 为什么不在构造后直接用：cap.js 在**构造期**就注册 SIGTERM/SIGINT/SIGQUIT/beforeExit，
 * 并在 cleanup 结束后自己 `process.exit(0)`（见 ./cap.shutdown.ts 头注释与实测）。
 * 那样 Nest 的关闭序列会被腰斩 —— PG 连接池、Bull 队列都来不及排空，滚动更新时表现为
 * 连接被重置 / 任务重复消费。摘掉之后，cleanup 由本模块的 `beforeApplicationShutdown`
 * 在 Nest 的关闭流程里显式调用。
 */
const capDetached = createCapDetachedFromProcessHooks(
  () => new Cap({ tokens_store_path: WALNUT_ADMIN_CAP_TOKEN_STORE_PATH }),
)

export const AppCapJS = capDetached.cap

/** 被摘下的 cap.js 进程钩子（排查与单测用；生产路径不应再触发它们） */
export const WALNUT_ADMIN_CAP_DETACHED_HOOKS = capDetached.hooks

@Injectable()
export class SecurityCapService implements OnModuleInit, BeforeApplicationShutdown {
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

  /**
   * cap.js 的 token 落盘（`cleanup()`）挂在 **Nest 的关闭序列**里，而不是它自己的信号钩子上。
   *
   * 时机是 Nest 关闭序列的第 3 段：
   * `prepareClose` → `onModuleDestroy`（Redis quit）→ **`beforeApplicationShutdown`**
   * → `dispose`（停 HTTP / socket.io）→ `onApplicationShutdown`（TypeORM 关池、Bull 关队列）。
   * 即：cap 落盘**先于** PG / Bull 的排空，且进程要等整段序列跑完才退出。
   *
   * 失败只记日志不抛出：cap 的本地 token 文件不属于「排空依赖」，它写不进去也不该拖住
   * PG / Bull 的关闭（抛出去 Nest 会走 `process.exit(1)`，那正是本轮要消灭的坏行为）。
   */
  async beforeApplicationShutdown(signal?: string) {
    const startedAt = Date.now()

    try {
      await AppCapJS.cleanup()
      this.logger.log(
        `[shutdown] CAP token store flushed in ${Date.now() - startedAt}ms (signal=${signal ?? 'app.close()'})`,
      )
    }
    catch (err) {
      this.logger.error(
        `[shutdown] CAP cleanup failed: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
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
