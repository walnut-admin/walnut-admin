import type { INestApplication } from '@nestjs/common'
import type { DataSource } from 'typeorm'
import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'

import { ALSRequestService } from '@walnut-server/als'
import { AppTechCacheAppSettingsService } from '@walnut-server/cache'
import { WalnutAdminConstAppCacheType } from '@walnut-server/const/app/cache'
import { SysUserBasicRepository, SysUserCrudService, SysUserIdentityRepositoryService, SysUserMeService, SysUserOAuthRepositoryService, SysUserRepositoryService, SysUserSharedService } from '@walnut-server/identity'
import { SysRoleBasicRepository } from '@walnut-server/system'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createIntegrationApp, getWalnutPgAdminDataSource } from './helpers/create-integration-app'
import { INTEGRATION_DATABASE_NAME } from './helpers/integration.const'

/**
 * B7a 账户团第一段用例（phase2 4.1/4.10/4.13 / phase3-plan §1 B7a，on real PG）：
 * - sys_user：roles 数组 → sys_user_role junction（create 缺省 = defaultRole、update
 *   整组替换、未给不动）、roles_list / roles_count junction 组装、
 *   uq_user_name partial unique、列表 { data, total } + 计数、软删快照 + junction CASCADE；
 * - defaultRole 链路：role fixture 以 v5 uuid（ETL namespace 派生，独立参考实现与
 *   工具链 uuid5.ts 互为对拍）显式建行，`app.default.role` setting 走缓存直设 ——
 *   crud / shared 两条建用户路径都按 uuid 语义落到该角色；
 * - sys_user_identity：(user_id, type, purpose) 复合唯一 23505、value 的 select:false
 *   （默认查询不出、专用通道取回）、update / delete 的「未命中返回 null」语义、
 *   随 user 删除 CASCADE；
 * - sys_user_oauth：bindOAuthForUser upsert（同 (user, provider) 重绑更新 providerId）、
 *   uq_oauth (provider, provider_id) 唯一 23505（同一外部账号只能绑一个用户）、
 *   service.create 的存在即跳过语义。
 */

/** 工具链 WALNUT_ADMIN_ETL_NAMESPACE 的字面量钉值（uuid5.ts 同源；改动须两处同步） */
const WALNUT_ADMIN_ETL_NAMESPACE = 'c1882c14-e4d4-4f2b-b728-346db51c312e'

