import type { EntityManager } from 'typeorm'
import { Buffer } from 'node:buffer'
import { Logger } from '@nestjs/common'
import * as opaque from '@serenity-kit/opaque'
import { WalnutAdminExceptionInvalidCredential } from '@walnut-server/exceptions/business/auth'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthOpaqueCoreService } from '../opaque.core.service'

/**
 * F-45（用户枚举时序侧信道）：`startLogin` 旧实现在「用户不存在」/「用户存在但没口令凭据」
 * 时提前 throw —— 两条路径差着一次 OPAQUE 计算（~2-3ms）与一次 Redis 写，攻击者打几次
 * 取中位数即可判定账号是否存在。
 *
 * 本文件不测墙钟时间（CI 抖动会让时间断言变成假红/假绿），而是钉**结构性等价**：
 * 1) 两条路径的 DB 读次数相同（user 1 次 + identity 1 次，不存在的用户查 nil uuid）；
 * 2) 两条路径的 Redis 写次数相同（各 1 次 SERVER_STATE），且假路径写进去的 state 非空
 *    —— 证明它真的跑完了 OPAQUE 计算（null registrationRecord ⇒ 库内 fake record），
 *    而不是写了个占位符空转；
 * 3) 失败路径统一 40103（同一异常类），不泄露「存在但无口令」这一子状态；
 * 4) 成功路径的行为不变（返回 loginResponse 字符串）。
 */

const APP_NAME = 'spec-app'
const PASSWORD = 'spec-password-for-opaque'
const USER_NAME = 'alice'
const USER_ID = '11111111-1111-4111-8111-111111111111'
const NIL_USER_ID = '00000000-0000-0000-0000-000000000000'
const DEVICE_ID = 'spec-device'

let serverSetup = ''
let registrationRecord = ''

/** 方案 a 的 warn 日志断言面（Nest Logger 是实例方法，按原型 spy 能抓到服务里的那一个） */
const warnSpy = vi.spyOn(Logger.prototype, 'warn')

/** 造一份**真实**的 registration record（等价于用户注册时落库的那一条） */
function createRegistrationRecord(password: string) {
  const { clientRegistrationState, registrationRequest } = opaque.client.startRegistration({ password })
  const { registrationResponse } = opaque.server.createRegistrationResponse({
    serverSetup,
    userIdentifier: USER_NAME,
    registrationRequest,
  })
  return opaque.client.finishRegistration({
    clientRegistrationState,
    registrationResponse,
    password,
    identifiers: { client: USER_NAME, server: APP_NAME },
  }).registrationRecord
}

beforeAll(async () => {
  await opaque.ready

  serverSetup = opaque.server.createSetup()
  registrationRecord = createRegistrationRecord(PASSWORD)
})

beforeEach(() => {
  warnSpy.mockClear()
})

const EM = { marker: 'entity-manager' } as unknown as EntityManager

interface IServiceOptions {
  user: { id: string, userName: string } | null
  identity: string | null
  /** ConfigService 可见的 NODE_ENV（方案 a：meta hint 只在 development / stage 出现） */
  nodeEnv?: string
}

/**
 * ① 的 shared service 替身：record → `enc:<base64>` → record。
 *
 * 用可逆标记而不是真 AES：本文件测的是 auth 侧的**调用口径**（落库前加密 / 读回必解密），
 * AES-GCM 本身由 `crypto.service.spec.ts` 与 identity 侧负责。`decryptValue` 对非密文
 * （= ① 之前的旧明文行）直接抛 —— 与真实实现一致，用来钉「旧明文行 ⇒ 40103」。
 *
 * 三个函数同时给「vi 断言用的 spy」与「直接算值用的纯函数」两副面孔：seed 假库时用纯函数，
 * 免得把 spy 的调用次数提前打脏（断言 `toHaveBeenCalledExactlyOnceWith` 会假红）。
 */
function encryptStub(value: string) {
  return `enc:${Buffer.from(value, 'utf8').toString('base64')}`
}

function hashStub(value: string) {
  return `hash:${value}`
}

