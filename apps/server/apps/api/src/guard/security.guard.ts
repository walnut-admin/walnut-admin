import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { AppTechCacheAppSettingsService } from '@walnut-server/cache'
import { WalnutAdminExceptionBlackListPathDetected, WalnutAdminExceptionBotDetected, WalnutAdminExceptionSuspiciousRequest, WalnutAdminExceptionUserAgentBrowserNotAcceptable, WalnutAdminExceptionUserAgentNotAcceptable, WalnutAdminExceptionUserAgentOSNotAcceptable } from '@walnut-server/exceptions/base/406'
import { isNil } from 'lodash'
import { SharedIpService } from '@/modules/shared/ip/ip.service'

// permanent blacklist paths (common malicious scan paths)
// 与 BlacklistPathMiddleware 共用（guard 只覆盖已路由请求；未命中路由的扫描路径
// 不执行 guard 链，见 P1-11 的中间件兜底）
export const WALNUT_ADMIN_PERMANENT_BLACKLIST_PATHS = [
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
] as const

export function isWalnutAdminBlacklistedPath(path: string): boolean {
  const normalizedPath = path.toLowerCase()
  return WALNUT_ADMIN_PERMANENT_BLACKLIST_PATHS.some(blacklisted =>
    normalizedPath.startsWith(blacklisted.toLowerCase()),
  )
}

@Injectable()
export class WalnutAdminGuardSecurity implements CanActivate {
  private readonly logger = new Logger(WalnutAdminGuardSecurity.name)

  constructor(
    private readonly cacheAppSettingsService: AppTechCacheAppSettingsService,
    private readonly sharedIpService: SharedIpService,
    private readonly configService: ConfigService,
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
    // P1-11 修复（2026-10-28）：req.path 带 `/{prefix}/v{version}`，旧实现拿裸常量
    // `startsWith('/admin')` 匹配永不命中。匹配前按 sign guard 同口径 strip API 前缀。
    if (this.isBlacklistedPath(this.stripApiPrefix(req.path))) {
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
   * @description strip `/{prefix}/v{version}` —— 与 sign guard buildSignRaw 的路径
   * 规范化同口径（黑名单常量是裸路径）
   */
  private stripApiPrefix(path: string): string {
    const APIPrefix = this.configService.get<string>('app.api.prefix')!
    const APIVersion = this.configService.get<string>('app.api.version')!
    return path.replace(new RegExp(`^/${APIPrefix}/v${APIVersion}`), '') || '/'
  }

  /**
   * @description check if path is blacklisted
   */
  private isBlacklistedPath(path: string): boolean {
    return isWalnutAdminBlacklistedPath(path)
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
