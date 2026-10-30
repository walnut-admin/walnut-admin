import type { IWalnutAdminConstAppSettingFunctionalRoleKeys } from '@walnut-server/const/app/setting'
import type { IWalnutAdminConstRoleMode } from '@walnut-server/const/role'
import { WalnutAdminConstDataScope, WalnutAdminConstDataScopeMode } from '@walnut-server/const/app/dataScope'
import { WalnutAdminConstAppSettingScopeType } from '@walnut-server/const/app/setting'
import { WalnutAdminConstRoleMode } from '@walnut-server/const/role'
import { beforeEach, describe, expect, it } from 'vitest'
import { SharedScopeResolverService } from '@/modules/shared/scopeResolver/scope-resolver.service'
import { DataScopeService } from './data-scope.service'

/**
 * DataScopeService 的缓存/失效纪律（无 Nest、无 DB —— 全部替身）。
 *
 * 覆盖：缓存命中不打库、正负结果都缓存、invalidateForUser/ForUsers/ForRole 的
 * 失效键、角色成员反查、CUSTOM 成员并集。
 */

interface FakeRole {
  id: string
  roleName: string
  status: boolean
  dataScope: number
}

class FakeCache {
  readonly store = new Map<string, unknown>()
  readonly deleted: string[] = []

  async get<T>(key: string): Promise<T | null> {
    return (this.store.get(key) as T | undefined) ?? null
  }

  async set(key: string, value: unknown) {
    this.store.set(key, value)
  }

  async del(key: string) {
    this.deleted.push(key)
    this.store.delete(key)
  }
}

class FakeUserRepo {
  users = new Map<string, { id: string, roleMode: string, currentRole: string | null }>()

  async findUserByUserId(userId: string) {
    return this.users.get(userId) ?? null
  }
}

class FakeRoleRepo {
  orderedRoleIds = new Map<string, string[]>()
  roles = new Map<string, FakeRole>()
  members = new Map<string, string[]>()
  findByIdsCalls = 0
  findUserIdsCalls = 0

  async findRoleIdsByUserId(userId: string) {
    return this.orderedRoleIds.get(userId) ?? []
  }

  async findByIds(ids: string[]) {
    this.findByIdsCalls += 1
    return ids.map(id => this.roles.get(id)).filter((role): role is FakeRole => role !== undefined)
  }

  async findUserIdsByRoleId(roleId: string) {
    this.findUserIdsCalls += 1
    return this.members.get(roleId) ?? []
  }
}

const USER = '11111111-1111-4111-8111-111111111111'
const USER_B = '22222222-2222-4222-8222-222222222222'

const functionalRole: IWalnutAdminConstAppSettingFunctionalRoleKeys<IWalnutAdminConstRoleMode> = {
  scope: WalnutAdminConstAppSettingScopeType.GLOBAL,
  globalValue: WalnutAdminConstRoleMode.SWITCH,
  localKey: 'roleMode',
  defaultRole: 'default-role',
}

function createService() {
  const cache = new FakeCache()
  const userRepo = new FakeUserRepo()
  const roleRepo = new FakeRoleRepo()

  const service = new DataScopeService(
    cache as never,
    { getFunctionalRole: async () => functionalRole } as never,
    new SharedScopeResolverService(),
    { getAccessTokenExpireSeconds: () => 1800 } as never,
    userRepo as never,
    roleRepo as never,
  )

  userRepo.users.set(USER, { id: USER, roleMode: WalnutAdminConstRoleMode.SWITCH, currentRole: 'role-self' })

  return { service, cache, userRepo, roleRepo }
}

