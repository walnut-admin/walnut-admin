import { CanActivate, ExecutionContext, Injectable, UseGuards } from '@nestjs/common'
import { WalnutAdminConstRoleMode } from '@walnut-server/const/role'
import { WalnutAdminExceptionNoAccessPermission } from '@walnut-server/exceptions/business/auth'
import { Role } from '@walnut/contract'

/**
 * visitor 显式拒绝守卫（P2-20，2026-10-29）。
 *
 * 背景：`GET /system/menu/tree` 返回全量菜单行（含隐藏/停用行与 `permission` 权限串），
 * 此前任何登录用户（含 switchable 的 visitor）都能读。visitor 没有任何管理/导航需求
 * （导航数据来自 `/auth/permissions`，按角色下发），因此对该端点显式拒绝，而不是给
 * 菜单树挂 `system:menu:*` —— 后者会破坏普通用户的菜单管理/角色授权视图
 * （permission guard 的 visitor 白名单又恰好放行 `:list`/`:read`，挡不住 visitor）。
 *
 * visitor 判定与 permission.guard / mfa.guard 同口径：`switchable` 且
 * `currentRoleName === visitor`。未登录请求交 JWT 守卫处理（这里放行）。
 */
@Injectable()
export class WalnutAdminGuardVisitorDeny implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<IWalnutAdminExpressRequest>()
    const user = request.user

    if (!user) {
      return true
    }

    if (user.roleMode === WalnutAdminConstRoleMode.SWITCH && user.currentRoleName === Role.VISITOR) {
      throw new WalnutAdminExceptionNoAccessPermission()
    }

    return true
  }
}

/**
 * @description 标记端点对 visitor 角色关闭（方法级守卫；全局 JWT 守卫先跑，user 已挂载）
 */
export function WalnutAdminDecoratorVisitorDeny() {
  return UseGuards(WalnutAdminGuardVisitorDeny)
}
