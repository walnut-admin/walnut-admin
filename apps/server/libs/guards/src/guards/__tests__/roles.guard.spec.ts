import type { ExecutionContext } from '@nestjs/common'
import type { Reflector } from '@nestjs/core'
import { WalnutAdminConstDecoratorRoleMetadataKey, WalnutAdminConstDecoratorRoleMode } from '@walnut-server/const/decorator/role'
import { WalnutAdminConstRoleMode } from '@walnut-server/const/role'
import { WalnutAdminExceptionNoAccessRolePermission } from '@walnut-server/exceptions/business/auth'
import { Role } from '@walnut/contract'
import { describe, expect, it } from 'vitest'
import { WalnutAdminGuardRole } from '../roles.guard'

/**
 * P3-32（2026-10-29）：角色守卫的 `数组 + AND + switchable` 组合此前只打日志、
 * `canNext` 保持默认 true —— 静默放行任意角色（安全陷阱）。修复后受控 40106。
 *
 * 零破坏依据：全仓数组调用方（device.controller / log.operate.controller）都显式传
 * `'or'`；`and` 只在 COMBINE 下真正参与判定。
 */

function createContext(user: Record<string, unknown> | null): ExecutionContext {
  const request = { user }
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
    getHandler: () => function roleGuardSpecHandler() {},
    getClass: () => class RoleGuardSpecController {},
  } as unknown as ExecutionContext
}

function createGuard(roleMetadata: unknown, roleMode: unknown): WalnutAdminGuardRole {
  const reflector = {
    getAllAndOverride: (key: string) => {
      if (key === WalnutAdminConstDecoratorRoleMetadataKey.ROLE) {
        return roleMetadata
      }
      if (key === WalnutAdminConstDecoratorRoleMetadataKey.ROLE_MODE) {
        return roleMode
      }
      return undefined
    },
  } as unknown as Reflector

  return new WalnutAdminGuardRole(reflector)
}

const SWITCH_USER = {
  roleMode: WalnutAdminConstRoleMode.SWITCH,
  currentRoleName: Role.ADMIN,
  roleNames: [Role.ADMIN, Role.DEVELOPER],
}

const COMBINE_USER = {
  roleMode: WalnutAdminConstRoleMode.COMBINE,
  currentRoleName: Role.ADMIN,
  roleNames: [Role.ADMIN, Role.DEVELOPER],
}

describe('role guard：AND + SWITCH 不再静默放行（P3-32）', () => {
  it('switchable 用户 + 角色数组 + and → 40106（修复前 canNext 保持 true 直接放行）', async () => {
    const guard = createGuard([Role.ADMIN, Role.DEVELOPER], WalnutAdminConstDecoratorRoleMode.AND)

    await expect(guard.canActivate(createContext(SWITCH_USER)))
      .rejects
      .toBeInstanceOf(WalnutAdminExceptionNoAccessRolePermission)
  })

  it('switchable 用户 + 角色数组 + or → 按 currentRoleName 判定（合法组合不受影响）', async () => {
    const guard = createGuard([Role.ADMIN, Role.DEVELOPER], WalnutAdminConstDecoratorRoleMode.OR)

    await expect(guard.canActivate(createContext(SWITCH_USER))).resolves.toBe(true)
  })

  it('combinable 用户 + 角色数组 + and → every 判定（双角色全中放行）', async () => {
    const guard = createGuard([Role.ADMIN, Role.DEVELOPER], WalnutAdminConstDecoratorRoleMode.AND)

    await expect(guard.canActivate(createContext(COMBINE_USER))).resolves.toBe(true)
  })

  it('combinable 用户 + 角色数组 + and 缺一角色 → 40106', async () => {
    const guard = createGuard([Role.ADMIN, Role.ROOT], WalnutAdminConstDecoratorRoleMode.AND)

    await expect(guard.canActivate(createContext(COMBINE_USER)))
      .rejects
      .toBeInstanceOf(WalnutAdminExceptionNoAccessRolePermission)
  })

  it('无角色元数据 → 告警放行（装饰器使用错误的既有口径不变）', async () => {
    const guard = createGuard(undefined, undefined)

    await expect(guard.canActivate(createContext(SWITCH_USER))).resolves.toBe(true)
  })

  it('switchable + visitor → 40106（visitor 拒绝分支不变）', async () => {
    const guard = createGuard(Role.ADMIN, WalnutAdminConstDecoratorRoleMode.OR)

    await expect(guard.canActivate(createContext({
      roleMode: WalnutAdminConstRoleMode.SWITCH,
      currentRoleName: Role.VISITOR,
      roleNames: [Role.VISITOR],
    }))).rejects.toBeInstanceOf(WalnutAdminExceptionNoAccessRolePermission)
  })
})