describe('data-scope service 解析与缓存', () => {
  let ctx: ReturnType<typeof createService>

  beforeEach(() => {
    ctx = createService()
  })

  it('self 角色 → SELF；缓存命中后不再打库', async () => {
    ctx.roleRepo.orderedRoleIds.set(USER, ['role-self'])
    ctx.roleRepo.roles.set('role-self', { id: 'role-self', roleName: 'a', status: true, dataScope: WalnutAdminConstDataScope.SELF })

    expect(await ctx.service.resolveForUser(USER)).toEqual({ mode: WalnutAdminConstDataScopeMode.SELF })
    expect(ctx.roleRepo.findByIdsCalls).toBe(1)
    expect(ctx.cache.store.get(`AUTH:DATA_SCOPE:${USER}`)).toEqual({ mode: WalnutAdminConstDataScopeMode.SELF })

    expect(await ctx.service.resolveForUser(USER)).toEqual({ mode: WalnutAdminConstDataScopeMode.SELF })
    expect(ctx.roleRepo.findByIdsCalls).toBe(1)
  })

  it('custom 角色 → CUSTOM（本人 ∪ 角色成员）；成员清单只查一次', async () => {
    ctx.userRepo.users.set(USER, { id: USER, roleMode: WalnutAdminConstRoleMode.SWITCH, currentRole: 'role-custom' })
    ctx.roleRepo.orderedRoleIds.set(USER, ['role-custom'])
    ctx.roleRepo.roles.set('role-custom', { id: 'role-custom', roleName: 'b', status: true, dataScope: WalnutAdminConstDataScope.CUSTOM })
    ctx.roleRepo.members.set('role-custom', [USER_B])

    const descriptor = await ctx.service.resolveForUser(USER)

    expect(descriptor.mode).toBe(WalnutAdminConstDataScopeMode.CUSTOM)
    expect(new Set(descriptor.userIds)).toEqual(new Set([USER, USER_B]))
    expect(ctx.roleRepo.findUserIdsCalls).toBe(1)
  })

  it('无角色 → 默认拒绝，并且负结果也缓存', async () => {
    const descriptor = await ctx.service.resolveForUser(USER)

    expect(descriptor).toEqual({ mode: WalnutAdminConstDataScopeMode.CUSTOM, userIds: [] })
    expect(ctx.cache.store.get(`AUTH:DATA_SCOPE:${USER}`)).toEqual(descriptor)
  })

  it('用户不存在 → 默认拒绝', async () => {
    ctx.userRepo.users.clear()

    expect(await ctx.service.resolveForUser(USER))
      .toEqual({ mode: WalnutAdminConstDataScopeMode.CUSTOM, userIds: [] })
  })

  it('invalidateForUser 只清该用户键，下一次解析重新打库', async () => {
    ctx.roleRepo.orderedRoleIds.set(USER, ['role-self'])
    ctx.roleRepo.roles.set('role-self', { id: 'role-self', roleName: 'a', status: true, dataScope: WalnutAdminConstDataScope.SELF })

    await ctx.service.resolveForUser(USER)
    expect(ctx.roleRepo.findByIdsCalls).toBe(1)

    await ctx.service.invalidateForUser(USER)
    expect(ctx.cache.deleted).toContain(`AUTH:DATA_SCOPE:${USER}`)

    await ctx.service.resolveForUser(USER)
    expect(ctx.roleRepo.findByIdsCalls).toBe(2)
  })

  it('invalidateForRole 按角色成员反查并逐个清键', async () => {
    ctx.roleRepo.members.set('role-x', [USER, USER_B])

    await ctx.service.invalidateForRole('role-x')

    expect(ctx.cache.deleted).toEqual(expect.arrayContaining([
      `AUTH:DATA_SCOPE:${USER}`,
      `AUTH:DATA_SCOPE:${USER_B}`,
    ]))
  })

  it('invalidateForUsers 去重', async () => {
    await ctx.service.invalidateForUsers([USER, USER, USER_B])

    expect(ctx.cache.deleted).toEqual([
      `AUTH:DATA_SCOPE:${USER}`,
      `AUTH:DATA_SCOPE:${USER_B}`,
    ])
  })

  it('invalidateForUserRoleChanges：只失效 CUSTOM 角色的其他成员 + 用户自己（P1）', async () => {
    // B 被移出 role-custom；C 仍在该角色，其缓存里的成员快照包含 B
    const userC = '33333333-3333-4333-8333-333333333333'
    const userD = '44444444-4444-4444-8444-444444444444'

    ctx.roleRepo.roles.set('role-custom', { id: 'role-custom', roleName: 'custom', status: true, dataScope: WalnutAdminConstDataScope.CUSTOM })
    ctx.roleRepo.roles.set('role-self', { id: 'role-self', roleName: 'self', status: true, dataScope: WalnutAdminConstDataScope.SELF })
    ctx.roleRepo.members.set('role-custom', [USER_B, userC])
    ctx.roleRepo.members.set('role-self', [USER_B, userD])

    await ctx.service.invalidateForUserRoleChanges(USER_B, ['role-custom', 'role-self', 'role-custom'])

    expect(ctx.cache.deleted).toEqual(expect.arrayContaining([
      `AUTH:DATA_SCOPE:${USER_B}`,
      `AUTH:DATA_SCOPE:${userC}`,
    ]))
    // SELF 角色的成员快照不随 membership 变化 → 不反查、不误伤其他成员
    expect(ctx.cache.deleted).not.toContain(`AUTH:DATA_SCOPE:${userD}`)
    expect(ctx.roleRepo.findUserIdsCalls).toBe(1)
    // 角色 id 先去重再查
    expect(ctx.roleRepo.findByIdsCalls).toBe(1)
  })

  it('invalidateForRecoveredUser：按恢复后实时角色集失效 CUSTOM 成员 + 用户', async () => {
    const userC = '33333333-3333-4333-8333-333333333333'
    ctx.roleRepo.orderedRoleIds.set(USER_B, ['role-custom'])
    ctx.roleRepo.roles.set('role-custom', { id: 'role-custom', roleName: 'custom', status: true, dataScope: WalnutAdminConstDataScope.CUSTOM })
    ctx.roleRepo.members.set('role-custom', [USER_B, userC])

    await ctx.service.invalidateForRecoveredUser(USER_B)

    expect(ctx.cache.deleted).toEqual(expect.arrayContaining([
      `AUTH:DATA_SCOPE:${USER_B}`,
      `AUTH:DATA_SCOPE:${userC}`,
    ]))
  })
})
