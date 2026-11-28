import type { NestExpressApplication } from '@nestjs/platform-express'
import type { WalnutRootUserFixture } from '../../helpers/auth-login'
import type { SeedPermissionChainFixture } from '../../helpers/seed-permissions'
import { Buffer } from 'node:buffer'
import { constants, createCipheriv, publicEncrypt, randomBytes, randomUUID } from 'node:crypto'
import { ConfigService } from '@nestjs/config'
import * as opaque from '@serenity-kit/opaque'
import { AppTechCacheLockService, AppTechCacheService } from '@walnut-server/cache'
import { WalnutAdminConstAppCacheKeys } from '@walnut-server/const/app/cache'
import { SecurityCapSettingService } from '@walnut-server/security'
import { SysDeviceSettingService } from '@walnut-server/system'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'
import { compare } from 'bcryptjs'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { bodyOf, expectOk, WalnutApiClient } from '../../helpers/api-client'
import { performHttpOpaqueLogin, registerRootUserFixture } from '../../helpers/auth-login'
import { createApiApp } from '../../helpers/create-api-app'
import { cleanupPermissionChainSeed, seedPermissionChainUser } from '../../helpers/seed-permissions'

/**
 * L1（2026-11-27）：锁屏密码全套 server 侧回归 —— Q10 信封 / 计次退避 / fallback verify /
 * 登录即解锁 / 管理员重置 / D1 D2 缺陷。
 *
 * 与既有 `user-lock.api-spec.ts`（read + lock/unlock baseline）互补：本文件只覆盖 L1 新增与
 * 修复面，全部走真实 HTTP 全链（device → CAP → sign → JWT → MFA → Lock → Tx）。
 *
 * 关键口径：
 * - **计次落在独立事务**：解锁失败会回滚请求事务，但 `lock_pwd_fail_count` 必须留下；
 * - **退避曲线**真源在 `lock-pwd-backoff.ts`（阈值 5、30s→1m→…→30m 封顶），这里读 DB 断言；
 * - **fallback 不签 token**：verify/finish 只解锁，不新建会话（规避 DuplicateSignIn）；
 * - **方案②**：完整登录成功 ⇒ 按 lockCrossDevice 解锁（跨设备=全解，单设备=只解本台）。
 *
 * 测试不得出现真实密钥字面量：RSA 公钥从运行中的 app key 读，AES key 每次随机。
 */

interface LockStatus {
  locked: boolean
  lockCrossDevice: boolean
  lockMode: string
  lockIdleSec: number
  lockSecuritySec: number
  lockPwdSet: boolean
  lockRoute: { name?: string } | null
}

interface LockRow {
  lock_pwd_hash: string | null
  lock_pwd_fail_count: number
  lock_pwd_locked_until: Date | null
  lock_pwd_updated_at: Date | null
}

/**
 * 与 admin `encryptRequestValue`（`utils/axios/interceptors/request/crypto.ts`）逐字节同构：
 * base64(JSON{ enc, key, iv, ct, tag })，key = RSA-OAEP-SHA256(aesKey|32B)。
 */
function encryptRequestEnvelope(serverRsaPubKeyPem: string, plaintext: string): string {
  const aesKey = randomBytes(32)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', aesKey, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  const key = publicEncrypt(
    { key: serverRsaPubKeyPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    aesKey,
  )

  return Buffer.from(
    JSON.stringify({
      enc: 'AES_256_GCM',
      key: key.toString('base64'),
      iv: iv.toString('base64'),
      ct: ct.toString('base64'),
      tag: tag.toString('base64'),
    }),
  ).toString('base64')
}