function identityCryptoStub() {
  return {
    encryptValue: vi.fn(encryptStub),
    decryptValue: vi.fn((value: string) => {
      if (!value.startsWith('enc:')) {
        throw new Error('Invalid encrypted data: missing ① envelope')
      }
      return Buffer.from(value.slice(4), 'base64').toString('utf8')
    }),
    generateValueHash: vi.fn(hashStub),
  }
}

interface IIdentityRow {
  userId: string
  type: string
  purpose: string
  value: string
  valueHash: string
  maskedValue: string
  verified: boolean
  verifiedAt: Date
  metadata: Record<string, unknown>
}

const rowKey = (userId: string, type: string, purpose: string) => `${userId}:${type}:${purpose}`

function createService(options: IServiceOptions) {
  const identityCrypto = identityCryptoStub()
  const findUserByUserName = vi.fn(async () => options.user)
  // 假库：(user_id, type, purpose) 唯一 —— upsert 命中即覆盖、未命中建行，读腿等价
  const rows = new Map<string, IIdentityRow>()
  if (options.user !== null && options.identity !== null) {
    rows.set(rowKey(options.user.id, 'password', 'login'), {
      userId: options.user.id,
      type: 'password',
      purpose: 'login',
      value: encryptStub(options.identity),
      valueHash: hashStub(options.identity),
      maskedValue: '********',
      verified: true,
      verifiedAt: new Date(),
      metadata: {},
    })
  }
  // 读腿返回**密文**（① 之后库里的真实形态）
  const getValueByUserIdTypeAndPurpose = vi.fn(async (userId: string, type: string, purpose: string) => {
    return rows.get(rowKey(userId, type, purpose))?.value ?? null
  })
  const upsertIdentity = vi.fn(async (payload: IIdentityRow) => {
    const key = rowKey(payload.userId, payload.type, payload.purpose)
    const next = { ...rows.get(key), ...payload }
    rows.set(key, next)
    return next
  })
  const setOpaqueServerStateCache = vi.fn(async () => undefined)

  const configService = {
    get: (key: string) =>
      key === 'jwt.opaque.secret'
        ? serverSetup
        : key === 'app.name'
          ? APP_NAME
          : key === 'NODE_ENV'
            ? (options.nodeEnv ?? 'production')
            : undefined,
  }

  const service = new AuthOpaqueCoreService(
    { setOpaqueServerStateCache } as never,
    configService as never,
    {} as never,
    { findUserByUserName } as never,
    { getValueByUserIdTypeAndPurpose, upsertIdentity } as never,
    identityCrypto as never,
  )

  return {
    service,
    findUserByUserName,
    getValueByUserIdTypeAndPurpose,
    upsertIdentity,
    setOpaqueServerStateCache,
    identityCrypto,
    /** 假库直读（断言「建行 / 替换」用；userId 固定 password/login 行） */
    getIdentityRow: (userId = USER_ID) => rows.get(rowKey(userId, 'password', 'login')) ?? null,
  }
}

function startLoginRequest() {
  return opaque.client.startLogin({ password: PASSWORD }).startLoginRequest
}

