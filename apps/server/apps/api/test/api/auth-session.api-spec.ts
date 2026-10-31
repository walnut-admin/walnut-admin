import type { NestExpressApplication } from '@nestjs/platform-express'
import type { Response as SuperTestResponse } from 'supertest'
import type { WalnutRootUserFixture } from './helpers/auth-login'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { ConfigService } from '@nestjs/config'
import { WalnutAdminConstAppCacheKeys } from '@walnut-server/const/app/cache'
import { WalnutAdminConstCookieKeys } from '@walnut-server/const/app/cookie'
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
 * - `POST /auth/refresh`：RT_JTI cookie → 新 AT（轮换是 **revoke-and-insert**：旧行置
 *   `revoked=true (reason=rotate)` + INSERT 新行、响应 Set-Cookie 回种新 jti —— 2026-10-27
 *   取代「同 jti 原地换锁」；旧行 jti 一切后续请求（重放/错峰）被 guard 层撤销判定拦下
 *   40102，见 concurrency.api-spec G1）；无 RT cookie 的干净设备 → 40102；
 * - `POST /auth/signout`：RT revoke + RT_JTI cookie 清除 + 提交后缓存清理
 *   （permissions / MFA verified / AUTH:SESSIONS 三键全消失 —— P1-2 修复后
 *   delByPattern 正确摊平 scanIterator 批次并用 unlink 展开删除），旧 AT 再请求 →
 *   P0-4 的 JWT validate 查会话键先拦 40101（会话键已被 signout 清掉；修复前残留时
 *   是 MFA guard 40115）；
 * - `GET /auth/keys`：响应体 `EncryptResponse('B')` —— B 字段是走设备握手 RSA 公钥
 *   加密的信封（与 aes-key 握手第二步同格式），客户端私钥解密还原 vendor.baidu 明文。
 *
 * P1-8 修复后 sys_menu 空表不再让 getCorePermissions(ALL) 的 indexMenuName 组装 TypeError
 * （受控空树；单测见 menu.shared.service.spec）。本文件仍造 CATALOG 根 + MENU 子级两行，
 * 因为「响应顶层是首根的 children」的树形状断言需要子节点；afterAll 清行还现场。
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface PermissionMenuNode {
  name?: string
  children?: PermissionMenuNode[]
}

interface PermissionsData {
  permissionStrings: string[]
  permissionMenuTree: PermissionMenuNode[]
  permissionRouteTree: unknown[]
  keepAliveNames: string[]
  affixedTabs: unknown[]
  indexMenuName: string
  internalIframeList: unknown[]
}

