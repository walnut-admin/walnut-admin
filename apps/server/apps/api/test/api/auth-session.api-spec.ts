import type { NestExpressApplication } from '@nestjs/platform-express'
import type { Response as SuperTestResponse } from 'supertest'
import type { WalnutRootUserFixture } from './helpers/auth-login'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { ConfigService } from '@nestjs/config'
import { WalnutAdminConstAppCacheKeys } from '@walnut-server/const/app/cache'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bodyOf, expectOk, WalnutApiClient } from './helpers/api-client'
import { performHttpOpaqueLogin, registerRootUserFixture } from './helpers/auth-login'
import { createApiApp } from './helpers/create-api-app'
import { decryptAesKeyEnvelope } from './helpers/sign-handshake'

/**
 * D 段：`auth` 会话链（真实 HTTP 全链）—— 会话生命周期闭环：
 *
 * - `GET /auth/permissions`：登录态拉权限 + 权限缓存写入（AUTH:PERMISSIONS 键出现，
 *   删除后重查复现 —— 写路径可重入）；
 * - `POST /auth/refresh`：RT_JTI cookie → 新 AT（轮换是**同 jti 原地换锁**：同一行
 *   encrypted_token/expired_at 被替换、revoked 保持 false —— 钉实现现状，不存在
 *   「旧行 revoked + 新行」两行形态）；无 RT cookie 的干净设备 → 40102；
 * - `POST /auth/signout`：RT revoke + RT_JTI cookie 清除 + 提交后缓存清理
 *   （permissions / MFA verified 消失；AUTH:SESSIONS 键残留 —— delByPattern 在
 *   node-redis v5 下抛错，钉现状），旧 AT 再请求 → MFA verified 缓存已清，
 *   MFA guard（在 Sign guard 之前）先拦 40115；
 * - `GET /auth/keys`：响应体 `EncryptResponse('B')` —— B 字段是走设备握手 RSA 公钥
 *   加密的信封（与 aes-key 握手第二步同格式），客户端私钥解密还原 vendor.baidu 明文。
 *
 * 集成库 sys_menu 空表会让 getCorePermissions(ALL) 的 indexMenuName 组装在
 * `permissionMenuTree[0].children` 上 TypeError（50000，Mongo 时代同病，空数据边界）——
 * beforeAll 造 CATALOG 根 + MENU 子级两行（响应顶层是首根的 children），afterAll 清行还现场。
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface PermissionsData {
  permissionStrings: string[]
  permissionMenuTree: Array<{ name?: string, children?: unknown[] }>
  permissionRouteTree: unknown[]
  keepAliveNames: string[]
  affixedTabs: unknown[]
  indexMenuName: string
  internalIframeList: unknown[]
}

/** 短轮询断言：键在 timeoutMs 内消失（after-commit 清缓存链路，不赌时序） */
async function expectKeyGone(api: WalnutApiClient, key: string, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!(await api.hasWalnutCacheKey(key))) {
      return
    }
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  expect(await api.hasWalnutCacheKey(key), `key should be gone: ${key}`).toBe(false)
}

/** 从 JWT（AT/RT）第二段解 payload（base64url，无验签 —— 测试侧只读 sid/jti） */
function decodeJwtPayload(token: string): Record<string, unknown> {
  const payloadPart = token.split('.')[1]
  return JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as Record<string, unknown>
}

