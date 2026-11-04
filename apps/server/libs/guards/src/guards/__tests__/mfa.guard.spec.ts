import type { ExecutionContext } from '@nestjs/common'
import { WalnutAdminConstCookieKeys } from '@walnut-server/const/app/cookie'
import { WalnutAdminConstRoleMode } from '@walnut-server/const/role'
import {
  WalnutAdminExceptionMfaRequired,
  WalnutAdminExceptionMfaVerifyFailed,
} from '@walnut-server/exceptions/business/auth'
import { Role } from '@walnut/contract'
import { describe, expect, it, vi } from 'vitest'
import { WalnutAdminGuardMFA } from '../mfa.guard'

/**
 * MFA guard 的短路顺序（`mfa.guard.ts` P1–P7）。判定顺序本身就是安全语义，
 * 所以每条用例除了断言出口，还断言**前序腿没跑**（缓存查询次数 / 抛出码）：
 *
 * | 输入 | 出口 | 依据 |
 * |------|------|------|
 * | `@WalnutAdminGuardMFAFree()`（类或方法） | 放行，不查设备缓存 | P1 |
 * | 无 `request.user`（JwtOptional 降级为匿名） | 放行 | P3 |
 * | `switchable` + `currentRoleName === visitor` | 放行 | P4 |
 * | `mfa_setup = false` | **40114**，即便 payload 说 mfaVerified | P5 先于 P6 |
 * | payload `mfaVerified = true` | 放行，**不查设备缓存** | P6 与缓存解耦 |
 * | 设备级 verified 缓存命中 | 放行 | P7 |
 * | 缓存 miss（含无 DEVICE_ID / 坏签名 false） | **40115** | P7 fail-closed |
 *
 * 反例（真正把分支钉住的那几条）：
 * - `combinable` 用户 roleNames 里有 visitor、但 currentRoleName=admin ⇒ **不**跳过（P4 的判据是
 *   「模式 + 当前角色」两个条件，不是「角色集合里出现过 visitor」）；
 * - mfa_setup=false + mfaVerified=true ⇒ 仍是 40114（P5 在 P6 之前，payload 信任位绕不过 setup 闸门）；
 * - 无 DEVICE_ID cookie ⇒ 缓存键退化成 `<userId>:undefined` 且必然 miss ⇒ 40115（缺设备不放行）。
 */

interface IMfaGuardMocks {
  getVerifiedCache: ReturnType<typeof vi.fn>
}

function createGuard(options: { mfaFree?: boolean } = {}): { guard: WalnutAdminGuardMFA, mocks: IMfaGuardMocks } {
  const mocks: IMfaGuardMocks = {
    getVerifiedCache: vi.fn(async () => null),
  }

  const reflector = {
    // 真实 Reflector 用 Symbol 键在 handler/class 上取元数据；这里只关心「装饰器在不在」
    getAllAndOverride: () => options.mfaFree ?? false,
  }

  const guard = new WalnutAdminGuardMFA(
    reflector as never,
    { getVerifiedCache: mocks.getVerifiedCache } as never,
  )

  return { guard, mocks }
}

function createContext(options: { user?: unknown, deviceId?: unknown } = {}): ExecutionContext {
  const signedCookies: Record<string, unknown> = {}

  if ('deviceId' in options) {
    signedCookies[WalnutAdminConstCookieKeys.DEVICE_ID] = options.deviceId
  }

  const request = {
    signedCookies,
    user: 'user' in options ? options.user : undefined,
  }

  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
    getHandler: () => function mfaGuardSpecHandler() {},
    getClass: () => class MfaGuardSpecController {},
  } as unknown as ExecutionContext
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(() => null, (error: unknown) => error)
}

/** 已登录、开了 MFA、payload 未标记验证过（登录时 isTrusted=false 的真实形态） */
const UNVERIFIED_USER = {
  userId: 'user-1',
  roleMode: WalnutAdminConstRoleMode.COMBINE,
  currentRoleName: Role.ADMIN,
  mfaSetup: true,
  mfaVerified: false,
}

