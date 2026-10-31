import type { IWalnutAdminConstAppSettingFunctionalRoleKeys } from '@walnut-server/const/app/setting'
import type { IWalnutAdminConstRoleMode } from '@walnut-server/const/role'
import { WalnutAdminConstDataScope, WalnutAdminConstDataScopeMode } from '@walnut-server/const/app/dataScope'
import { WalnutAdminConstAppSettingScopeType } from '@walnut-server/const/app/setting'
import { WalnutAdminConstRoleMode } from '@walnut-server/const/role'
import { SharedScopeResolverService } from '@walnut-server/scope-resolver'
import { beforeEach, describe, expect, it } from 'vitest'
import { DataScopeService } from './data-scope.service'

/**
 * DataScopeService 的缓存/失效纪律（无 Nest、无 DB —— 全部替身）。
 *
 * 覆盖：缓存命中不打库、正负结果都缓存、dept_id / 子树 / CUSTOM 清单的读取契约、
 * 角色成员反查失效、角色部门清单变更失效、部门移动/删除的子树失效。
 */

interface FakeRole {
  id: string
  roleName: string
  status: boolean
  dataScope: number
}

interface FakeUser {
  id: string
  roleMode: string
  currentRole: string | null
  deptId: string | null
}

class FakeCache {
  readonly store = new Map<string, unknown>()
  readonly deleted: string[] = []
  /** epoch 计数器：裸整数（与真实实现一样在 WALNUT_CACHE_ 命名空间之外） */
  readonly counters = new Map<string, number>()
  /** 故障注入：epoch 读 / bump 抛错（覆盖 N1/N2 的降级分支） */
  failEpochRead = false
  failEpochBump = false
  epochReads = 0

  readonly redis = {
    get: async (key: string): Promise<string | null> => {
      this.epochReads += 1
      if (this.failEpochRead) {
        throw new Error('redis down')
      }
      const value = this.counters.get(key)
      return value === undefined ? null : String(value)
    },
    incr: async (key: string): Promise<number> => {
      if (this.failEpochBump) {
        throw new Error('redis down')
      }
      const next = (this.counters.get(key) ?? 0) + 1
      this.counters.set(key, next)
      return next
    },
  }

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
  users = new Map<string, FakeUser>()

  async findUserByUserId(userId: string) {
    return this.users.get(userId) ?? null
  }

  async findUserIdsByDeptIds(deptIds: string[]) {
    return [...this.users.values()]
      .filter(user => user.deptId !== null && deptIds.includes(user.deptId))
      .map(user => user.id)
  }
}

class FakeRoleRepo {
  orderedRoleIds = new Map<string, string[]>()
  roles = new Map<string, FakeRole>()
  members = new Map<string, string[]>()
  deptsByRole = new Map<string, string[]>()
  findByIdsCalls = 0
  findUserIdsCalls = 0
  findDeptIdsCalls = 0

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

  async findDeptIdsByRoleId(roleId: string) {
    this.findDeptIdsCalls += 1
    return this.deptsByRole.get(roleId) ?? []
  }

  async findRoleIdsByDeptIds(deptIds: string[]) {
    return [...this.deptsByRole.entries()]
      .filter(([, depts]) => depts.some(deptId => deptIds.includes(deptId)))
      .map(([roleId]) => roleId)
  }
}

class FakeDeptRepo {
  subtrees = new Map<string, string[]>()
  ancestors = new Map<string, string[]>()
  subtreeCalls = 0
  ancestorCalls = 0

  async findDeptIdsInSubtree(deptId: string) {
    this.subtreeCalls += 1
    return this.subtrees.get(deptId) ?? []
  }

  async findAncestorDeptIds(deptId: string) {
    this.ancestorCalls += 1
    return this.ancestors.get(deptId) ?? []
  }
}

const USER = '11111111-1111-4111-8111-111111111111'
const USER_B = '22222222-2222-4222-8222-222222222222'
const USER_C = '33333333-3333-4333-8333-333333333333'

const DEPT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const DEPT_CHILD = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const DEPT_B = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

