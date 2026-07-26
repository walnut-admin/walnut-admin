import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { WalnutAdminConstCookieKeys } from '@walnut/const/app/cookie'
import { IWalnutAdminConstDecoratorPermissionMode, WalnutAdminConstDecoratorPermissionMetadataKey, WalnutAdminConstDecoratorPermissionMode } from '@walnut/const/decorator/permissions'
import { WalnutAdminConstRole, WalnutAdminConstRoleMode } from '@walnut/const/role/index'
import { WalnutAdminExceptionNoAccessPermission } from '@walnut/exceptions/business/auth'

import { isNil } from 'lodash'
import { getWalnutAdminCookie } from '@/decorators/walnut/cookie.decorator'
import { AppTechCachePermissionsService } from '@/modules/techniques/cache/service/cache.permissions'

@Injectable()
export class WalnutAdminGuardPermission implements CanActivate {
  private readonly logger = new Logger(WalnutAdminGuardPermission.name)

  constructor(
    private readonly reflector: Reflector,
    private readonly cachePermissionsService: AppTechCachePermissionsService,
  ) { }

  private readonly visitorWhiteListPermissions: string[] = [
    'app:shared:ali:sts',
  ]

  private getVisitorWhiteListPermissions(p: string) {
    if (this.visitorWhiteListPermissions.includes(p))
      return true
    return p.endsWith(':list') || p.endsWith(':read')
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const ctx = context.switchToHttp()
    const request = ctx.getRequest<IWalnutAdminExpressRequest>()

    const payloadPermission = this.reflector.getAllAndOverride<
      string | string[]
    >(WalnutAdminConstDecoratorPermissionMetadataKey.PERMISSION, [
      context.getHandler(),
      context.getClass(),
    ])

    const payloadPermissionMode
      = this.reflector.getAllAndOverride<IWalnutAdminConstDecoratorPermissionMode>(
        WalnutAdminConstDecoratorPermissionMetadataKey.PERMISSION_MODE,
        [context.getHandler(), context.getClass()],
      )

    if (isNil(payloadPermission)) {
      this.logger.warn(
        'Your are not providing any permission(s) for access controll when using permission decorator!',
        'Please provide at least 1 permission string for this decorator.',
      )
      return true
    }

    const user = request.user

    // by default, we assume that when using this guard, user must have beed logged in
    // if we do not find user on request, just throw
    if (!user) {
      throw new WalnutAdminExceptionNoAccessPermission()
    }

    // if current user role mode is combine
    // and current user's first role is root, just return true
    if (user.roleMode === WalnutAdminConstRoleMode.COMBINE && user.roleNames[0] === WalnutAdminConstRole.ROOT)
      return true

    // if current user role mode is switch
    // and current role is root
    if (user.roleMode === WalnutAdminConstRoleMode.SWITCH && user.currentRoleName === WalnutAdminConstRole.ROOT)
      return true

    // define the flag, default true
    let canNext = true

    // visitor specfic handle
    if (user.roleMode === WalnutAdminConstRoleMode.SWITCH && user.currentRoleName === WalnutAdminConstRole.VISITOR) {
      if (Array.isArray(payloadPermission)) {
        canNext = payloadPermission.every(perm => this.getVisitorWhiteListPermissions(perm))
      }
      else if (typeof payloadPermission === 'string') {
        canNext = this.getVisitorWhiteListPermissions(payloadPermission)
      }

      // can not go ahead, throw custom permission error
      if (!canNext) {
        throw new WalnutAdminExceptionNoAccessPermission()
      }

      return canNext
    }

    // get permissions from cache
    const deviceId = getWalnutAdminCookie(request, WalnutAdminConstCookieKeys.DEVICE_ID)
    const allPermissions = await this.cachePermissionsService.getPermissionsFromCache(user.userId, deviceId)

    // if we do not find permission strings in cache
    // just throw
    if (!allPermissions) {
      throw new WalnutAdminExceptionNoAccessPermission()
    }

    // handle permission strings
    if (Array.isArray(payloadPermission)) {
      // and mode, use `every` to judge
      if (payloadPermissionMode === WalnutAdminConstDecoratorPermissionMode.AND) {
        canNext = payloadPermission.every(i => allPermissions?.includes(i))
      }

      // or mode, use `some` to judge
      if (payloadPermissionMode === WalnutAdminConstDecoratorPermissionMode.OR) {
        canNext = allPermissions?.some(i => payloadPermission.includes(i))
      }
    }

    // only one string, just use `includes` to judge
    if (typeof payloadPermission === 'string') {
      canNext = allPermissions?.includes(payloadPermission)
    }

    // can not go ahead, throw custom permission error
    if (!canNext) {
      throw new WalnutAdminExceptionNoAccessPermission()
    }

    return true
  }
}