/** RFC 4122 §4.3 参考实现（与 @walnut/scripts uuid5.ts 互为对拍的独立实现） */
function uuidV5Reference(name: string, namespace: string): string {
  const ns = Buffer.from(namespace.replaceAll('-', ''), 'hex')
  const hash = createHash('sha1').update(ns).update(name, 'utf8').digest()
  const bytes = Buffer.from(hash.subarray(0, 16))
  bytes[6] = (bytes[6] & 0x0F) | 0x50
  bytes[8] = (bytes[8] & 0x3F) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

describe('B7a user / identity / oauth (on real PG)', () => {
  let app: INestApplication
  let pgDataSource: DataSource

  let userCrudService: SysUserCrudService
  let userMeService: SysUserMeService
  let userSharedService: SysUserSharedService
  let userBasicRepo: SysUserBasicRepository
  let userRepoService: SysUserRepositoryService
  let identityRepoService: SysUserIdentityRepositoryService
  let oauthRepoService: SysUserOAuthRepositoryService
  let roleBasicRepo: SysRoleBasicRepository
  let cacheAppSettingsService: AppTechCacheAppSettingsService
  let als: ALSRequestService

  /**
   * 数据权限一期：sys_user 已注册（SELF = 本人），直接调 SysUserBasicRepository /
   * 其消费者（crud/me service）的用例必须显式进入系统通道（等价系统任务）。
   */
  const itSystem = (name: string, fn: () => Promise<void>) => it(name, async () => als.runAsSystem(fn))

  const uniqueName = (prefix: string) => `${prefix}-${randomUUID().replaceAll('-', '').slice(0, 8)}`

  async function countPg(table: string, where: string, params: unknown[]) {
    const rows: Array<{ c: number }> = await pgDataSource.query(
      `SELECT count(*)::int AS c FROM ${table} WHERE ${where}`,
      params,
    )
    return rows[0].c
  }

  async function insertPgUser(userName?: string): Promise<string> {
    const rows: Array<{ id: string }> = await pgDataSource.query(
      'INSERT INTO sys_user (user_name) VALUES ($1) RETURNING id',
      [userName ?? null],
    )
    return rows[0].id
  }

  beforeAll(async () => {
    app = await createIntegrationApp()
    pgDataSource = getWalnutPgAdminDataSource(app)
    expect(pgDataSource.options.database).toBe(INTEGRATION_DATABASE_NAME)

    userCrudService = app.get(SysUserCrudService)
    userMeService = app.get(SysUserMeService)
    userSharedService = app.get(SysUserSharedService)
    userBasicRepo = app.get(SysUserBasicRepository)
    userRepoService = app.get(SysUserRepositoryService)
    identityRepoService = app.get(SysUserIdentityRepositoryService)
    oauthRepoService = app.get(SysUserOAuthRepositoryService)
    roleBasicRepo = app.get(SysRoleBasicRepository)
    cacheAppSettingsService = app.get(AppTechCacheAppSettingsService)
    als = app.get(ALSRequestService)
  })

  afterAll(async () => {
    await app.close()
  })

  describe('sys_user：junction 与 populate 组装', () => {
    let roleAId = ''
    let roleBId = ''

    beforeAll(async () => {
      roleAId = (await roleBasicRepo.create({ roleName: uniqueName('b7a-role-a') })).id
      roleBId = (await roleBasicRepo.create({ roleName: uniqueName('b7a-role-b') })).id
    })

    itSystem('create：显式 roles 落 junction，currentRole 取首个角色', async () => {
      const created = await userCrudService.create({
        userName: uniqueName('b7a-user'),
        status: true,
        roles: [roleAId, roleBId],
      })

      expect(created.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
      expect([...created.roles].sort()).toEqual([roleAId, roleBId].sort())
      expect(created.currentRole).toBe(roleAId)

      expect(await countPg('sys_user_role', 'user_id = $1', [created.id])).toBe(2)
    })

    itSystem('create：roles 缺省 → defaultRole（v5 uuid fixture + functional.role setting 直设）', async () => {
      // ETL 语义造 role fixture：hex → v5 uuid 派生后以显式 id 建行
      const roleHex = randomUUID().replaceAll('-', '').slice(0, 24)
      const roleUuid = uuidV5Reference(roleHex, WALNUT_ADMIN_ETL_NAMESPACE)
      expect(roleUuid[14]).toBe('5')
      await roleBasicRepo.create({ id: roleUuid, roleName: uniqueName('b7a-default-role') })

      // functional.role setting 直设缓存（getFunctionalRole 的数据源；值形态对齐
      // extractAppSettingIntoCache 的 JSON 串）。集成 Redis 是共享的 —— 先快照后还原，
      // 不污染其他 spec / 本地 dev 环境
      const settingSnapshot = await cacheAppSettingsService.getAppSettings()
      await cacheAppSettingsService.setAppSettings(
        {
          ...(settingSnapshot ?? {}),
          'app.functional.role': JSON.stringify({
            scope: 'global',
            globalValue: 'switchable',
            localKey: 'roleMode',
            defaultRole: roleUuid,
          }),
        },
        { t: WalnutAdminConstAppCacheType.BUILT_IN },
      )

      try {
        const created = await userCrudService.create({
          userName: uniqueName('b7a-user-default'),
          status: true,
        })

        expect(created.roles).toEqual([roleUuid])
        expect(created.currentRole).toBe(roleUuid)

        // shared 建用户路径同链路（auth 自动注册走这里）
        const authCreated = await userSharedService.createForAuthUser({ userName: uniqueName('b7a-auth-user') })
        const populated = await userRepoService.attachPopulatedRoles(authCreated)
        expect(populated.roles).toEqual([roleUuid])
        expect(populated.currentRole).toBe(roleUuid)
        expect(populated.roles_list.map(i => i.id)).toEqual([roleUuid])
      }
      finally {
        await cacheAppSettingsService.setAppSettings(settingSnapshot ?? {}, { t: WalnutAdminConstAppCacheType.BUILT_IN })
      }
    })

    itSystem('uq_user_name partial unique：同名拒绝；NULL user_name 多行放行', async () => {
      const userName = uniqueName('b7a-uniq')

      await userBasicRepo.create({ userName })
      await expect(userBasicRepo.create({ userName })).rejects.toMatchObject({ code: '23505' })

      // partial（WHERE user_name IS NOT NULL）：NULL 不进唯一索引
      await insertPgUser()
      await insertPgUser()
    })

    itSystem('read：roles_list / roles_count junction 组装', async () => {
      const created = await userCrudService.create({
        userName: uniqueName('b7a-read'),
        status: true,
        roles: [roleAId, roleBId],
      })

      const read = await userCrudService.read(created.id)
      expect(read.roles_list).toHaveLength(2)
      expect(read.roles_list.map(i => i.id).sort()).toEqual([roleAId, roleBId].sort())
      expect(read.roles_list[0].roleName).toBeTruthy()
      expect(read.roles_count).toBe(2)

      await expect(userCrudService.read(randomUUID())).rejects.toThrow()

      // me.profile 同一条组装链路
      const profile = await userMeService.getUserProfile(created.id)
      expect(profile!.roles_list.map(i => i.id).sort()).toEqual([roleAId, roleBId].sort())
    })

    itSystem('update：roles 整组替换；未给 roles 时 junction 不动', async () => {
      const created = await userBasicRepo.create({ userName: uniqueName('b7a-upd'), roles: [roleAId] })

      const updated = await userBasicRepo.update(created.id, { roles: [roleBId] })
      expect(updated.roles).toEqual([roleBId])
      expect(await countPg('sys_user_role', 'user_id = $1', [created.id])).toBe(1)

      // 未给：junction 原样（对齐 Mongo 逐字段赋值语义）
      const untouched = await userBasicRepo.update(created.id, { nickName: 'b7a-nick' })
      expect(untouched.roles).toBeUndefined()
      expect(await countPg('sys_user_role', 'user_id = $1', [created.id])).toBe(1)
    })

    itSystem('list：{ data, total } 出参 + roles_count 并回 + userName 过滤', async () => {
      const userName = uniqueName('b7a-list')
      const created = await userBasicRepo.create({ userName, roles: [roleAId] })

      const res = await userCrudService.list({ query: { userName }, page: { page: 1, pageSize: 10 } } as never)
      expect(res.total).toBe(1)
      expect(res.data[0].id).toBe(created.id)
      expect(res.data[0].roles_count).toBe(1)

      const miss = await userCrudService.list({ query: { userName: 'atlantis-b7a' }, page: { page: 1, pageSize: 10 } } as never)
      expect(miss.total).toBe(0)
    })

    itSystem('软删：sys_deleted 快照（modelName=SysUserModel）+ junction 行级联消失', async () => {
      const created = await userBasicRepo.create({ userName: uniqueName('b7a-del'), roles: [roleAId] })

      // 操作者与被删者不能是同一人（cannot delete self）
      const snapshot = await userCrudService.delete(created.id, randomUUID(), pgDataSource.manager) as { id: string }
      expect(snapshot.id).toBe(created.id)

      expect(await countPg('sys_user', 'id = $1', [created.id])).toBe(0)
      expect(await countPg('sys_user_role', 'user_id = $1', [created.id])).toBe(0)

      const deletedRows: Array<{ c: number }> = await pgDataSource.query(
        'SELECT count(*)::int AS c FROM sys_deleted WHERE model_name = $1 AND deleted_id = $2',
        ['SysUser', created.id],
      )
      expect(deletedRows[0].c).toBe(1)
    })

    itSystem('identity 随 user 删除 CASCADE（FK → sys_user ON DELETE CASCADE）', async () => {
      const userId = await insertPgUser(uniqueName('b7a-cascade'))
      await identityRepoService.createIdentity({
        userId,
        type: 'emailAddress',
        purpose: 'login',
        value: 'enc',
        valueHash: uniqueName('b7a-hash'),
        maskedValue: 'b7a@***',
        metadata: {},
      })

      expect(await countPg('sys_user_identity', 'user_id = $1', [userId])).toBe(1)

      await pgDataSource.query('DELETE FROM sys_user WHERE id = $1', [userId])
      expect(await countPg('sys_user_identity', 'user_id = $1', [userId])).toBe(0)
    })
  })

  describe('sys_user_identity：复合唯一与 value 通道', () => {
    let userId = ''

    const identityPayload = (overrides: { type?: string, purpose?: string, valueHash?: string, userId?: string } = {}) => ({
      userId: overrides.userId ?? userId,
      type: overrides.type ?? 'emailAddress',
      purpose: overrides.purpose ?? 'login',
      value: 'ciphertext',
      valueHash: overrides.valueHash ?? uniqueName('b7a-id-hash'),
      maskedValue: 'b7a***',
      metadata: {},
    })

    beforeAll(async () => {
      userId = await insertPgUser(uniqueName('b7a-id-user'))
    })

    itSystem('createIdentity：DB 默认值落位（verified=false / status=true / isPrimary=true / metadata={}）', async () => {
      const created = await identityRepoService.createIdentity(identityPayload())

      expect(created.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
      expect(created.verified).toBe(false)
      expect(created.status).toBe(true)
      expect(created.isPrimary).toBe(true)
      expect(created.verifiedAt).toBeNull()
      expect(created.metadata).toEqual({})
    })

    itSystem('uq_identity (user_id, type, purpose)：复合唯一冲突 23505（对照 Mongo schema.index）', async () => {
      // 独立 user + 独立 (type, purpose) 组合，避免与同 describe 其他用例的键相撞
      const payload = identityPayload({ type: 'phoneNumber' })
      await identityRepoService.createIdentity(payload)

      // 完全同键拒绝
      await expect(identityRepoService.createIdentity(payload)).rejects.toMatchObject({ code: '23505' })

      // 同 user + type 换 purpose 放行
      await identityRepoService.createIdentity(identityPayload({ type: 'phoneNumber', purpose: 'security' }))

      // 换 user 同 (type, purpose) 放行
      const otherUserId = await insertPgUser(uniqueName('b7a-id-user-2'))
      await identityRepoService.createIdentity({ ...payload, userId: otherUserId })
    })

    itSystem('value select:false：默认查询不出该列，专用通道取回', async () => {
      const payload = identityPayload({ type: 'password' })
      const created = await identityRepoService.createIdentity(payload)

      const found = await identityRepoService.findByUserIdTypeAndPurpose(userId, 'password', 'login')
      expect(found!.id).toBe(created.id)
      expect(found!.value).toBeUndefined()

      expect(await identityRepoService.getValueByUserIdTypeAndPurpose(userId, 'password', 'login')).toBe('ciphertext')
    })

    itSystem('updateByUserIdTypeAndPurpose / deleteByUserIdTypeAndPurpose：命中即写、未命中 null', async () => {
      const payload = identityPayload({ type: 'idCard' })
      await identityRepoService.createIdentity(payload)

      const updated = await identityRepoService.updateByUserIdTypeAndPurpose(userId, 'idCard', 'login', {
        verified: true,
        verifiedAt: new Date(),
        maskedValue: 'updated***',
      })
      expect(updated!.verified).toBe(true)
      expect(updated!.maskedValue).toBe('updated***')

      const snapshot = await identityRepoService.deleteByUserIdTypeAndPurpose(userId, 'idCard', 'login')
      expect(snapshot!.maskedValue).toBe('updated***')
      expect(await countPg('sys_user_identity', 'user_id = $1 AND type = $2', [userId, 'idCard'])).toBe(0)

      expect(await identityRepoService.updateByUserIdTypeAndPurpose(userId, 'idCard', 'login', { verified: false })).toBeNull()
      expect(await identityRepoService.deleteByUserIdTypeAndPurpose(userId, 'idCard', 'login')).toBeNull()
    })

    itSystem('findByValueHash：(type, value_hash) 查找键命中、purpose 参与过滤', async () => {
      // 独立 user，键空间不与本 describe 其他用例相撞
      const owner = await insertPgUser(uniqueName('b7a-hash-user'))
      const hash = uniqueName('b7a-find-hash')
      await identityRepoService.createIdentity(identityPayload({ userId: owner, type: 'idCard', valueHash: hash }))
      await identityRepoService.createIdentity(identityPayload({ userId: owner, type: 'idCard', valueHash: hash, purpose: 'security' }))

      const login = await identityRepoService.findByValueHash('idCard', 'login', hash)
      expect(login!.purpose).toBe('login')

      const security = await identityRepoService.findByValueHash('idCard', 'security', hash)
      expect(security!.purpose).toBe('security')

      expect(await identityRepoService.findByValueHash('idCard', 'login', 'no-such-hash')).toBeNull()
    })
  })

  describe('sys_user_oauth：bind upsert 与外部账号唯一', () => {
    let userId = ''
    let otherUserId = ''

    beforeAll(async () => {
      userId = await insertPgUser(uniqueName('b7a-oauth-user'))
      otherUserId = await insertPgUser(uniqueName('b7a-oauth-user-2'))
    })

    itSystem('bindOAuthForUser：首绑插入；同 (user, provider) 重绑更新 providerId（同一行）', async () => {
      const bound = await oauthRepoService.bindOAuthForUser(userId, 'gitee', 'gp-1')
      expect(bound.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
      expect(bound.providerId).toBe('gp-1')
      expect(bound.status).toBe(true)

      const rebound = await oauthRepoService.bindOAuthForUser(userId, 'gitee', 'gp-2')
      expect(rebound.id).toBe(bound.id)
      expect(rebound.providerId).toBe('gp-2')

      expect(await countPg('sys_user_oauth', 'user_id = $1', [userId])).toBe(1)
    })

    itSystem('uq_oauth (provider, provider_id)：同一外部账号绑到第二个用户拒绝 23505', async () => {
      await expect(oauthRepoService.bindOAuthForUser(otherUserId, 'gitee', 'gp-2')).rejects.toMatchObject({ code: '23505' })

      // 其他 provider / 其他 providerId 不受影响
      await oauthRepoService.bindOAuthForUser(otherUserId, 'github', 'gp-2')
      expect(await countPg('sys_user_oauth', 'user_id = $1', [otherUserId])).toBe(1)
    })

    itSystem('findByProviderAndProviderId：provider + providerId 定位（登录查找路径）', async () => {
      const found = await oauthRepoService.findByProviderAndProviderId('gitee', 'gp-2')
      expect(found!.userId).toBe(userId)

      expect(await oauthRepoService.findByProviderAndProviderId('gitee', 'nobody')).toBeNull()
    })

    itSystem('existsByFields：模块内 service 的「存在即跳过」前置判断', async () => {
      const providerId = uniqueName('b7a-oauth-svc')
      await oauthRepoService.bindOAuthForUser(userId, 'github', providerId)

      const existed = await oauthRepoService.existsByFields({ userId, provider: 'github' })
      expect(existed).toBe(true)

      expect(await oauthRepoService.existsByFields({ userId, provider: 'google-one-tap' })).toBe(false)
    })
  })
})
