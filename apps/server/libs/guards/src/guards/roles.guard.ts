import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { IWalnutAdminConstDecoratorRoleMode, WalnutAdminConstDecoratorRoleMetadataKey, WalnutAdminConstDecoratorRoleMode } from '@walnut-server/const/decorator/role'
import { WalnutAdminConstRoleMode } from '@walnut-server/const/role'
import { WalnutAdminExceptionNoAccessRolePermission } from '@walnut-server/exceptions/business/auth'
import { Role, RoleType } from '@walnut/contract'
import { isNil } from 'lodash'

@Injectable()
export class WalnutAdminGuardRole implements CanActivate {
  private readonly logger = new Logger(WalnutAdminGuardRole.name)

  constructor(private readonly reflector: Reflector) { }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const ctx = context.switchToHttp()
    const request = ctx.getRequest<IWalnutAdminExpressRequest>()

    const payloadRole = this.reflector.getAllAndOverride<RoleType | RoleType[]>(
      WalnutAdminConstDecoratorRoleMetadataKey.ROLE,
      [context.getHandler(), context.getClass()],
    )

    const payloadRoleMode
      = this.reflector.getAllAndOverride<IWalnutAdminConstDecoratorRoleMode>(
        WalnutAdminConstDecoratorRoleMetadataKey.ROLE_MODE,
        [context.getHandler(), context.getClass()],
      )

    if (isNil(payloadRole)) {
      this.logger.warn(
        'Your are not providing any role(s) for access controll when using role decorator!',
        'Please provide at least 1 role string for this decorator.',
      )
      return true
    }

    const user = request.user

    // by default, we assume that when using this guard, user must have beed logged in
    // if we do not find user on request, just simply return false
    if (!user) {
      throw new WalnutAdminExceptionNoAccessRolePermission()
    }

    // if current user role mode is combine
    // and current user has root role, just return true
    if (user.roleMode === WalnutAdminConstRoleMode.COMBINE && user.roleNames[0] === Role.ROOT)
      return true

    // if current user role mode is switch
    // and current role is root
    if (user.roleMode === WalnutAdminConstRoleMode.SWITCH && user.currentRoleName === Role.ROOT)
      return true

    // get role names
    const allRoleNames = user.roleNames

    // visitor specfic handle
    if (user.roleMode === WalnutAdminConstRoleMode.SWITCH && user.currentRoleName === Role.VISITOR) {
      // simply throw error
      // controller with role guard visitor cannot access
      throw new WalnutAdminExceptionNoAccessRolePermission()
    }

    // define the flag, default true
    let canNext = true

    // handle role strings
    if (Array.isArray(payloadRole)) {
      // and mode, use `every` to judge
      if (payloadRoleMode === WalnutAdminConstDecoratorRoleMode.AND) {
        if (user.roleMode === WalnutAdminConstRoleMode.COMBINE) {
          // combine && and
          canNext = payloadRole.every(i => allRoleNames.includes(i))
        }
        else {
          // switch && and
          // P3-32 修复（2026-10-29）：旧实现只打日志、canNext 保持默认 true —— 误配
          // （数组角色 + 默认 mode='and' + switchable 用户）会静默放行任意角色，是安全
          // 陷阱。当前全部数组调用方都显式传 'or'（device/log.operate），修复零破坏；
          // 未来误配由 40106 受控拒绝，不再放行。
          this.logger.error('Role `and` decorator and role mode `switch` cannot be used together')
          throw new WalnutAdminExceptionNoAccessRolePermission()
        }
      }

      // or mode, use `some` to judge
      if (payloadRoleMode === WalnutAdminConstDecoratorRoleMode.OR) {
        if (user.roleMode === WalnutAdminConstRoleMode.COMBINE) {
          // combine && or
          canNext = allRoleNames.some(i => payloadRole.includes(i))
        }
        else {
          // switch && or
          canNext = payloadRole.includes(user.currentRoleName)
        }
      }
    }

    // only one string, just use `includes` to judge
    if (typeof payloadRole === 'string') {
      canNext = allRoleNames.includes(payloadRole)
    }

    // can not go ahead, throw custom permission error
    if (!canNext) {
      throw new WalnutAdminExceptionNoAccessRolePermission()
    }

    return canNext
  }
}