describe('opaque.core.startLogin：用户枚举等时化（F-45）', () => {
  it('存在的用户：返回 loginResponse，identity 按真实 userId 读一次，Redis 写一次', async () => {
    const { service, findUserByUserName, getValueByUserIdTypeAndPurpose, setOpaqueServerStateCache } = createService({
      user: { id: USER_ID, userName: USER_NAME },
      identity: registrationRecord,
    })

    const response = await service.startLogin(USER_NAME, startLoginRequest(), DEVICE_ID, EM)

    expect(typeof response).toBe('string')
    expect(response.length).toBeGreaterThan(0)
    expect(findUserByUserName).toHaveBeenCalledExactlyOnceWith(USER_NAME, EM)
    expect(getValueByUserIdTypeAndPurpose).toHaveBeenCalledExactlyOnceWith(USER_ID, 'password', 'login', EM)
    expect(setOpaqueServerStateCache).toHaveBeenCalledOnce()
  })

  it('不存在的用户：DB 读次数与 Redis 写次数与存在路径**相同**，随后统一 40103', async () => {
    const { service, findUserByUserName, getValueByUserIdTypeAndPurpose, setOpaqueServerStateCache } = createService({
      user: null,
      identity: null,
    })

    await expect(service.startLogin(USER_NAME, startLoginRequest(), DEVICE_ID, EM))
      .rejects
      .toBeInstanceOf(WalnutAdminExceptionInvalidCredential)

    // 等量 DB 读：user 1 次 + identity 1 次（假读腿查 nil uuid）
    expect(findUserByUserName).toHaveBeenCalledExactlyOnceWith(USER_NAME, EM)
    expect(getValueByUserIdTypeAndPurpose).toHaveBeenCalledExactlyOnceWith(NIL_USER_ID, 'password', 'login', EM)

    // 等量 Redis 写：假路径**也**写了一次 SERVER_STATE，且写的是真计算出来的 state
    expect(setOpaqueServerStateCache).toHaveBeenCalledOnce()
    const [writtenUserName, writtenDeviceId, writtenState] = setOpaqueServerStateCache.mock.calls[0] as unknown as [string, string, string]
    expect(writtenUserName).toBe(USER_NAME)
    expect(writtenDeviceId).toBe(DEVICE_ID)
    expect(typeof writtenState).toBe('string')
    expect(writtenState.length).toBeGreaterThan(0)
  })

  it('存在用户但无口令凭据：同样跑完假计算 + 一次 Redis 写，再抛 40103（不泄露子状态）', async () => {
    const { service, setOpaqueServerStateCache, getValueByUserIdTypeAndPurpose } = createService({
      user: { id: USER_ID, userName: USER_NAME },
      identity: null,
    })

    await expect(service.startLogin(USER_NAME, startLoginRequest(), DEVICE_ID, EM))
      .rejects
      .toBeInstanceOf(WalnutAdminExceptionInvalidCredential)

    expect(getValueByUserIdTypeAndPurpose).toHaveBeenCalledExactlyOnceWith(USER_ID, 'password', 'login', EM)
    expect(setOpaqueServerStateCache).toHaveBeenCalledOnce()
  })

  it('三种入口的 Redis 写次数恒为 1（结构等价的直接断言）', async () => {
    const scenarios = [
      { user: { id: USER_ID, userName: USER_NAME }, identity: registrationRecord, throws: false },
      { user: null, identity: null, throws: true },
      { user: { id: USER_ID, userName: USER_NAME }, identity: null, throws: true },
    ] as const

    for (const scenario of scenarios) {
      const { service, setOpaqueServerStateCache } = createService({ user: scenario.user, identity: scenario.identity })

      if (scenario.throws) {
        await expect(service.startLogin(USER_NAME, startLoginRequest(), DEVICE_ID, EM)).rejects.toBeInstanceOf(
          WalnutAdminExceptionInvalidCredential,
        )
      }
      else {
        await expect(service.startLogin(USER_NAME, startLoginRequest(), DEVICE_ID, EM)).resolves.toEqual(expect.any(String))
      }

      expect(setOpaqueServerStateCache).toHaveBeenCalledTimes(1)
    }
  })

  it('startLoginRequest 是垃圾（客户端没按协议发）：仍然只抛 40103，不会把库错误冒出去', async () => {
    const { service, setOpaqueServerStateCache } = createService({ user: null, identity: null })

    await expect(service.startLogin(USER_NAME, 'not-a-valid-start-login-request', DEVICE_ID, EM))
      .rejects
      .toBeInstanceOf(WalnutAdminExceptionInvalidCredential)

    // 计算阶段就炸了 ⇒ 没有写缓存（与「存在用户 + 坏请求」的失败形态一致）
    expect(setOpaqueServerStateCache).not.toHaveBeenCalled()
  })
})

