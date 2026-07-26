import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common'
import { WalnutAdminExceptionBlackListPathDetected, WalnutAdminExceptionBotDetected, WalnutAdminExceptionSuspiciousRequest, WalnutAdminExceptionUserAgentBrowserNotAcceptable, WalnutAdminExceptionUserAgentNotAcceptable, WalnutAdminExceptionUserAgentOSNotAcceptable } from '@walnut/exceptions/base/406'
import { isNil } from 'lodash'
import { SharedIpService } from '@/modules/shared/ip/ip.service'
import { AppTechCacheAppSettingsService } from '@/modules/techniques/cache/service/cache.appSettings'

@Injectable()
export class WalnutAdminGuardSecurity implements CanActivate {
  private readonly logger = new Logger(WalnutAdminGuardSecurity.name)

  // permanent blacklist paths (common malicious scan paths)
  private readonly PERMANENT_BLACKLIST_PATHS = [
    '/admin',
    '/phpmyadmin',
    '/wp-admin',
    '/wp-login',
    '/.env',
    '/.git',
    '/config',
    '/backup',
    '/console',
    '/actuator',
    '/api/v1/admin',
    '/manager',
    '/webadmin',
  ]

  constructor(
    private readonly cacheAppSettingsService: AppTechCacheAppSettingsService,
    private readonly sharedIpService: SharedIpService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<IWalnutAdminExpressRequest>()

    if (req.isPostman) {
      return true
    }

    if (!req.userAgent) {
      this.logger.warn(`User agent missing`)
      throw new WalnutAdminExceptionUserAgentNotAcceptable()
    }

    // 1. check permanent blacklist paths
    if (this.isBlacklistedPath(req.path)) {
      // add to permanent blacklist
      await this.sharedIpService.addToPermanentBlackList(req.realIp)
      throw new WalnutAdminExceptionBlackListPathDetected()
    }

    // 2. check sensitive paths
    // sensitive paths not allow bot
    if (req.isBot) {
      this.logger.warn(`Bot blocked from sensitive path: ${req.path}`)
      throw new WalnutAdminExceptionBotDetected()
    }

    // 3. check sensitive paths
    // sensitive paths not allow suspicious request
    if (req.isSuspicious) {
      this.logger.warn(`Suspicious request blocked from sensitive path: ${req.path}`)
      throw new WalnutAdminExceptionSuspiciousRequest()
    }

    // 4. check user agent os whitelist
    const osWhiteList = await this.cacheAppSettingsService.getOSWhiteList()
    if (!this.isInWhiteList(req.userAgent?.os?.name, osWhiteList)) {
      this.logger.warn(
        `user agent os not acceptable: ${req.userAgent?.ua} os=${req.userAgent?.os?.name}`,
      )
      throw new WalnutAdminExceptionUserAgentOSNotAcceptable()
    }

    // 5. check user agent browser whitelist
    const browserWhiteList = await this.cacheAppSettingsService.getBrowserWhiteList()
    if (!this.isInWhiteList(req.userAgent?.browser?.name, browserWhiteList)) {
      this.logger.warn(
        `user agent browser not acceptable: ${req.userAgent?.ua} browser=${req.userAgent?.browser?.name}`,
      )
      throw new WalnutAdminExceptionUserAgentBrowserNotAcceptable()
    }

    return true
  }

  /**
   * @description check if path is blacklisted
   */
  private isBlacklistedPath(path: string): boolean {
    const normalizedPath = path.toLowerCase()
    return this.PERMANENT_BLACKLIST_PATHS.some(blacklisted =>
      normalizedPath.startsWith(blacklisted.toLowerCase()),
    )
  }

  /**
   * @description check if actual is in whitelist
   */
  private isInWhiteList(actual?: string, whiteList: string[] = []): boolean {
    if (isNil(actual))
      return false

    const normalized = actual.toLowerCase().trim()
    return whiteList
      .map(i => i.toLowerCase().trim())
      .some(allowed => normalized.includes(allowed))
  }
}