/** indexMenuName 承诺的是「树首节点递归找到的第一个 MENU」，seed 层存在时首根可能是 seed 根 */
function containsMenuName(nodes: PermissionMenuNode[], name: string): boolean {
  for (const node of nodes) {
    if (node.name === name) {
      return true
    }
    if (node.children !== undefined && containsMenuName(node.children, name)) {
      return true
    }
  }
  return false
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

/** 解 Set-Cookie 里的 signed RT_JTI 值：`__Host-RT_JTI=s%3A<jti>.<sig>` → `<jti>`（jti 为 nanoid，不含 `.`） */
function decodeSignedJti(setCookies: string[] | undefined): string | null {
  const raw = setCookies?.find(c => c.startsWith('__Host-RT_JTI=')) ?? null
  if (raw === null) {
    return null
  }
  // res.cookie 对值做 encodeURIComponent（`s:` → `s%3A`），先解码再剥签名前缀/后缀
  const value = decodeURIComponent(raw.split(';')[0].slice('__Host-RT_JTI='.length))
  return value.replace(/^s:/, '').replace(/\.[^.]+$/, '')
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
  /** refresh 用例留存下来的轮换前 signed RT_JTI cookie（顺序重放用例复用，签名绑定旧 jti） */
  let replayCookie = ''

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
    // index menu name = 树首节点里递归找到的第一个 MENU。seed 层（integration globalSetup）
    // 让「首根」可能是 seed 的 System 根，不能假设本轮菜单排第一；只钉「非空且确实来自树」。
    expect(typeof data.indexMenuName).toBe('string')
    expect(data.indexMenuName.length).toBeGreaterThan(0)
    expect(containsMenuName(data.permissionMenuTree, data.indexMenuName)).toBe(true)

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

  it('refresh → 20000 新 AT；RT 轮换是 revoke-and-insert（旧行 revoked=rotate + 新行 + Set-Cookie 回种新 jti）', async () => {
    const rowsBefore: Array<{ jti: string, encrypted_token: string, expired_at: Date, revoked: boolean }>
      = await api.pgDataSource.query(
        'SELECT jti, encrypted_token, expired_at, revoked FROM auth_refresh_token WHERE user_id = $1 AND device_id = $2',
        [fixture!.userId, api.deviceId],
      )
    expect(rowsBefore).toHaveLength(1)
    const before = rowsBefore[0]
    expect(before.revoked).toBe(false)

    // 留存轮换前的 signed RT_JTI cookie（签名绑定 jti 值，无法事后伪造）—— 顺序重放用例复用
    replayCookie = api.getCookie(WalnutAdminConstCookieKeys.RT_JTI)!
    expect(replayCookie).toBeTruthy()

    const res = await api.anon('POST', api.apiPath('/auth/refresh'))
    expectOk(res, 'auth refresh')

    const newAT = bodyOf<{ accessToken: string }>(res).data.accessToken
    expect(typeof newAT).toBe('string')
    expect(newAT.length).toBeGreaterThan(20)
    // 新 AT 与旧 AT 同会话（sid 来自 RT 里固化的 sessionId，轮换只换令牌不换会话）
    const newPayload = decodeJwtPayload(newAT)
    expect(newPayload.sid).toBe(decodeJwtPayload(api.getAuth()!.accessToken).sid)

    // 轮换后行级形态：旧行 revoked（reason=rotate）+ 新行未撤销，恰两行
    const rowsAfter: Array<{ jti: string, encrypted_token: string, expired_at: Date, revoked: boolean, revoke_reason: string | null }>
      = await api.pgDataSource.query(
        'SELECT jti, encrypted_token, expired_at, revoked, revoke_reason FROM auth_refresh_token WHERE user_id = $1 AND device_id = $2 ORDER BY created_at ASC',
        [fixture!.userId, api.deviceId],
      )
    expect(rowsAfter).toHaveLength(2)
    // 不依赖 created_at 排序（同毫秒/时区/时钟源都可能让两行并列——实测跑批里出现过
    // 顺序颠倒）；按轮换前的 jti 身份取旧行，另一行即新行。
    const oldRow = rowsAfter.find(row => row.jti === before.jti)!
    const newRow = rowsAfter.find(row => row.jti !== before.jti)!
    expect(oldRow).toBeDefined()
    expect(newRow).toBeDefined()
    expect(oldRow.jti).toBe(before.jti)
    expect(oldRow.revoked).toBe(true)
    expect(oldRow.revoke_reason).toBe('rotate')
    expect(oldRow.encrypted_token).toBe(before.encrypted_token)
    expect(newRow.jti).not.toBe(before.jti)
    expect(newRow.revoked).toBe(false)
    expect(newRow.encrypted_token).not.toBe(before.encrypted_token)
    expect(newRow.expired_at.getTime()).toBeGreaterThanOrEqual(before.expired_at.getTime())

    // 响应 Set-Cookie 回种的 jti == 新行 jti（客户端下次 refresh 必须拿得到现役行）
    const cookieJti = decodeSignedJti(res.headers['set-cookie'] as unknown as string[] | undefined)
    expect(cookieJti).toBe(newRow.jti)

    // 旧 AT 同会话仍可用（双因子签名依赖的会话键未变）
    const probe = await api.root('GET', api.apiPath('/auth/permissions'))
    expectOk(probe, 'permissions after refresh with old AT')
  })

  it('顺序重放：持轮换前旧 jti cookie 再 refresh → 40102（guard 层拒撤销行）；jar 还原后现役 jti 仍可续期', async () => {
    // 前置自证：库里该会话旧行（revoked=rotate）+ 新行各恰一行；jar 当前是新 jti
    const revokedRows: Array<{ c: number }> = await api.pgDataSource.query(
      'SELECT count(*)::int AS c FROM auth_refresh_token WHERE user_id = $1 AND device_id = $2 AND revoked = true',
      [fixture!.userId, api.deviceId],
    )
    expect(revokedRows[0].c).toBe(1)

    // 留存现役新 jti 的 signed cookie（重放后还原 jar 用）
    const currentCookie = api.getCookie(WalnutAdminConstCookieKeys.RT_JTI)!
    expect(currentCookie).toBeTruthy()

    // 种回轮换前留存的 signed cookie（签名绑定旧 jti，合法通过 cookie-parser 验签）
    api.setCookie(WalnutAdminConstCookieKeys.RT_JTI, replayCookie)
    const replay = await api.anon('POST', api.apiPath('/auth/refresh'))
    expect(bodyOf(replay).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_REFRESH_TOKEN_EXPIRED)

    // 重放无副作用：仍恰两行（无第三次插入）
    const rows: Array<{ c: number }> = await api.pgDataSource.query(
      'SELECT count(*)::int AS c FROM auth_refresh_token WHERE user_id = $1 AND device_id = $2',
      [fixture!.userId, api.deviceId],
    )
    expect(rows[0].c).toBe(2)

    // jar 还原为现役新 jti 的 signed cookie，续期正常（第三轮：旧行再撤、再插新行）
    api.setCookie(WalnutAdminConstCookieKeys.RT_JTI, currentCookie)
    const res = await api.anon('POST', api.apiPath('/auth/refresh'))
    expectOk(res, 'auth refresh after replay')
    const rowsAfter: Array<{ revoked: boolean, c: number }> = await api.pgDataSource.query(
      'SELECT revoked, count(*)::int AS c FROM auth_refresh_token WHERE user_id = $1 AND device_id = $2 GROUP BY revoked ORDER BY revoked ASC',
      [fixture!.userId, api.deviceId],
    )
    expect(rowsAfter).toEqual([
      { revoked: false, c: 1 },
      { revoked: true, c: 2 },
    ])
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

    // RT 行 revoke（revoke-and-insert 时代同维度多行：历轮 rotate 旧行 + 轮换后的现役行，
    // signout 全量撤销；本用例前序已轮换两轮 → 3 行全 revoked）
    const rows: Array<{ revoked: boolean, revoke_reason: string | null }>
      = await api.pgDataSource.query(
        'SELECT revoked, revoke_reason FROM auth_refresh_token WHERE user_id = $1 AND device_id = $2',
        [fixture!.userId, api.deviceId],
      )
    expect(rows.length).toBe(3)
    expect(rows.every(r => r.revoked)).toBe(true)
    // signout 的撤销不带 reason —— 只覆盖 revoked 列，rotate 旧行的历史 reason 保留
    expect(rows.filter(r => r.revoke_reason === 'rotate')).toHaveLength(2)

    // 会话系缓存清理（after-commit 钩子，轮询兜时序）—— P1-2 修复后三键全部消失
    await expectKeyGone(api, keysToClear[0])
    await expectKeyGone(api, keysToClear[1])
    // P1-2 修复（2026-10-28）：delByPattern 正确摊平 scanIterator 的批次数组（v5 按批
    // 产出 string[]，旧实现取 key[0] 且把空批变成 undefined → del 抛错被钩子吞掉），
    // AUTH:SESSIONS 键不再残留
    await expectKeyGone(api, keysToClear[2])
  })

  it('signout 后旧 AT 请求 → 40101（P0-4：JWT validate 查会话键，signout 已清 AUTH:SESSIONS）', async () => {
    const res = await api.root('GET', api.apiPath('/auth/permissions'))
    // 旧 AT 的签名/有效期仍通过，但会话键已被 signout 清理 —— JWT validate 先于 MFA/Sign
    // 拒绝（修复前会话键残留，是 MFA guard 的 40115 先拦）
    expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_ACCESS_TOKEN_EXPIRED)
  })
})