/**
 * ①（2026-11）：password 身份的落库形态与读回路径。
 *
 * 判据：
 * 1) 写：value 是 `encryptValue(record)`、valueHash 是 `generateValueHash(record)` ——
 *    **不再**是裸 record；
 * 2) 读：`startLogin` 先 decrypt 再交给 opaque（stub 能算通 OPAQUE ⇒ 喂进去的是原文，
 *    否则 server.startLogin 会因 registration record 非法而抛 40103）；
 * 3) 旧明文行（① 之前本地库的残留）：解密失败收敛为 40103，不把 crypto 错误冒出去。
 */
describe('opaque.core：password 身份加密落库与读回（①）', () => {
  it('finishRegister：value/valueHash 分别过 encryptValue / generateValueHash，maskedValue 仍是 ********', async () => {
    const { service, upsertIdentity, identityCrypto } = createService({ user: { id: USER_ID, userName: USER_NAME }, identity: null })

    await expect(service.finishRegister(USER_ID, registrationRecord, EM)).resolves.toBe(true)

    expect(identityCrypto.encryptValue).toHaveBeenCalledExactlyOnceWith(registrationRecord)
    expect(identityCrypto.generateValueHash).toHaveBeenCalledExactlyOnceWith(registrationRecord)
    expect(upsertIdentity).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        userId: USER_ID,
        type: 'password',
        purpose: 'login',
        value: `enc:${Buffer.from(registrationRecord, 'utf8').toString('base64')}`,
        valueHash: `hash:${registrationRecord}`,
        maskedValue: '********',
        verified: true,
      }),
      EM,
    )

    // 负对照锚点：落库的 value **不等于**明文 record（① 之前的形态）
    const payload = (upsertIdentity.mock.calls[0] as unknown as [{ value: string }])[0]
    expect(payload.value).not.toBe(registrationRecord)
  })

  it('finishChangePassword：已有口令用户 ⇒ upsert 替换原行（不新增第二行），加密 + 盐化哈希同 finishRegister', async () => {
    const oldRecord = createRegistrationRecord('spec-old-password')
    const newRecord = createRegistrationRecord('spec-new-password')
    const { service, upsertIdentity, identityCrypto, getIdentityRow } = createService({
      user: { id: USER_ID, userName: USER_NAME },
      identity: oldRecord,
    })

    await expect(service.finishChangePassword(USER_NAME, newRecord, EM)).resolves.toBe(true)

    expect(identityCrypto.encryptValue).toHaveBeenCalledExactlyOnceWith(newRecord)
    expect(identityCrypto.generateValueHash).toHaveBeenCalledExactlyOnceWith(newRecord)
    expect(upsertIdentity).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        userId: USER_ID,
        type: 'password',
        purpose: 'login',
        value: encryptStub(newRecord),
        valueHash: hashStub(newRecord),
        maskedValue: '********',
        verified: true,
        metadata: {},
      }),
      EM,
    )

    // 假库判据：仍是同一行（替换，不是又建一行），且值换成新 record 的密文/哈希
    const row = getIdentityRow()
    expect(row).not.toBeNull()
    expect(row!.value).toBe(encryptStub(newRecord))
    expect(row!.valueHash).toBe(hashStub(newRecord))
    expect(row!.value).not.toBe(encryptStub(oldRecord))
    expect(identityCrypto.decryptValue(row!.value)).toBe(newRecord)
  })

  it('finishChangePassword：无口令用户（管理端设初始口令）⇒ upsert 建 identity 行并返回 true（修复静默 no-op）', async () => {
    const record = createRegistrationRecord('spec-initial-password')
    const { service, upsertIdentity, identityCrypto, getIdentityRow } = createService({
      user: { id: USER_ID, userName: USER_NAME },
      identity: null,
    })

    // 前置：该用户没有 password identity 行（旧实现 update 未命中仍返回 true = 静默 no-op）
    expect(getIdentityRow()).toBeNull()

    await expect(service.finishChangePassword(USER_NAME, record, EM)).resolves.toBe(true)

    expect(upsertIdentity).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        userId: USER_ID,
        type: 'password',
        purpose: 'login',
        value: encryptStub(record),
        valueHash: hashStub(record),
        maskedValue: '********',
        verified: true,
        metadata: {},
      }),
      EM,
    )

    const row = getIdentityRow()
    expect(row).not.toBeNull()
    expect(row!.value).toBe(encryptStub(record))
    expect(row!.valueHash).toBe(hashStub(record))
    expect(identityCrypto.decryptValue(row!.value)).toBe(record)
    expect(row!.verified).toBe(true)
    expect(row!.verifiedAt).toBeInstanceOf(Date)
  })

  it('startLogin 读回密文并解密：OPAQUE 握手能跑通（喂进 opaque 的必须是原文）', async () => {
    const { service, identityCrypto } = createService({ user: { id: USER_ID, userName: USER_NAME }, identity: registrationRecord })

    await expect(service.startLogin(USER_NAME, startLoginRequest(), DEVICE_ID, EM)).resolves.toEqual(expect.any(String))
    expect(identityCrypto.decryptValue).toHaveBeenCalledOnce()
  })

  it('旧明文行（无存量迁移的本地库）：解密失败 ⇒ 统一 40103，不泄露 crypto 错误', async () => {
    const { service, getValueByUserIdTypeAndPurpose, setOpaqueServerStateCache } = createService({
      user: { id: USER_ID, userName: USER_NAME },
      identity: registrationRecord,
    })
    // 把读腿换回 ① 之前的明文形态
    getValueByUserIdTypeAndPurpose.mockResolvedValueOnce(registrationRecord)

    await expect(service.startLogin(USER_NAME, startLoginRequest(), DEVICE_ID, EM))
      .rejects
      .toBeInstanceOf(WalnutAdminExceptionInvalidCredential)
    // 方案 a：解密失败也走完 fake 等量计算 + 一次 SERVER_STATE 写（F-45 的结构等价）
    expect(setOpaqueServerStateCache).toHaveBeenCalledOnce()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('reason: credential-format-stale'))
  })
})