describe('D 段：auth 会话链 permissions/refresh/signout/keys（真实 HTTP 全链）', () => {
  let app: NestExpressApplication
  let api: WalnutApiClient
  /** 无登录态的干净设备（refresh 无 RT cookie 错误路径） */
  let anonClient: WalnutApiClient

  const seed8 = randomUUID().slice(0, 8)
  const menuName = `auth-session-${seed8}`
  let fixture: WalnutRootUserFixture | null = null
  const menuIds: string[] = []
  let vendorBaiduPlain = ''

  beforeAll(async () => {
    app = await createApiApp()
    api = await WalnutApiClient.create(app)
    anonClient = await WalnutApiClient.create(app)

    fixture = await registerRootUserFixture(app, api.pgDataSource, `auth-session-${seed8}`)
    vendorBaiduPlain = app.get(ConfigService).get<string>('vendor.baidu')!

    const tokens = await performHttpOpaqueLogin(api, app, fixture)
    api.setAuth(tokens)
    await api.seedMfaVerifiedCache(fixture.userId)

    // sys_menu 空表会让 permissions 的 indexMenuName 组装 TypeError —— 造两行
    // （CATALOG 根 + MENU 子级；root 的菜单面 = 全表）。响应的 permissionMenuTree 是
    // 「首个根节点的 children」—— 只造单根时顶层数组恒空，树断言必须落在子级上
    const catalogRes = await api.root('POST', api.apiPath('/system/menu'), {
      pid: null,
      type: 'catalog',
      path: `/auth-session-cat-${seed8}`,
      name: `auth-session-cat-${seed8}`,
      title: `menu.title.cat.${seed8}`,
      icon: 'mdi:test-tube',
      meta: { order: 1 },
    })
    expectOk(catalogRes, 'menu catalog create')
    const catalogId = bodyOf<{ id: string }>(catalogRes).data.id
    expect(catalogId).toMatch(UUID_RE)
    menuIds.push(catalogId)

    const createRes = await api.root('POST', api.apiPath('/system/menu'), {
      pid: catalogId,
      type: 'menu',
      path: `/${menuName}`,
      name: menuName,
      title: `menu.title.${seed8}`,
      icon: 'mdi:test-tube',
      meta: { order: 1 },
    })
    expectOk(createRes, 'menu create for permissions')
    const menuId = bodyOf<{ id: string }>(createRes).data.id
    expect(menuId).toMatch(UUID_RE)
    menuIds.push(menuId)
  })

  afterAll(async () => {
    if (api !== undefined && fixture !== null) {
      // 子行先删（fk_menu_pid RESTRICT：catalog 必须后删）
      for (const id of [...menuIds].reverse()) {
        await api.pgDataSource.query('DELETE FROM sys_menu WHERE id = $1', [id])
      }
      await api.pgDataSource.query('DELETE FROM sys_user WHERE id = $1', [fixture.userId])
      await api.pgDataSource.query('DELETE FROM sys_role WHERE id = $1', [fixture.roleId])
      await api.pgDataSource.query('DELETE FROM sys_device WHERE device_id = ANY($1::text[])', [[api.deviceId, anonClient.deviceId]])
      await api.cleanupWalnutCacheKeys(seed8, api.deviceId, anonClient.deviceId, fixture.userId)
    }
    await app.close()
  })

  it('permissions → 20000，菜单树含本轮行 + 权限缓存键写入（可复现写路径）', async () => {
    const res = await api.root('GET', api.apiPath('/auth/permissions'))
    expectOk(res, 'auth permissions')

    const data = bodyOf<PermissionsData>(res).data
    // 顶层是首个根节点的 children —— MENU 子级在其中
    expect(data.permissionMenuTree.some(node => node.name === menuName)).toBe(true)
    expect(Array.isArray(data.permissionStrings)).toBe(true)
    expect(Array.isArray(data.permissionRouteTree)).toBe(true)
    expect(Array.isArray(data.affixedTabs)).toBe(true)
    expect(Array.isArray(data.internalIframeList)).toBe(true)
    // index menu name = 首根 children 首个 MENU 的 name
    expect(data.indexMenuName).toBe(menuName)

    // 权限缓存键（root 也写 —— setPermissions 对非 visitor 一律写）
    const permissionKey = `${WalnutAdminConstAppCacheKeys.AUTH_PERMISSIONS}:${fixture!.userId}:${api.deviceId}`
    expect(await api.hasWalnutCacheKey(permissionKey)).toBe(true)

    // 复用断言：删键后重查，缓存写路径再次落键（guard 消费的就是这条通道）
    await api.cleanupFixedCacheKeys(permissionKey)
    expect(await api.hasWalnutCacheKey(permissionKey)).toBe(false)

    const reRes = await api.root('GET', api.apiPath('/auth/permissions'))
    expectOk(reRes, 'auth permissions re-query')
    expect(await api.hasWalnutCacheKey(permissionKey)).toBe(true)
  })

  it('keys → 20000，B 字段是设备握手 RSA 信封（客户端私钥解密还原 vendor.baidu）', async () => {
    const res = await api.root('GET', api.apiPath('/auth/keys'))
    expectOk(res, 'auth keys')

    const data = bodyOf<{ B: string }>(res).data
    expect(typeof data.B).toBe('string')
    // 明文不出现（整字段已被信封替换）
    expect(data.B).not.toBe(vendorBaiduPlain)

    const decrypted = decryptAesKeyEnvelope(api.clientRsaPrivateKeyPem, data.B)
    expect(decrypted).toBe(vendorBaiduPlain)
  })

  it('refresh → 20000 新 AT；RT 轮换是同 jti 原地换锁（encrypted_token/expired_at 换新，revoked 恒 false）', async () => {
    const rowsBefore: Array<{ jti: string, encrypted_token: string, expired_at: Date, revoked: boolean }>
      = await api.pgDataSource.query(
        'SELECT jti, encrypted_token, expired_at, revoked FROM auth_refresh_token WHERE user_id = $1 AND device_id = $2',
        [fixture!.userId, api.deviceId],
      )
    expect(rowsBefore).toHaveLength(1)
    const before = rowsBefore[0]
    expect(before.revoked).toBe(false)

    const res = await api.anon('POST', api.apiPath('/auth/refresh'))
    expectOk(res, 'auth refresh')

    const newAT = bodyOf<{ accessToken: string }>(res).data.accessToken
    expect(typeof newAT).toBe('string')
    expect(newAT.length).toBeGreaterThan(20)
    // 新 AT 与旧 AT 同会话（sid 来自 RT 里固化的 sessionId，轮换只换令牌不换会话）
    const newPayload = decodeJwtPayload(newAT)
    expect(newPayload.sid).toBe(decodeJwtPayload(api.getAuth()!.accessToken).sid)

    const rowsAfter: Array<{ jti: string, encrypted_token: string, expired_at: Date, revoked: boolean }>
      = await api.pgDataSource.query(
        'SELECT jti, encrypted_token, expired_at, revoked FROM auth_refresh_token WHERE user_id = $1 AND device_id = $2',
        [fixture!.userId, api.deviceId],
      )
    expect(rowsAfter).toHaveLength(1)
    const after = rowsAfter[0]
    // 原地换锁：jti 不变、密文换新、过期时间前移、保持未撤销
    expect(after.jti).toBe(before.jti)
    expect(after.encrypted_token).not.toBe(before.encrypted_token)
    expect(after.expired_at.getTime()).toBeGreaterThanOrEqual(before.expired_at.getTime())
    expect(after.revoked).toBe(false)

    // 旧 AT 同会话仍可用（双因子签名依赖的会话键未变）
    const probe = await api.root('GET', api.apiPath('/auth/permissions'))
    expectOk(probe, 'permissions after refresh with old AT')
  })

  it('refresh 无 RT cookie（干净设备）→ 40102 RefreshTokenExpired', async () => {
    const res = await anonClient.anon('POST', anonClient.apiPath('/auth/refresh'))
    expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_REFRESH_TOKEN_EXPIRED)
  })

  it('permissions 匿名 → 40101（JWT guard 拦在权限组装之前）', async () => {
    const res = await api.anon('GET', api.apiPath('/auth/permissions'))
    expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_ACCESS_TOKEN_EXPIRED)
  })

  it('signout → 20000：RT revoke + RT_JTI cookie 清除 + 会话系缓存全清', async () => {
    const sessionKey = String(decodeJwtPayload(api.getAuth()!.accessToken).sid)
    const keysToClear = [
      `${WalnutAdminConstAppCacheKeys.AUTH_PERMISSIONS}:${fixture!.userId}:${api.deviceId}`,
      `${WalnutAdminConstAppCacheKeys.AUTH_MFA_VERIFIED}:${fixture!.userId}:${api.deviceId}`,
      `${WalnutAdminConstAppCacheKeys.AUTH_SESSIONS}:${fixture!.userId}:${api.deviceId}:${sessionKey}`,
    ]
    // 前置自证：三键在场（permissions 刚查过 / MFA 种过 / 会话键登录时建）
    for (const key of keysToClear) {
      expect(await api.hasWalnutCacheKey(key)).toBe(true)
    }

    const res: SuperTestResponse = await api.root('POST', api.apiPath('/auth/signout'))
    expectOk(res, 'auth signout')
    expect(bodyOf<boolean>(res).data).toBe(true)

    // RT_JTI cookie 被清除（__Host- 前缀 + Expires 归零）
    const setCookies = res.headers['set-cookie'] as unknown as string[] | undefined
    const rtCookie = setCookies?.find(raw => raw.startsWith('__Host-RT_JTI='))
    expect(rtCookie).toBeTruthy()
    expect(rtCookie!).toMatch(/Expires=Thu, 01 Jan 1970/)

    // RT 行 revoke（同 jti 原地置 revoked）
    const rows: Array<{ revoked: boolean, revoke_reason: string | null }> = await api.pgDataSource.query(
      'SELECT revoked, revoke_reason FROM auth_refresh_token WHERE user_id = $1 AND device_id = $2',
      [fixture!.userId, api.deviceId],
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].revoked).toBe(true)

    // 会话系缓存清理（after-commit 钩子，轮询兜时序）—— permissions / MFA verified 两键消失
    await expectKeyGone(api, keysToClear[0])
    await expectKeyGone(api, keysToClear[1])
    // 钉现状（非迁移回归，登记 ENDPOINTS.md）：AUTH:SESSIONS 键残留 —— revokeSession 走
    // cacheService.delByPattern，其内部 redis.del(batch数组) 在 node-redis v5 的 rest-args
    // 语义下抛错（C 段 user-device/monitor spec 同款已知问题），钩子错误被 catch 吞掉
    expect(await api.hasWalnutCacheKey(keysToClear[2])).toBe(true)
  })

  it('signout 后旧 AT 请求 → 40115（MFA verified 缓存已清：MFA guard 在 Sign guard 之前先拦）', async () => {
    const res = await api.root('GET', api.apiPath('/auth/permissions'))
    // 旧 AT 的 JWT 本身仍有效；但 signout 清了 MFA verified 缓存 —— 全局链顺序
    // JWT → MFA → Sign，MFA verify failed（40115）先于签名降级（40112）命中
    expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_MFA_VERIFY_FAILED)
  })
})