/** 已登录的 switchable visitor —— P4 跳过的唯一合法形态 */
const VISITOR_USER = {
  userId: 'visitor-1',
  roleMode: WalnutAdminConstRoleMode.SWITCH,
  currentRoleName: Role.VISITOR,
  mfaSetup: true,
  mfaVerified: false,
}

describe('mfa guard：短路腿（MFAFree / 未登录 / visitor）', () => {
  it('装饰器 MFAFree ⇒ 放行，且一次缓存都不查（P1 先于一切）', async () => {
    const { guard, mocks } = createGuard({ mfaFree: true })

    await expect(guard.canActivate(createContext({ user: UNVERIFIED_USER, deviceId: 'device-1' }))).resolves.toBe(true)
    expect(mocks.getVerifiedCache).not.toHaveBeenCalled()
  })

  it('无 request.user（JwtOptional 降级为匿名）⇒ 放行，不查缓存（P3）', async () => {
    const { guard, mocks } = createGuard()

    await expect(guard.canActivate(createContext({ user: null, deviceId: 'device-1' }))).resolves.toBe(true)
    expect(mocks.getVerifiedCache).not.toHaveBeenCalled()
  })

  it('switchable + currentRoleName=visitor ⇒ 放行，且不查设备缓存（P4）', async () => {
    const { guard, mocks } = createGuard()

    await expect(guard.canActivate(createContext({ user: VISITOR_USER, deviceId: 'device-1' }))).resolves.toBe(true)
    expect(mocks.getVerifiedCache).not.toHaveBeenCalled()
  })

  it('反例：combinable 用户 roleNames 含 visitor、currentRoleName=admin ⇒ 不跳过，缓存 miss 仍 40115', async () => {
    const { guard, mocks } = createGuard()

    const error = await caught(guard.canActivate(createContext({
      user: { ...UNVERIFIED_USER, roleNames: [Role.ADMIN, Role.VISITOR] },
      deviceId: 'device-1',
    })))

    expect(error).toBeInstanceOf(WalnutAdminExceptionMfaVerifyFailed)
    expect(mocks.getVerifiedCache).toHaveBeenCalledTimes(1)
  })

  it('反例：switchable 但 currentRoleName=admin ⇒ 不跳过（P4 要两个条件同时成立）', async () => {
    const { guard, mocks } = createGuard()

    const error = await caught(guard.canActivate(createContext({
      user: { ...UNVERIFIED_USER, roleMode: WalnutAdminConstRoleMode.SWITCH, currentRoleName: Role.ADMIN },
      deviceId: 'device-1',
    })))

    expect(error).toBeInstanceOf(WalnutAdminExceptionMfaVerifyFailed)
    expect(mocks.getVerifiedCache).toHaveBeenCalledTimes(1)
  })
})

describe('mfa guard：mfa_setup 闸门（P5）先于 payload 信任位（P6）', () => {
  it('mfa_setup=false ⇒ 40114 MfaRequired，且不查设备缓存', async () => {
    const { guard, mocks } = createGuard()

    const error = await caught(guard.canActivate(createContext({
      user: { ...UNVERIFIED_USER, mfaSetup: false },
      deviceId: 'device-1',
    })))

    expect(error).toBeInstanceOf(WalnutAdminExceptionMfaRequired)
    expect(error).not.toBeInstanceOf(WalnutAdminExceptionMfaVerifyFailed)
    expect(mocks.getVerifiedCache).not.toHaveBeenCalled()
  })

  it('反例：mfa_setup=false + payload mfaVerified=true ⇒ 仍是 40114（信任位绕不过 setup 闸门）', async () => {
    const { guard, mocks } = createGuard()

    const error = await caught(guard.canActivate(createContext({
      user: { ...UNVERIFIED_USER, mfaSetup: false, mfaVerified: true },
      deviceId: 'device-1',
    })))

    expect(error).toBeInstanceOf(WalnutAdminExceptionMfaRequired)
    expect(mocks.getVerifiedCache).not.toHaveBeenCalled()
  })
})

