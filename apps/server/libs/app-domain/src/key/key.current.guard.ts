import type { CanActivate, ExecutionContext } from '@nestjs/common'
import { Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import { AppTechCachePermissionsService } from '@walnut-server/cache'
import { WalnutAdminGuardPermission } from '@walnut-server/guards'
import { AppKeyTypeConst } from './key.const'

/**
 * P0-6（2026-10-28）：`GET /app/key/current/:type` 的类型分权。
 *
 * - RSA_PAIR：管理面读取（与 init/rotate 同级的 key 管理权限 `app:key:read`，root
 *   短路放行）—— 客户端加密/握手已由公开端点 `GET /security/rsa/public-key` 承接，
 *   该视图无需对普通用户开放；
 * - AES_KEY_URL：admin 前端 URL 掩码的客户端分发密钥（路由守卫按需拉取，任何登录态
 *   用户都会触发），保持登录即可读 —— 它本身不是私钥材料，且没有用户可见的授权入口。
 *
 * 实现上把 permission.guard 的判定原样复用（root/visitor/权限串精确匹配/40105），
 * 只按路径参数决定是否进入判定。
 */
@Injectable()
export class AppKeyCurrentGuard extends WalnutAdminGuardPermission implements CanActivate {
  constructor(
    reflector: Reflector,
    cachePermissionsService: AppTechCachePermissionsService,
  ) {
    super(reflector, cachePermissionsService)
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<IWalnutAdminExpressRequest>()

    if (request.params?.type !== AppKeyTypeConst.RSA_PAIR) {
      return true
    }

    return super.canActivate(context)
  }
}