function createService(roleMode: IWalnutAdminConstRoleMode = WalnutAdminConstRoleMode.SWITCH) {
  const cache = new FakeCache()
  const userRepo = new FakeUserRepo()
  const roleRepo = new FakeRoleRepo()
  const deptRepo = new FakeDeptRepo()

  const functionalRole: IWalnutAdminConstAppSettingFunctionalRoleKeys<IWalnutAdminConstRoleMode> = {
    scope: WalnutAdminConstAppSettingScopeType.GLOBAL,
    globalValue: roleMode,
    localKey: 'roleMode',
    defaultRole: 'default-role',
  }

  const service = new DataScopeService(
    cache as never,
    { getFunctionalRole: async () => functionalRole } as never,
    new SharedScopeResolverService(),
    { getAccessTokenExpireSeconds: () => 1800 } as never,
    userRepo as never,
    roleRepo as never,
    deptRepo as never,
  )

  userRepo.users.set(USER, { id: USER, roleMode: WalnutAdminConstRoleMode.SWITCH, currentRole: 'role-self', deptId: DEPT_A })

  return { service, cache, userRepo, roleRepo, deptRepo }
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
    expect(ctx.cache.store.get(`AUTH:DATA_SCOPE:0:${USER}`)).toEqual({ mode: WalnutAdminConstDataScopeMode.SELF })

    expect(await ctx.service.resolveForUser(USER)).toEqual({ mode: WalnutAdminConstDataScopeMode.SELF })
    expect(ctx.roleRepo.findByIdsCalls).toBe(1)
  })

  it('dept 角色 → 读 user.dept_id（不查子树）', async () => {
    ctx.userRepo.users.set(USER, { id: USER, roleMode: WalnutAdminConstRoleMode.SWITCH, currentRole: 'role-dept', deptId: DEPT_B })
    ctx.roleRepo.orderedRoleIds.set(USER, ['role-dept'])
    ctx.roleRepo.roles.set('role-dept', { id: 'role-dept', roleName: 'dept', status: true, dataScope: WalnutAdminConstDataScope.DEPT })

    expect(await ctx.service.resolveForUser(USER)).toEqual({
      mode: WalnutAdminConstDataScopeMode.DEPT,
      deptIds: [DEPT_B],
    })
    expect(ctx.deptRepo.subtreeCalls).toBe(0)
    expect(ctx.roleRepo.findDeptIdsCalls).toBe(0)
  })

  it('dept 角色 + 用户无部门 → 空集（默认拒绝）', async () => {
    ctx.userRepo.users.set(USER, { id: USER, roleMode: WalnutAdminConstRoleMode.SWITCH, currentRole: 'role-dept', deptId: null })
    ctx.roleRepo.orderedRoleIds.set(USER, ['role-dept'])
    ctx.roleRepo.roles.set('role-dept', { id: 'role-dept', roleName: 'dept', status: true, dataScope: WalnutAdminConstDataScope.DEPT })

    expect(await ctx.service.resolveForUser(USER)).toEqual({
      mode: WalnutAdminConstDataScopeMode.DEPT,
      deptIds: [],
    })
    expect(ctx.deptRepo.subtreeCalls).toBe(0)
  })

  it('dept_and_child → 递归子树只查一次（多角色复用）', async () => {
    const combineCtx = createService(WalnutAdminConstRoleMode.COMBINE)
    combineCtx.userRepo.users.set(USER, { id: USER, roleMode: WalnutAdminConstRoleMode.COMBINE, currentRole: 'role-child', deptId: DEPT_A })
    combineCtx.deptRepo.subtrees.set(DEPT_A, [DEPT_A, DEPT_CHILD])
    combineCtx.roleRepo.orderedRoleIds.set(USER, ['role-child', 'role-child-2'])
    combineCtx.roleRepo.roles.set('role-child', { id: 'role-child', roleName: 'child', status: true, dataScope: WalnutAdminConstDataScope.DEPT_AND_CHILD })
    combineCtx.roleRepo.roles.set('role-child-2', { id: 'role-child-2', roleName: 'child2', status: true, dataScope: WalnutAdminConstDataScope.DEPT_OR_SELF })

    const descriptor = await combineCtx.service.resolveForUser(USER)

    expect(descriptor.mode).toBe(WalnutAdminConstDataScopeMode.DEPT_OR_SELF)
    expect(new Set(descriptor.deptIds)).toEqual(new Set([DEPT_A, DEPT_CHILD]))
    expect(descriptor.userIds).toEqual([USER])
    expect(combineCtx.deptRepo.subtreeCalls).toBe(1)
  })

  it('dept_or_self → 子树 + 本人腿', async () => {
    ctx.userRepo.users.set(USER, { id: USER, roleMode: WalnutAdminConstRoleMode.SWITCH, currentRole: 'role-or-self', deptId: DEPT_A })
    ctx.deptRepo.subtrees.set(DEPT_A, [DEPT_A])
    ctx.roleRepo.orderedRoleIds.set(USER, ['role-or-self'])
    ctx.roleRepo.roles.set('role-or-self', { id: 'role-or-self', roleName: 'or-self', status: true, dataScope: WalnutAdminConstDataScope.DEPT_OR_SELF })

    expect(await ctx.service.resolveForUser(USER)).toEqual({
      mode: WalnutAdminConstDataScopeMode.DEPT_OR_SELF,
      deptIds: [DEPT_A],
      userIds: [USER],
    })
  })

  it('custom 角色 → 读 sys_role_dept 部门清单（角色成员不参与）', async () => {
    ctx.userRepo.users.set(USER, { id: USER, roleMode: WalnutAdminConstRoleMode.SWITCH, currentRole: 'role-custom', deptId: DEPT_A })
    ctx.roleRepo.orderedRoleIds.set(USER, ['role-custom'])
    ctx.roleRepo.roles.set('role-custom', { id: 'role-custom', roleName: 'b', status: true, dataScope: WalnutAdminConstDataScope.CUSTOM })
    ctx.roleRepo.members.set('role-custom', [USER_B])
    ctx.roleRepo.deptsByRole.set('role-custom', [DEPT_A, DEPT_B])

    const descriptor = await ctx.service.resolveForUser(USER)

    expect(descriptor).toEqual({
      mode: WalnutAdminConstDataScopeMode.CUSTOM,
      deptIds: [DEPT_A, DEPT_B],
    })
    expect(ctx.roleRepo.findDeptIdsCalls).toBe(1)
    // CUSTOM 不再取角色成员清单
    expect(ctx.roleRepo.findUserIdsCalls).toBe(0)
  })

  it('custom 空清单 → 默认拒绝', async () => {
    ctx.userRepo.users.set(USER, { id: USER, roleMode: WalnutAdminConstRoleMode.SWITCH, currentRole: 'role-custom', deptId: DEPT_A })
    ctx.roleRepo.orderedRoleIds.set(USER, ['role-custom'])
    ctx.roleRepo.roles.set('role-custom', { id: 'role-custom', roleName: 'b', status: true, dataScope: WalnutAdminConstDataScope.CUSTOM })

    expect(await ctx.service.resolveForUser(USER)).toEqual({
      mode: WalnutAdminConstDataScopeMode.CUSTOM,
      deptIds: [],
    })
  })

  it('root 角色短路：不查子树 / 不查 CUSTOM 清单', async () => {
    ctx.userRepo.users.set(USER, { id: USER, roleMode: WalnutAdminConstRoleMode.COMBINE, currentRole: 'role-root', deptId: DEPT_A })
    ctx.roleRepo.orderedRoleIds.set(USER, ['role-root', 'role-custom'])
    ctx.roleRepo.roles.set('role-root', { id: 'role-root', roleName: 'root', status: true, dataScope: WalnutAdminConstDataScope.ALL })
    ctx.roleRepo.roles.set('role-custom', { id: 'role-custom', roleName: 'c', status: true, dataScope: WalnutAdminConstDataScope.CUSTOM })

    expect(await ctx.service.resolveForUser(USER)).toEqual({ mode: WalnutAdminConstDataScopeMode.ALL })
    expect(ctx.deptRepo.subtreeCalls).toBe(0)
    expect(ctx.roleRepo.findDeptIdsCalls).toBe(0)
  })

  it('无角色 → 默认拒绝，并且负结果也缓存', async () => {
    const descriptor = await ctx.service.resolveForUser(USER)

    expect(descriptor).toEqual({ mode: WalnutAdminConstDataScopeMode.CUSTOM, deptIds: [] })
    expect(ctx.cache.store.get(`AUTH:DATA_SCOPE:0:${USER}`)).toEqual(descriptor)
  })

  it('用户不存在 → 默认拒绝', async () => {
    ctx.userRepo.users.clear()

    expect(await ctx.service.resolveForUser(USER))
      .toEqual({ mode: WalnutAdminConstDataScopeMode.CUSTOM, deptIds: [] })
  })

  it('invalidateForUser 只清该用户键，下一次解析重新打库', async () => {
    ctx.roleRepo.orderedRoleIds.set(USER, ['role-self'])
    ctx.roleRepo.roles.set('role-self', { id: 'role-self', roleName: 'a', status: true, dataScope: WalnutAdminConstDataScope.SELF })

    await ctx.service.resolveForUser(USER)
    expect(ctx.roleRepo.findByIdsCalls).toBe(1)

    await ctx.service.invalidateForUser(USER)
    expect(ctx.cache.deleted).toContain(`AUTH:DATA_SCOPE:0:${USER}`)

    await ctx.service.resolveForUser(USER)
    expect(ctx.roleRepo.findByIdsCalls).toBe(2)
  })

  it('invalidateForRole 按角色成员反查并逐个清键', async () => {
    ctx.roleRepo.members.set('role-x', [USER, USER_B])

    await ctx.service.invalidateForRole('role-x')

    expect(ctx.cache.deleted).toEqual(expect.arrayContaining([
      `AUTH:DATA_SCOPE:0:${USER}`,
      `AUTH:DATA_SCOPE:0:${USER_B}`,
    ]))
  })

  it('invalidateForRoleDeptChange：CUSTOM 清单变更只失效该角色成员', async () => {
    ctx.roleRepo.members.set('role-custom', [USER, USER_B])

    await ctx.service.invalidateForRoleDeptChange('role-custom')

    expect(ctx.cache.deleted).toEqual(expect.arrayContaining([
      `AUTH:DATA_SCOPE:0:${USER}`,
      `AUTH:DATA_SCOPE:0:${USER_B}`,
    ]))
    expect(ctx.roleRepo.findDeptIdsCalls).toBe(0)
  })

  it('invalidateForDeptMove：子树 + 新祖先链 + 旧祖先链的用户全部失效', async () => {
    const userAncestor = '44444444-4444-4444-8444-444444444444'
    const userOldAncestor = '55555555-5555-4555-8555-555555555555'
    ctx.userRepo.users.set(USER_B, { id: USER_B, roleMode: WalnutAdminConstRoleMode.SWITCH, currentRole: null, deptId: DEPT_CHILD })
    ctx.userRepo.users.set(userAncestor, { id: userAncestor, roleMode: WalnutAdminConstRoleMode.SWITCH, currentRole: null, deptId: DEPT_A })
    ctx.userRepo.users.set(userOldAncestor, { id: userOldAncestor, roleMode: WalnutAdminConstRoleMode.SWITCH, currentRole: null, deptId: DEPT_B })
    ctx.userRepo.users.set(USER_C, { id: USER_C, roleMode: WalnutAdminConstRoleMode.SWITCH, currentRole: null, deptId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' })

    ctx.deptRepo.subtrees.set(DEPT_CHILD, [DEPT_CHILD])
    ctx.deptRepo.ancestors.set(DEPT_CHILD, [DEPT_A])

    await ctx.service.invalidateForDeptMove(DEPT_CHILD, [DEPT_B])

    expect(ctx.cache.deleted).toEqual(expect.arrayContaining([
      `AUTH:DATA_SCOPE:0:${USER_B}`,
      `AUTH:DATA_SCOPE:0:${userAncestor}`,
      `AUTH:DATA_SCOPE:0:${userOldAncestor}`,
    ]))
    expect(ctx.cache.deleted).not.toContain(`AUTH:DATA_SCOPE:0:${USER_C}`)
  })

  it('invalidateForDeptIds：去重 + 空集合不查库', async () => {
    await ctx.service.invalidateForDeptIds([])
    expect(ctx.cache.deleted).toEqual([])

    ctx.deptRepo.subtrees.set(DEPT_A, [DEPT_A])
    await ctx.service.invalidateForDeptIds([DEPT_A, DEPT_A])
    // 数据权限三期：账号部门（RLS WITH CHECK 腿）的缓存键随描述符一起失效
    expect(ctx.cache.deleted).toEqual([
      `AUTH:DATA_SCOPE:0:${USER}`,
      `AUTH:DATA_SCOPE:dept:${USER}`,
    ])
  })

  it('invalidateForUsers 去重', async () => {
    await ctx.service.invalidateForUsers([USER, USER, USER_B])

    expect(ctx.cache.deleted).toEqual([
      `AUTH:DATA_SCOPE:0:${USER}`,
      `AUTH:DATA_SCOPE:dept:${USER}`,
      `AUTH:DATA_SCOPE:0:${USER_B}`,
      `AUTH:DATA_SCOPE:dept:${USER_B}`,
    ])
  })

  it('epoch 缺省 0：描述符键带世代前缀，读路径不写 epoch 键', async () => {
    ctx.roleRepo.orderedRoleIds.set(USER, ['role-self'])
    ctx.roleRepo.roles.set('role-self', { id: 'role-self', roleName: 'a', status: true, dataScope: WalnutAdminConstDataScope.SELF })

    await ctx.service.resolveForUser(USER)

    expect(ctx.cache.store.get(`AUTH:DATA_SCOPE:0:${USER}`)).toEqual({ mode: WalnutAdminConstDataScopeMode.SELF })
    // GET 不到按 0，但读路径不创建 epoch 计数器（首个 bump 才从 1 开始）
    expect(ctx.cache.counters.size).toBe(0)
  })

  it('bumpEpoch：新世代键缺失即重算，旧世代键保留但不再被读', async () => {
    ctx.roleRepo.orderedRoleIds.set(USER, ['role-self'])
    ctx.roleRepo.roles.set('role-self', { id: 'role-self', roleName: 'a', status: true, dataScope: WalnutAdminConstDataScope.SELF })

    expect(await ctx.service.resolveForUser(USER)).toEqual({ mode: WalnutAdminConstDataScopeMode.SELF })
    expect(ctx.roleRepo.findByIdsCalls).toBe(1)

    await ctx.service.bumpEpoch()
    expect(ctx.cache.counters.get('AUTH:DATA_SCOPE:EPOCH')).toBe(1)

    // 角色档位改成 ALL：若旧键仍命中，这里会继续返回 SELF
    ctx.roleRepo.roles.set('role-self', { id: 'role-self', roleName: 'a', status: true, dataScope: WalnutAdminConstDataScope.ALL })

    expect(await ctx.service.resolveForUser(USER)).toEqual({ mode: WalnutAdminConstDataScopeMode.ALL })
    expect(ctx.roleRepo.findByIdsCalls).toBe(2)
    expect(ctx.cache.store.get(`AUTH:DATA_SCOPE:1:${USER}`)).toEqual({ mode: WalnutAdminConstDataScopeMode.ALL })
    // 旧世代键不删（等 TTL），只是不可达
    expect(ctx.cache.store.get(`AUTH:DATA_SCOPE:0:${USER}`)).toEqual({ mode: WalnutAdminConstDataScopeMode.SELF })
  })

  it('bump 后 invalidateForUser 只删当前世代的键', async () => {
    await ctx.service.bumpEpoch()

    await ctx.service.invalidateForUser(USER)

    expect(ctx.cache.deleted).toContain(`AUTH:DATA_SCOPE:1:${USER}`)
    expect(ctx.cache.deleted).toContain(`AUTH:DATA_SCOPE:dept:${USER}`)
    expect(ctx.cache.deleted).not.toContain(`AUTH:DATA_SCOPE:0:${USER}`)
  })

  it('epoch 读失败 → 跳过描述符缓存（不读也不写），每次请求重算', async () => {
    ctx.roleRepo.orderedRoleIds.set(USER, ['role-self'])
    ctx.roleRepo.roles.set('role-self', { id: 'role-self', roleName: 'a', status: true, dataScope: WalnutAdminConstDataScope.SELF })
    ctx.cache.failEpochRead = true

    expect(await ctx.service.resolveForUser(USER)).toEqual({ mode: WalnutAdminConstDataScopeMode.SELF })
    expect(ctx.cache.store.size).toBe(0)

    expect(await ctx.service.resolveForUser(USER)).toEqual({ mode: WalnutAdminConstDataScopeMode.SELF })
    expect(ctx.roleRepo.findByIdsCalls).toBe(2)
    expect(ctx.cache.store.size).toBe(0)
  })

  it('bumpEpoch 失败只 warn 不抛（设置写不因失效动作 500）', async () => {
    ctx.cache.failEpochBump = true

    await expect(ctx.service.bumpEpoch()).resolves.toBeUndefined()
  })

  it('invalidateForUsers 批量入口 epoch 只读一次', async () => {
    await ctx.service.invalidateForUsers([USER, USER_B, USER])

    expect(ctx.cache.epochReads).toBe(1)
    expect(ctx.cache.deleted).toEqual([
      `AUTH:DATA_SCOPE:0:${USER}`,
      `AUTH:DATA_SCOPE:dept:${USER}`,
      `AUTH:DATA_SCOPE:0:${USER_B}`,
      `AUTH:DATA_SCOPE:dept:${USER_B}`,
    ])
  })
})
