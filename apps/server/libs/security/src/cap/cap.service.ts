import Cap, { Solution } from '@cap.js/server'
import { Injectable, Logger } from '@nestjs/common'
import { AppTechCacheAppSettingsService } from '@walnut-server/cache'
import { WalnutAdminConstCookieKeys } from '@walnut-server/const/app/cookie'
import { AppTechCookieService } from '@walnut-server/cookie'

export const AppCapJS = new Cap({
  tokens_store_path: '.data/tokensList.json',
})

@Injectable()
export class SecurityCapService {
  private readonly logger = new Logger(SecurityCapService.name)

  constructor(
    private readonly cacheAppSettingsService: AppTechCacheAppSettingsService,
    private readonly cookieService: AppTechCookieService,
  ) { }

  async challenge() {
    const config = await this.cacheAppSettingsService.getCapJSConfig()

    return AppCapJS.createChallenge({
      challengeCount: config.count,
      challengeSize: config.size,
      challengeDifficulty: config.difficulty,
      expiresMs: config.ttl,
    })
  }

  async redeem(payload: Solution, req: IWalnutAdminExpressRequest) {
    const res = await AppCapJS.redeemChallenge(payload)

    const config = await this.cacheAppSettingsService.getCapJSConfig()

    this.cookieService.setResponseCookie(req, [{ key: WalnutAdminConstCookieKeys.CAPJS_TOKEN, value: res.token!, options: { maxAge: config.ttl * 1000 } }])

    return res
  }
}
