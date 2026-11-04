import type { EntityManager } from 'typeorm'
import * as opaque from '@serenity-kit/opaque'
import { WalnutAdminExceptionInvalidCredential } from '@walnut-server/exceptions/business/auth'
import { beforeAll, describe, expect, it, vi } from 'vitest'
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

beforeAll(async () => {
  await opaque.ready

  serverSetup = opaque.server.createSetup()

  // 造一份**真实**的 registration record（等价于用户当年注册时落库的那一条）
  const { clientRegistrationState, registrationRequest } = opaque.client.startRegistration({ password: PASSWORD })
  const { registrationResponse } = opaque.server.createRegistrationResponse({
    serverSetup,
    userIdentifier: USER_NAME,
    registrationRequest,
  })
  registrationRecord = opaque.client.finishRegistration({
    clientRegistrationState,
    registrationResponse,
    password: PASSWORD,
    identifiers: { client: USER_NAME, server: APP_NAME },
  }).registrationRecord
})

const EM = { marker: 'entity-manager' } as unknown as EntityManager

interface IServiceOptions {
  user: { id: string, userName: string } | null
  identity: string | null
}

function createService(options: IServiceOptions) {
  const findUserByUserName = vi.fn(async () => options.user)
  const getValueByUserIdTypeAndPurpose = vi.fn(async (userId: string) => {
    if (options.user !== null && userId === options.user.id) {
      return options.identity
    }

    return null
  })
  const setOpaqueServerStateCache = vi.fn(async () => undefined)

  const configService = {
    get: (key: string) =>
      key === 'jwt.opaque.secret' ? serverSetup : key === 'app.name' ? APP_NAME : undefined,
  }

  const service = new AuthOpaqueCoreService(
    { setOpaqueServerStateCache } as never,
    configService as never,
    {} as never,
    { findUserByUserName } as never,
    { getValueByUserIdTypeAndPurpose } as never,
  )

  return { service, findUserByUserName, getValueByUserIdTypeAndPurpose, setOpaqueServerStateCache }
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