describe('L1 锁屏密码：信封 / 计次退避 / fallback / 登录即解锁 / 管理员重置', () => {
  let app: NestExpressApplication
  let api: WalnutApiClient
  let cache: AppTechCacheService
  let lockCache: AppTechCacheLockService

  const seed8 = randomUUID().slice(0, 8)
  let fixture: WalnutRootUserFixture | null = null
  let extraClients: WalnutApiClient[] = []
  let permissionFixture: SeedPermissionChainFixture | null = null
  let permissionClient: WalnutApiClient | null = null
  let serverRsaPubKey = ''
  // 集成库没有预置 app_key：本 spec 用 root 的 /app/key/init 造一对 —— 结束时必须删掉，
  // 否则同轮串行后面 app.key.int-spec 的 'initFirst 首个 key' 会撞 DataExists
  let createdRsaKeyId: string | null = null

  const PREFERENCE = '/system/user/lock/preference'
  const LOCK = '/system/user/lock'
  const UNLOCK = '/system/user/lock/unlock'
  const VERIFY_START = '/system/user/lock/verify/start'
  const VERIFY_FINISH = '/system/user/lock/verify/finish'
  const RESET = '/system/user/lock/reset'
  const PROBE = '/system/user/me/profile'

  function userId(): string {
    return fixture!.userId
  }

  function lockKey(deviceId: string) {
    return `${WalnutAdminConstAppCacheKeys.SECURITY_LOCK}:${userId()}:${deviceId}`
  }

  async function readLockRow(): Promise<LockRow | null> {
    const rows: LockRow[] = await api.pgDataSource.query(
      'SELECT lock_pwd_hash, lock_pwd_fail_count, lock_pwd_locked_until, lock_pwd_updated_at FROM sys_user_lock WHERE user_id = $1',
      [userId()],
    )
    return rows[0] ?? null
  }

  async function deviceRows(): Promise<Array<{ device_id: string; locked: boolean }>> {
    return api.pgDataSource.query(
      'SELECT device_id, locked FROM sys_user_device WHERE user_id = $1 ORDER BY device_id',
      [userId()],
    )
  }

  async function setPreference(payload: Record<string, unknown>) {
    const res = await api.root('PATCH', api.apiPath(PREFERENCE), payload)
    expectOk(res, `preference ${JSON.stringify(Object.keys(payload))}`)
    return res
  }

  async function lock() {
    const res = await api.root('PATCH', api.apiPath(LOCK), { lockRoute: { name: `l1-${seed8}` } })
    expectOk(res, 'lock')
  }

  async function resetLockState() {
    await api.pgDataSource.query('DELETE FROM sys_user_lock WHERE user_id = $1', [userId()])
    await api.pgDataSource.query('UPDATE sys_user_device SET locked = false WHERE user_id = $1', [
      userId(),
    ])
    await cache.del(lockKey(api.deviceId))
    await cache.del(`${WalnutAdminConstAppCacheKeys.SECURITY_LOCK}:${userId()}:global`)
    await cache.delByPattern(`${WalnutAdminConstAppCacheKeys.SECURITY_LOCK}:${userId()}:*`)
  }

  /** 新设备 + 登录（方案②的「换一台设备登录」） */
  async function createLoggedInClient(): Promise<{
    client: WalnutApiClient
    tokens: Awaited<ReturnType<typeof performHttpOpaqueLogin>>
  }> {
    const client = await WalnutApiClient.create(app)
    const tokens = await performHttpOpaqueLogin(client, app, fixture!)
    client.setAuth(tokens)
    await client.seedMfaVerifiedCache(userId())
    extraClients.push(client)
    return { client, tokens }
  }

  async function cleanupExtraClients() {
    for (const client of extraClients) {
      await api.pgDataSource.query(
        'DELETE FROM sys_user_device WHERE user_id = $1 AND device_id = $2',
        [userId(), client.deviceId],
      )
      await api.pgDataSource.query('DELETE FROM sys_device WHERE device_id = $1', [client.deviceId])
      await api.cleanupWalnutCacheKeys(client.deviceId)
      await cache.del(lockKey(client.deviceId))
    }
    extraClients = []
  }

  /** OPAQUE 登录口令兜底：start → 客户端 finishLogin → verify/finish */
  async function runFallbackVerify(password: string) {
    const configService = app.get(ConfigService)
    const appName = configService.get<string>('app.name')!

    const { clientLoginState, startLoginRequest } = opaque.client.startLogin({ password })
    const startRes = await api.root('POST', api.apiPath(VERIFY_START), { start: startLoginRequest })
    expectOk(startRes, 'lock verify start')

    const loginResult = opaque.client.finishLogin({
      clientLoginState,
      loginResponse: bodyOf<string>(startRes).data,
      password,
      identifiers: { client: fixture!.userName, server: appName },
    })

    if (!loginResult) {
      throw new Error('[lock-verify] opaque client finishLogin returned falsy')
    }

    return api.root('POST', api.apiPath(VERIFY_FINISH), { finish: loginResult.finishLoginRequest })
  }

  beforeAll(async () => {
    app = await createApiApp()
    api = await WalnutApiClient.create(app)
    cache = app.get(AppTechCacheService)
    lockCache = app.get(AppTechCacheLockService)

    fixture = await registerRootUserFixture(app, api.pgDataSource, `ulkp-${seed8}`)
    const tokens = await performHttpOpaqueLogin(api, app, fixture)
    api.setAuth(tokens)
    await api.seedMfaVerifiedCache(fixture.userId)

    // 与 admin 同一条通道拿服务端公钥（GET /security/rsa/public-key 是 sign-free / jwt-free / cap-free）
    const keyRes = await api.anon('GET', api.apiPath('/security/rsa/public-key'))
    expectOk(keyRes, 'fetch server rsa public key')
    serverRsaPubKey = bodyOf<string>(keyRes).data

    if (serverRsaPubKey === undefined || serverRsaPubKey === '') {
      // 集成库没有预置 app_key（bootstrap 任务在测试里关掉）：root 初始化一对 RSA，
      // 与生产首次部署同路径（POST /app/key/init）
      const initRes = await api.root('POST', api.apiPath('/app/key/init'), { type: 'RSA_PAIR' })
      expectOk(initRes, 'init rsa key')
      createdRsaKeyId = bodyOf<{ id: string }>(initRes).data.id
      const reRes = await api.anon('GET', api.apiPath('/security/rsa/public-key'))
      expectOk(reRes, 'refetch server rsa public key')
      serverRsaPubKey = bodyOf<string>(reRes).data
    }

    // 本文件要造 3~4 台设备（fallback / 方案② / 管理员重置 / 权限拒绝），而 device/initial
    // 的限流是 4 次/60s。这里放宽的是**与本文件被测面无关**的那道闸（锁屏链路本身不经过
    // 它），避免同轮多 spec 串行时把 429 当成业务失败。
    vi.spyOn(app.get(SysDeviceSettingService), 'getThrottleLimit').mockResolvedValue(100)
    // 同理：CAP challenge 也是 4~5 次/分钟（app_setting 配置），多设备引导会撞 429
    vi.spyOn(app.get(SecurityCapSettingService), 'getThrottleLimit').mockResolvedValue(100)
  })

  afterEach(async () => {
    await cleanupExtraClients()
    await resetLockState()
  })

  afterAll(async () => {
    await cleanupExtraClients()
    await resetLockState()

    if (permissionFixture !== null) {
      await cleanupPermissionChainSeed(
        api,
        [permissionFixture],
        permissionClient === null ? [] : [permissionClient.deviceId],
      )
    }

    if (createdRsaKeyId !== null) {
      await api.pgDataSource.query('DELETE FROM app_key WHERE id = $1', [createdRsaKeyId])
    }

    await api.pgDataSource.query('DELETE FROM sys_user WHERE id = $1', [fixture!.userId])
    await api.pgDataSource.query('DELETE FROM sys_role WHERE id = $1', [fixture!.roleId])
    await api.pgDataSource.query('DELETE FROM sys_device WHERE device_id = $1', [api.deviceId])
    await api.cleanupWalnutCacheKeys(seed8, api.deviceId, fixture!.userId)
    await app.close()
  })

  // ---------------------------------------------------------------- Q10 信封

  it('Q10：preference 的 lockPwdHash 走请求信封 —— 解出明文后 bcrypt 落库；read 只回 lockPwdSet', async () => {
    const plain = 'pin-envelope-1'
    const envelope = encryptRequestEnvelope(serverRsaPubKey, plain)

    await setPreference({ lockMode: 'security', lockPwdHash: envelope, lockCrossDevice: true })

    const row = await readLockRow()
    expect(row).not.toBeNull()
    expect(row!.lock_pwd_hash).toMatch(/^\$2[aby]\$/)
    expect(row!.lock_pwd_hash).not.toBe(plain)
    expect(await compare(plain, row!.lock_pwd_hash!)).toBe(true)
    // 最近设置时间随「真的写了新密码」落库
    expect(row!.lock_pwd_updated_at).not.toBeNull()

    const readRes = await api.root('GET', api.apiPath('/system/user/lock/read'))
    expectOk(readRes, 'read after envelope preference')
    const data = bodyOf<LockStatus>(readRes).data
    expect(data.lockMode).toBe('security')
    expect(data.lockPwdSet).toBe(true)
    // R1/D9：hash 永不出响应
    expect(Object.hasOwn(data, 'lockPwdHash')).toBe(false)
  })

  it('信封与明文混用：坏信封 40011（自愈协议语义），明文字段照旧可用', async () => {
    const broken = Buffer.from(
      JSON.stringify({
        enc: 'AES_256_GCM',
        key: Buffer.from('not-a-real-rsa-blob').toString('base64'),
        iv: Buffer.from('i'.repeat(12)).toString('base64'),
        ct: Buffer.from('cipher').toString('base64'),
        tag: Buffer.from('t'.repeat(16)).toString('base64'),
      }),
    ).toString('base64')

    const badRes = await api.root('PATCH', api.apiPath(PREFERENCE), {
      lockMode: 'security',
      lockPwdHash: broken,
    })
    expect(bodyOf(badRes).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DECRYPT_FAILED)
    expect(await readLockRow()).toBeNull()

    // 明文（未启用信封的客户端）照旧可用 —— 灰度兼容
    await setPreference({ lockMode: 'security', lockPwdHash: 'pin-plain-12' })
    expect(await compare('pin-plain-12', (await readLockRow())!.lock_pwd_hash!)).toBe(true)
  })

  // ---------------------------------------------------------------- 三模式解锁

  it('default 模式：无密码解锁成功（计入「三种模式」的免密腿）', async () => {
    await lock()
    const res = await api.root('PATCH', api.apiPath(UNLOCK), {})
    expectOk(res, 'default unlock')
    expect(bodyOf<boolean>(res).data).toBe(true)
    expect((await deviceRows()).every((d) => d.locked === false)).toBe(true)
  })

  it('idle 模式：无密码解锁成功（idle 计时纯客户端，服务端只认 security 的密码要求）', async () => {
    await setPreference({ lockMode: 'idle', lockIdleSec: 60, lockCrossDevice: false })
    await lock()

    const res = await api.root('PATCH', api.apiPath(UNLOCK), {})
    expectOk(res, 'idle unlock')
    expect(bodyOf<boolean>(res).data).toBe(true)
  })

  // ---------------------------------------------------------------- Q7 计次退避

  it('security 模式：错密码计次 → 第 5 次封 30s → 退避期连对密码也拒 → 到期后成功并清零', async () => {
    await setPreference({
      lockMode: 'security',
      lockPwdHash: 'pin-correct-1',
      lockCrossDevice: true,
    })
    await lock()

    // 前 4 次：只计次不封（meta.failCount 1..4，无 retryAfterSec）
    for (let attempt = 1; attempt <= 4; attempt++) {
      const res = await api.root('PATCH', api.apiPath(UNLOCK), { lockPwdHash: 'pin-wrong-xx' })
      const body = bodyOf<null>(res)
      expect(body.code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)
      expect(body.meta?.failCount).toBe(attempt)
      expect(body.meta?.retryAfterSec).toBeUndefined()
      expect((await readLockRow())!.lock_pwd_fail_count).toBe(attempt)
      expect((await readLockRow())!.lock_pwd_locked_until).toBeNull()
    }

    // 第 5 次：进入退避 30s（曲线真源：lock-pwd-backoff.ts）
    const fifth = await api.root('PATCH', api.apiPath(UNLOCK), { lockPwdHash: 'pin-wrong-xx' })
    const fifthBody = bodyOf<null>(fifth)
    expect(fifthBody.code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)
    expect(fifthBody.meta?.failCount).toBe(5)
    expect(fifthBody.meta?.retryAfterSec).toBeGreaterThan(0)
    expect(fifthBody.meta?.retryAfterSec).toBeLessThanOrEqual(30)

    const afterFifth = await readLockRow()
    expect(afterFifth!.lock_pwd_fail_count).toBe(5)
    expect(afterFifth!.lock_pwd_locked_until).not.toBeNull()
    expect(new Date(afterFifth!.lock_pwd_locked_until!).getTime()).toBeGreaterThan(Date.now())

    // 退避期：正确的锁屏密码也被拒（与密码对错无关），设备仍锁
    const duringBackoff = await api.root('PATCH', api.apiPath(UNLOCK), {
      lockPwdHash: 'pin-correct-1',
    })
    const backoffBody = bodyOf<null>(duringBackoff)
    expect(backoffBody.code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)
    expect(backoffBody.meta?.retryAfterSec).toBeGreaterThan(0)
    expect((await deviceRows()).some((d) => d.locked)).toBe(true)
    // 退避期被拒不增加计数（否则轮询会把用户永久锁死）
    expect((await readLockRow())!.lock_pwd_fail_count).toBe(5)

    // 把退避截止推到过去（等价于窗口到期），正确密码解锁成功且清零
    await api.pgDataSource.query(
      "UPDATE sys_user_lock SET lock_pwd_locked_until = now() - interval '2 seconds' WHERE user_id = $1",
      [userId()],
    )

    const ok = await api.root('PATCH', api.apiPath(UNLOCK), { lockPwdHash: 'pin-correct-1' })
    expectOk(ok, 'unlock after backoff window')
    expect(bodyOf<boolean>(ok).data).toBe(true)

    const cleared = await readLockRow()
    expect(cleared!.lock_pwd_fail_count).toBe(0)
    expect(cleared!.lock_pwd_locked_until).toBeNull()
    expect((await deviceRows()).every((d) => d.locked === false)).toBe(true)
  })

  it('Q7：非 security 模式错密码不计数（计次只覆盖 security 密码腿与 fallback）', async () => {
    await setPreference({ lockMode: 'idle', lockIdleSec: 60, lockCrossDevice: true })
    await lock()

    const res = await api.root('PATCH', api.apiPath(UNLOCK), { lockPwdHash: 'pin-wrong-xx' })
    expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)

    const row = await readLockRow()
    expect(row!.lock_pwd_fail_count).toBe(0)
    expect(row!.lock_pwd_locked_until).toBeNull()
  })

  // ---------------------------------------------------------------- 四缺陷回归（server 部分）

  it('D1 回归：跨设备→单设备切换后不再 fail-open（缓存对侧键清理 + 偏好变更清缓存）', async () => {
    // 1) 跨设备锁/解一轮 ⇒ 全局键被写成 false（旧实现会在这里留下 fail-open 的种子）
    await setPreference({ lockMode: 'default', lockCrossDevice: true })
    await lock()
    expectOk(await api.root('PATCH', api.apiPath(UNLOCK), {}), 'unlock cross-device')
    expect(
      await cache.get<boolean>(`${WalnutAdminConstAppCacheKeys.SECURITY_LOCK}:${userId()}:global`),
    ).toBe(false)

    // 2) 切成单设备（偏好变更后清缓存）再置锁
    await setPreference({ lockCrossDevice: false })
    await lock()

    // 3) 守卫读腿必须看到锁定；全局键不得残留旧 false
    expect(await lockCache.checkIsLocked(userId(), api.deviceId)).toBe(true)
    expect(
      await cache.get<boolean>(`${WalnutAdminConstAppCacheKeys.SECURITY_LOCK}:${userId()}:global`),
    ).toBeNull()

    // 4) 行为级探针：非 LockFree 端点 40118
    const probe = await api.root('GET', api.apiPath(PROBE))
    expect(bodyOf(probe).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_ACCOUNT_LOCKED)
  })

  it('D2 回归：lockPwdHash 空串不得清空哈希（security 仍可解）', async () => {
    await setPreference({ lockMode: 'security', lockPwdHash: 'pin-d2-keep', lockCrossDevice: true })
    const before = await readLockRow()

    const res = await api.root('PATCH', api.apiPath(PREFERENCE), {
      lockMode: 'security',
      lockPwdHash: '',
    })
    // DTO 的 IsNotEmpty 直接拒绝（40099）；即便绕过 DTO，service + repo 也把 '' 视为「不修改」
    expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)

    const after = await readLockRow()
    expect(after!.lock_pwd_hash).toBe(before!.lock_pwd_hash)
    expect(await compare('pin-d2-keep', after!.lock_pwd_hash!)).toBe(true)
    expect(after!.lock_pwd_fail_count).toBe(0)

    // 哈希没坏 ⇒ security 模式仍能解开
    await lock()
    expectOk(
      await api.root('PATCH', api.apiPath(UNLOCK), { lockPwdHash: 'pin-d2-keep' }),
      'unlock after empty-hash attempt',
    )
  })

  // ---------------------------------------------------------------- 方案① fallback

  it('方案①：登录口令 fallback 就地解锁（不签发 token），并留下单次重试授权', async () => {
    await setPreference({
      lockMode: 'security',
      lockPwdHash: 'pin-forgot-1',
      lockCrossDevice: true,
    })
    await lock()
    expect((await deviceRows()).some((d) => d.locked)).toBe(true)

    const finish = await runFallbackVerify(fixture!.password)
    expectOk(finish, 'lock verify finish')
    expect(bodyOf<boolean>(finish).data).toBe(true)

    // 跨设备：全部设备解锁；计数清零
    expect((await deviceRows()).every((d) => d.locked === false)).toBe(true)
    const row = await readLockRow()
    expect(row!.lock_pwd_fail_count).toBe(0)
    expect(row!.lock_pwd_locked_until).toBeNull()
    // 哈希不因 fallback 改变
    expect(await compare('pin-forgot-1', row!.lock_pwd_hash!)).toBe(true)

    // verify/finish 不签发 token：响应体只有 boolean，没有 accessToken/sessionKey
    expect(finish.body).not.toHaveProperty('accessToken')
    expect(bodyOf(finish).data).toBe(true)

    // 单次重试授权：verify 成功后再调 unlock（security 模式、无锁屏密码）仍放行一次
    expectOk(await api.root('PATCH', api.apiPath(UNLOCK), {}), 'unlock retry via transient auth')
    // 第二次就没有授权了 —— 回到 pwdRequired（单次消费，不是密码旁路）
    const retryAgain = await api.root('PATCH', api.apiPath(UNLOCK), {})
    expect(bodyOf(retryAgain).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)
  })

  it('方案①：登录口令验证失败 → 40103 + 计数（与锁屏密码共用预算）', async () => {
    await setPreference({
      lockMode: 'security',
      lockPwdHash: 'pin-forgot-1',
      lockCrossDevice: true,
    })
    await lock()

    // 先走一次 start 拿到 SERVER_STATE，再交畸形 finish ⇒ 服务端 40103 且计数 +1
    const { startLoginRequest } = opaque.client.startLogin({ password: fixture!.password })
    expectOk(
      await api.root('POST', api.apiPath(VERIFY_START), { start: startLoginRequest }),
      'verify start',
    )

    const bad = await api.root('POST', api.apiPath(VERIFY_FINISH), {
      finish: 'not-a-finish-request',
    })
    const badBody = bodyOf<null>(bad)
    expect(badBody.code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_INVALID_CREDENTIALS)
    expect(badBody.meta?.failCount).toBe(1)
    expect((await readLockRow())!.lock_pwd_fail_count).toBe(1)
    expect((await deviceRows()).some((d) => d.locked)).toBe(true)

    // 没有 start 的 finish（state 已被消费 / 过期）同样 40103，计数再 +1
    const noState = await api.root('POST', api.apiPath(VERIFY_FINISH), {
      finish: 'not-a-finish-request',
    })
    expect(bodyOf(noState).code).toBe(
      WalnutAdminConstAppResponseCode.UNAUTHORIZED_INVALID_CREDENTIALS,
    )
    expect(bodyOf(noState).meta?.failCount).toBe(2)
  })

  it('方案①：退避期内 verify/start 直接拒绝（不给 OPAQUE 计算）', async () => {
    await setPreference({
      lockMode: 'security',
      lockPwdHash: 'pin-forgot-1',
      lockCrossDevice: true,
    })
    await lock()
    await api.pgDataSource.query(
      "UPDATE sys_user_lock SET lock_pwd_fail_count = 5, lock_pwd_locked_until = now() + interval '30 seconds' WHERE user_id = $1",
      [userId()],
    )

    const { startLoginRequest } = opaque.client.startLogin({ password: fixture!.password })
    const res = await api.root('POST', api.apiPath(VERIFY_START), { start: startLoginRequest })
    const body = bodyOf<null>(res)
    expect(body.code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)
    expect(body.meta?.retryAfterSec).toBeGreaterThan(0)
  })

  // ---------------------------------------------------------------- 方案② 登录即解锁

  it('方案②（跨设备）：完整登录成功 ⇒ 全部设备解锁 + 计数清零', async () => {
    await setPreference({ lockMode: 'security', lockPwdHash: 'pin-login-1', lockCrossDevice: true })
    await lock()
    await api.pgDataSource.query(
      'UPDATE sys_user_lock SET lock_pwd_fail_count = 3 WHERE user_id = $1',
      [userId()],
    )

    // B 设备真实登录（新 deviceId ⇒ 不触发 DuplicateSignIn）
    const { client: clientB } = await createLoggedInClient()

    const rows = await deviceRows()
    expect(rows.every((d) => d.locked === false)).toBe(true)
    expect(rows.some((d) => d.device_id === clientB.deviceId)).toBe(true)

    const row = await readLockRow()
    expect(row!.lock_pwd_fail_count).toBe(0)
    expect(row!.lock_pwd_locked_until).toBeNull()

    // A 设备读腿也回到未锁
    expectOk(
      await api.root('GET', api.apiPath('/system/user/lock/read')),
      'read after login unlock',
    )
    expect(
      bodyOf<LockStatus>(await api.root('GET', api.apiPath('/system/user/lock/read'))).data.locked,
    ).toBe(false)
  })

  it('方案②（单设备）：从另一台设备登录不解开被锁的那台（各设备独立）', async () => {
    await setPreference({
      lockMode: 'security',
      lockPwdHash: 'pin-login-2',
      lockCrossDevice: false,
    })
    await lock()

    const { client: clientB } = await createLoggedInClient()

    const rows = await deviceRows()
    const rowA = rows.find((d) => d.device_id === api.deviceId)
    const rowB = rows.find((d) => d.device_id === clientB.deviceId)
    expect(rowA!.locked).toBe(true)
    expect(rowB!.locked).toBe(false)

    // 计数仍然清零（登录是身份证明）
    expect((await readLockRow())!.lock_pwd_fail_count).toBe(0)
  })

  // ---------------------------------------------------------------- Q6 管理员重置

  it('Q6：管理员重置只解锁 + 清计次，不读不碰 hash；写审计日志', async () => {
    // 目标 = 另一个用户：重置端点刻意**非 LockFree**（管理员自己被锁时不能用它给自己开后门），
    // 所以调用方（root）不能同时是被锁的人。
    const targetApi = await WalnutApiClient.create(app)
    const targetFixture = await registerRootUserFixture(
      app,
      targetApi.pgDataSource,
      `ulkp-target-${seed8}`,
    )
    const targetTokens = await performHttpOpaqueLogin(targetApi, app, targetFixture)
    targetApi.setAuth(targetTokens)
    await targetApi.seedMfaVerifiedCache(targetFixture.userId)

    const targetRow = async () => {
      const rows: LockRow[] = await api.pgDataSource.query(
        'SELECT lock_pwd_hash, lock_pwd_fail_count, lock_pwd_locked_until, lock_pwd_updated_at FROM sys_user_lock WHERE user_id = $1',
        [targetFixture.userId],
      )
      return rows[0] ?? null
    }
    const targetDevices = async (): Promise<Array<{ device_id: string; locked: boolean }>> => {
      return api.pgDataSource.query(
        'SELECT device_id, locked FROM sys_user_device WHERE user_id = $1',
        [targetFixture.userId],
      )
    }

    try {
      expectOk(
        await targetApi.root('PATCH', targetApi.apiPath(PREFERENCE), {
          lockMode: 'security',
          lockPwdHash: 'pin-admin-reset',
          lockCrossDevice: true,
        }),
        'target preference',
      )
      expectOk(
        await targetApi.root('PATCH', targetApi.apiPath(LOCK), { lockRoute: { name: 'target' } }),
        'target lock',
      )
      await targetApi.root('PATCH', targetApi.apiPath(UNLOCK), { lockPwdHash: 'pin-wrong-xx' })

      const hashBefore = (await targetRow()).lock_pwd_hash
      expect((await targetRow()).lock_pwd_fail_count).toBe(1)

      const res = await api.root('PUT', api.apiPath(`${RESET}/${targetFixture.userId}`))
      expectOk(res, 'admin reset')
      expect(bodyOf<boolean>(res).data).toBe(true)

      const rows: Array<{ device_id: string; locked: boolean }> = await targetDevices()
      expect(rows.length).toBeGreaterThan(0)
      expect(rows.every((d) => d.locked === false)).toBe(true)

      const row = await targetRow()
      expect(row.lock_pwd_fail_count).toBe(0)
      expect(row.lock_pwd_locked_until).toBeNull()
      // hash 原样保留（管理员既不能读也不能改）
      expect(row.lock_pwd_hash).toBe(hashBefore)

      // 缓存同步清掉（守卫回源 DB，不会读到旧的 true）
      expect(await lockCache.checkIsLocked(targetFixture.userId, targetApi.deviceId)).toBeNull()

      // 审计：拦截器 fire-and-forget 落库，轮询等待
      const deadline = Date.now() + 8000
      let found = 0
      while (Date.now() < deadline) {
        const logs: Array<{ operation: string; title: string; success: boolean }> =
          await api.pgDataSource.query(
            `SELECT operation, title, success
             FROM sys_log_operate
            WHERE invoking_method = 'SysUserLockController.resetUserLock'
            ORDER BY operated_at DESC
            LIMIT 5`,
          )
        found = logs.length
        if (found > 0) {
          expect(logs[0].operation).toBe('user.lock.reset')
          expect(logs[0].success).toBe(true)
          break
        }
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      expect(found).toBeGreaterThan(0)
    } finally {
      await api.pgDataSource.query('DELETE FROM sys_user WHERE id = $1', [targetFixture.userId])
      await api.pgDataSource.query('DELETE FROM sys_role WHERE id = $1', [targetFixture.roleId])
      await api.pgDataSource.query('DELETE FROM sys_device WHERE device_id = $1', [
        targetApi.deviceId,
      ])
      await api.cleanupWalnutCacheKeys(targetApi.deviceId, targetFixture.userId)
    }
  })

  it('Q6：非 root 且未授予 system:user:lock:reset → 40105', async () => {
    // 非 root 用户（空授权集，但先拉一次 /auth/permissions 让缓存真实存在）
    permissionFixture = await seedPermissionChainUser(app, api.pgDataSource, {
      userNamePrefix: `ulkp-perm-${seed8}`,
      grantedPermissions: [],
      deniedPermissions: [],
    })
    permissionClient = await WalnutApiClient.create(app)
    const tokens = await performHttpOpaqueLogin(permissionClient, app, permissionFixture)
    permissionClient.setAuth(tokens)
    await permissionClient.seedMfaVerifiedCache(permissionFixture.userId)

    expectOk(
      await permissionClient.root('GET', permissionClient.apiPath('/auth/permissions')),
      'permissions warmup',
    )

    const res = await permissionClient.root('PUT', permissionClient.apiPath(`${RESET}/${userId()}`))
    expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_NO_PERMISSION)
  })
})
