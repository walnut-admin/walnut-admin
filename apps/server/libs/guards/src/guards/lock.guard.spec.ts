import type { ExecutionContext } from '@nestjs/common'
import { WalnutAdminConstCookieKeys } from '@walnut-server/const/app/cookie'
import { WalnutAdminExceptionUserLocked } from '@walnut-server/exceptions/business/auth'
import { describe, expect, it, vi } from 'vitest'
import { WalnutAdminGuardLock } from './lock.guard'

/**
 * Lock guard 的 deviceId 判空（review-guards P1 / per-guard-issues）。
 *
 * 修复前：`lock.guard.ts:57` 写的是 `if (deviceId === null)`。
 * `getWalnutAdminCookie` 在 cookie 缺失时返回 **undefined**（不是 null），
 * 签名错的畸形值返回 **false**（cookie-parser@1.4.7 index.js:150）——
 * ⇒ 该分支**永不命中**，undefined/false 会被继续拼进
 * `APP:MURLOCK:LOCK_GUARD:<userId>:<undefined>` 和锁缓存键，
 * 所有无设备凭据的请求共用一个退化键空间去查锁。
 *
 * 「旧写法会红」的判据：用例 1/2 断言 `checkIsLocked` 与 `runWithLock` **一次都没有被调用**。
 * 旧代码必调（带 undefined / false），这两条会立刻红。
 */

interface ILockMocks {
  checkIsLocked: ReturnType<typeof vi.fn>
  setDeviceLockCache: ReturnType<typeof vi.fn>
  getLockForGuard: ReturnType<typeof vi.fn>
  runWithLock: ReturnType<typeof vi.fn>
}

function createGuard(lockFree = false): { guard: WalnutAdminGuardLock, mocks: ILockMocks } {
  const mocks: ILockMocks = {
    checkIsLocked: vi.fn(async () => null),
    setDeviceLockCache: vi.fn(async () => undefined),
    getLockForGuard: vi.fn(async () => ({ isLocked: false, isCrossDevice: false })),
    runWithLock: vi.fn(async (_key: string, _ttl: number, fn: () => Promise<unknown>) => fn()),
  }

  const guard = new WalnutAdminGuardLock(
    { getAllAndOverride: () => lockFree } as never,
    { getLockForGuard: mocks.getLockForGuard } as never,
    { checkIsLocked: mocks.checkIsLocked, setDeviceLockCache: mocks.setDeviceLockCache } as never,
    { runWithLock: mocks.runWithLock } as never,
  )

  return { guard, mocks }
}

function createContext(options: { deviceId?: unknown, user?: unknown } = {}): ExecutionContext {
  const signedCookies: Record<string, unknown> = {}

  if ('deviceId' in options) {
    signedCookies[WalnutAdminConstCookieKeys.DEVICE_ID] = options.deviceId
  }

  const request = {
    signedCookies,
    user: 'user' in options ? options.user : { userId: 'user-1' },
  }

  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
    getHandler: () => function lockGuardSpecHandler() {},
    getClass: () => class LockGuardSpecController {},
  } as unknown as ExecutionContext
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(() => null, (error: unknown) => error)
}

describe('lock guard：deviceId 判空（isNil 语义，不再是 === null）', () => {
  it('cookie 缺失（undefined）⇒ 跳过锁定检查，且不拼退化缓存键（旧代码会带着 undefined 调进去）', async () => {
    const { guard, mocks } = createGuard()

    await expect(guard.canActivate(createContext())).resolves.toBe(true)

    // 旧写法 deviceId === null 恒 false ⇒ 这两处都会被调用（带 undefined）
    expect(mocks.checkIsLocked).not.toHaveBeenCalled()
    expect(mocks.runWithLock).not.toHaveBeenCalled()
  })

  it('畸形签名 cookie（cookie-parser 返回 false）⇒ 同样按「没有设备」跳过', async () => {
    const { guard, mocks } = createGuard()

    await expect(guard.canActivate(createContext({ deviceId: false }))).resolves.toBe(true)

    expect(mocks.checkIsLocked).not.toHaveBeenCalled()
    expect(mocks.runWithLock).not.toHaveBeenCalled()
  })

  it('空串 cookie ⇒ 按「没有设备」跳过', async () => {
    const { guard, mocks } = createGuard()

    await expect(guard.canActivate(createContext({ deviceId: '' }))).resolves.toBe(true)
    expect(mocks.checkIsLocked).not.toHaveBeenCalled()
  })

  it('有 deviceId 时正常查锁：缓存命中已锁 ⇒ 40114 UserLocked', async () => {
    const { guard, mocks } = createGuard()
    mocks.checkIsLocked.mockResolvedValue(true)

    const error = await caught(guard.canActivate(createContext({ deviceId: 'device-1' })))

    expect(error).toBeInstanceOf(WalnutAdminExceptionUserLocked)
    expect(mocks.checkIsLocked).toHaveBeenCalledWith('user-1', 'device-1')
  })

  it('缓存命中未锁 ⇒ 放行，且不回源 DB', async () => {
    const { guard, mocks } = createGuard()
    mocks.checkIsLocked.mockResolvedValue(false)

    await expect(guard.canActivate(createContext({ deviceId: 'device-1' }))).resolves.toBe(true)
    expect(mocks.getLockForGuard).not.toHaveBeenCalled()
  })

  it('缓存 miss ⇒ 锁内回源 DB，键里带真实 deviceId（不是 undefined）', async () => {
    const { guard, mocks } = createGuard()
    mocks.getLockForGuard.mockResolvedValue({ isLocked: true, isCrossDevice: true })

    const error = await caught(guard.canActivate(createContext({ deviceId: 'device-1' })))

    expect(error).toBeInstanceOf(WalnutAdminExceptionUserLocked)
    expect(mocks.getLockForGuard).toHaveBeenCalledWith('user-1', 'device-1')
    expect(mocks.setDeviceLockCache).toHaveBeenCalledWith('user-1', 'device-1', true, true)
    expect(mocks.runWithLock.mock.calls[0][0]).toContain('user-1:device-1')
    expect(mocks.runWithLock.mock.calls[0][0]).not.toContain('undefined')
  })

  it('lockFree 端点 / 无 user 仍然直接放行（既有语义不变）', async () => {
    const free = createGuard(true)
    await expect(free.guard.canActivate(createContext({ deviceId: 'device-1' }))).resolves.toBe(true)
    expect(free.mocks.checkIsLocked).not.toHaveBeenCalled()

    const noUser = createGuard()
    await expect(noUser.guard.canActivate(createContext({ user: undefined, deviceId: 'device-1' }))).resolves.toBe(true)
    expect(noUser.mocks.checkIsLocked).not.toHaveBeenCalled()
  })
})