describe('mfa guard：已 setup 后的两腿（payload 信任位 / 设备级 verified 缓存）', () => {
  it('payload mfaVerified=true ⇒ 放行，且与设备缓存解耦（不查缓存）', async () => {
    const { guard, mocks } = createGuard()
    mocks.getVerifiedCache.mockResolvedValue(null)

    await expect(guard.canActivate(createContext({
      user: { ...UNVERIFIED_USER, mfaVerified: true },
      deviceId: 'device-1',
    }))).resolves.toBe(true)

    expect(mocks.getVerifiedCache).not.toHaveBeenCalled()
  })

  it('缓存命中 ⇒ 放行，且按 (userId, deviceId) 精确查键', async () => {
    const { guard, mocks } = createGuard()
    mocks.getVerifiedCache.mockResolvedValue(true)

    await expect(guard.canActivate(createContext({ user: UNVERIFIED_USER, deviceId: 'device-A' }))).resolves.toBe(true)

    expect(mocks.getVerifiedCache).toHaveBeenCalledWith('user-1', 'device-A')
    expect(mocks.getVerifiedCache).toHaveBeenCalledTimes(1)
  })

  it('缓存 miss ⇒ 40115 MfaVerifyFailed（不是 40114：setup 已过，缺的是本次验证）', async () => {
    const { guard, mocks } = createGuard()

    const error = await caught(guard.canActivate(createContext({ user: UNVERIFIED_USER, deviceId: 'device-A' })))

    expect(error).toBeInstanceOf(WalnutAdminExceptionMfaVerifyFailed)
    expect(error).not.toBeInstanceOf(WalnutAdminExceptionMfaRequired)
    expect(mocks.getVerifiedCache).toHaveBeenCalledWith('user-1', 'device-A')
  })

  it('反例：另一台设备的可信值不算命中（键空间按 deviceId 隔离）', async () => {
    const { guard, mocks } = createGuard()
    // 真实缓存键是 AUTH:MFA:VERIFIED:<userId>:<deviceId>：A 有值、B 无值
    mocks.getVerifiedCache.mockResolvedValueOnce(true)
    mocks.getVerifiedCache.mockResolvedValueOnce(null)

    await expect(guard.canActivate(createContext({ user: UNVERIFIED_USER, deviceId: 'device-A' }))).resolves.toBe(true)

    const error = await caught(guard.canActivate(createContext({ user: UNVERIFIED_USER, deviceId: 'device-B' })))
    expect(error).toBeInstanceOf(WalnutAdminExceptionMfaVerifyFailed)

    // 守卫逐请求按当前设备查键，不会复用上一次的结果
    expect(mocks.getVerifiedCache).toHaveBeenNthCalledWith(1, 'user-1', 'device-A')
    expect(mocks.getVerifiedCache).toHaveBeenNthCalledWith(2, 'user-1', 'device-B')
  })
})

describe('mfa guard：设备凭据异常的边界（fail-closed）', () => {
  it('无 DEVICE_ID cookie ⇒ 缓存键退化但必然 miss ⇒ 40115（缺设备不放行）', async () => {
    const { guard, mocks } = createGuard()

    const error = await caught(guard.canActivate(createContext({ user: UNVERIFIED_USER })))

    expect(error).toBeInstanceOf(WalnutAdminExceptionMfaVerifyFailed)
    expect(mocks.getVerifiedCache).toHaveBeenCalledWith('user-1', undefined)
  })

  it('坏签名 cookie（cookie-parser 返回 false）⇒ 同样 miss ⇒ 40115，不会把 false 当成命中', async () => {
    const { guard, mocks } = createGuard()

    const error = await caught(guard.canActivate(createContext({ user: UNVERIFIED_USER, deviceId: false })))

    expect(error).toBeInstanceOf(WalnutAdminExceptionMfaVerifyFailed)
    expect(mocks.getVerifiedCache).toHaveBeenCalledWith('user-1', false)
  })
})