/**
 * 方案 a（2026-11-27）：凭证静默变砖的**可诊断化**。
 *
 * 三条硬约束：
 * 1) 日志分类可执行（reason 分类 + userName + 修复命令）；
 * 2) `meta.hint` 只在 development / stage 出现，production 响应零变化；
 * 3) 等时性不退化 —— 解密失败路径同样跑完 OPAQUE 计算并写一次 SERVER_STATE。
 */
describe('opaque.core.startLogin：凭证陈旧的可诊断化（方案 a）', () => {
  /** 断言异常响应壳里的 meta（Nest HttpException 的 getResponse） */
  function metaOf(error: unknown): Record<string, string> | undefined {
    return (error as { getResponse: () => { meta?: Record<string, string> } }).getResponse().meta
  }

  /** 造一个「value 是旧明文（非 enc: 信封）」的服务：读腿 mock 成 registrationRecord 原文 */
  function createStaleFormatService(nodeEnv: string) {
    const ctx = createService({ user: { id: USER_ID, userName: USER_NAME }, identity: registrationRecord, nodeEnv })
    ctx.getValueByUserIdTypeAndPurpose.mockResolvedValueOnce(registrationRecord)
    return ctx
  }

  it('解密失败（格式陈旧）：fake 计算 + 一次 SERVER_STATE 写，warn 带 reason/修复命令，dev 附 hint', async () => {
    const ctx = createStaleFormatService('development')

    const caught = await ctx.service.startLogin(USER_NAME, startLoginRequest(), DEVICE_ID, EM).catch((e: unknown) => e)

    expect(caught).toBeInstanceOf(WalnutAdminExceptionInvalidCredential)
    expect(ctx.setOpaqueServerStateCache).toHaveBeenCalledOnce()
    const meta = metaOf(caught)!
    expect(meta.reason).toBe('credential-format-stale')
    expect(meta.hint).toContain(`pnpm walnut db:seed:pg --admin ${USER_NAME}`)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('reason: credential-format-stale'))
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(`userName: ${USER_NAME}`))
  })

  it('解密失败：production 响应没有 meta（生产零变化），日志仍然给出修复命令', async () => {
    const ctx = createStaleFormatService('production')

    const caught = await ctx.service.startLogin(USER_NAME, startLoginRequest(), DEVICE_ID, EM).catch((e: unknown) => e)

    expect(caught).toBeInstanceOf(WalnutAdminExceptionInvalidCredential)
    expect(metaOf(caught)).toBeUndefined()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('credential-format-stale'))
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('db:seed:pg --admin alice'))
  })

  it('记录不存在（用户存在但没有 password 身份行）：fake 计算 + 一次写，reason=credential-missing', async () => {
    const ctx = createService({ user: { id: USER_ID, userName: USER_NAME }, identity: null, nodeEnv: 'development' })

    const caught = await ctx.service.startLogin(USER_NAME, startLoginRequest(), DEVICE_ID, EM).catch((e: unknown) => e)

    expect(caught).toBeInstanceOf(WalnutAdminExceptionInvalidCredential)
    expect(ctx.setOpaqueServerStateCache).toHaveBeenCalledOnce()
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('reason: credential-missing'))
    expect(metaOf(caught)).toMatchObject({ reason: 'credential-missing' })
  })

  it('用户不存在：不附 hint（开发环境也不把枚举面变成可行动信息）', async () => {
    const ctx = createService({ user: null, identity: null, nodeEnv: 'development' })

    const caught = await ctx.service.startLogin(USER_NAME, startLoginRequest(), DEVICE_ID, EM).catch((e: unknown) => e)

    expect(caught).toBeInstanceOf(WalnutAdminExceptionInvalidCredential)
    expect(ctx.setOpaqueServerStateCache).toHaveBeenCalledOnce()
    expect(metaOf(caught)).toBeUndefined()
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('value 能解开但 OPAQUE 不认记录（握手抛错）：reason=credential-opaque-incompatible，dev 附 hint', async () => {
    const ctx = createService({
      user: { id: USER_ID, userName: USER_NAME },
      // 能过 decrypt stub，但不是合法的 OPAQUE registration record ⇒ server.startLogin 抛
      identity: 'not-a-valid-opaque-record',
      nodeEnv: 'development',
    })

    const caught = await ctx.service.startLogin(USER_NAME, startLoginRequest(), DEVICE_ID, EM).catch((e: unknown) => e)

    expect(caught).toBeInstanceOf(WalnutAdminExceptionInvalidCredential)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('reason: credential-opaque-incompatible'))
    expect(metaOf(caught)).toMatchObject({ reason: 'credential-opaque-incompatible' })
  })

  // 「OPAQUE 握手返回 undefined」这一支在真实库里类型上不可达，必须 mock 整个包才能
  // 触发 —— 单独一份文件的 `vi.mock` 不会污染本文件其余的真实密码学用例。
  // 见 __tests__/opaque.core.service.handshake-undefined.spec.ts。

  it('格式陈旧 / 记录缺失与成功路径的 SERVER_STATE 写次数一致（各 1 次，F-45 结构断言）', async () => {
    const scenarios = [
      // 格式陈旧：读腿返回旧明文 ⇒ decrypt 抛，但仍走 fake 等量计算 + 写缓存
      { identity: registrationRecord, plaintext: true, throws: true },
      // 记录缺失：fake 等量计算 + 写缓存
      { identity: null, plaintext: false, throws: true },
      // 正常凭证：对照组
      { identity: registrationRecord, plaintext: false, throws: false },
    ]

    for (const scenario of scenarios) {
      const ctx = createService({ user: { id: USER_ID, userName: USER_NAME }, identity: scenario.identity, nodeEnv: 'development' })
      if (scenario.plaintext)
        ctx.getValueByUserIdTypeAndPurpose.mockResolvedValueOnce(registrationRecord)

      if (scenario.throws) {
        await expect(ctx.service.startLogin(USER_NAME, startLoginRequest(), DEVICE_ID, EM))
          .rejects
          .toBeInstanceOf(WalnutAdminExceptionInvalidCredential)
      }
      else {
        await expect(ctx.service.startLogin(USER_NAME, startLoginRequest(), DEVICE_ID, EM)).resolves.toEqual(expect.any(String))
      }

      expect(ctx.setOpaqueServerStateCache).toHaveBeenCalledTimes(1)
    }
  })
})
