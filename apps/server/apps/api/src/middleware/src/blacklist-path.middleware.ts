import type { NextFunction } from 'express'
import { Injectable, NestMiddleware } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { WalnutAdminExceptionBlackListPathDetected } from '@walnut-server/exceptions/base/406'
import { SharedIpService } from '@walnut-server/ip'
import { isWalnutAdminBlacklistedPath } from '@/guard/security.guard'

/**
 * P1-11 修复（2026-10-28）：永久黑名单路径的自动拉黑。
 *
 * 为什么是中间件而不是 security.guard：
 * - security.guard 是 Nest 路由守卫，**未命中任何路由的请求不执行 guard 链**
 *   （Nest 的 not-found handler 直接抛 NotFoundException）—— 扫描器打的裸路径
 *   `/admin`、带 API 前缀的 `/w/v1/admin` 都走不到 guard，原 `addToPermanentBlackList`
 *   分支永远不可达。
 * - 中间件对全部请求执行（`forRoutes('*')`），在 strip `/{prefix}/v{version}` 后按
 *   guard 导出的同一份黑名单常量判定；命中 → 拉黑 realIp + 40610。
 *
 * guard 内的同款检查保留（已路由的请求双保险，复用同一判定函数）。
 */
@Injectable()
export class BlacklistPathMiddleware implements NestMiddleware {
  constructor(
    private readonly configService: ConfigService,
    private readonly sharedIpService: SharedIpService,
  ) {}

  async use(
    req: IWalnutAdminExpressRequest,
    _res: IWalnutAdminExpressResponse,
    next: NextFunction,
  ) {
    if (req.isPostman) {
      next()
      return
    }

    const APIPrefix = this.configService.get<string>('app.api.prefix')!
    const APIVersion = this.configService.get<string>('app.api.version')!
    // Nest 11 把 `forRoutes('*')` 挂成通配中间件，Express 会把匹配段从 req.url 剥掉
    // （req.path 恒 '/'）—— 取完整路径必须用 originalUrl（去掉 querystring）
    const originalPath = (req.originalUrl ?? req.url).split('?')[0]
    const normalizedPath = originalPath.replace(new RegExp(`^/${APIPrefix}/v${APIVersion}`), '') || '/'

    if (isWalnutAdminBlacklistedPath(normalizedPath)) {
      await this.sharedIpService.addToPermanentBlackList(req.realIp)
      throw new WalnutAdminExceptionBlackListPathDetected()
    }

    next()
  }
}
