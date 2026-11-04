import type { ExecutionContext } from '@nestjs/common'
import type { Reflector } from '@nestjs/core'
import type { AppTechCacheAppSettingsService } from '@walnut-server/cache'
import { WalnutAdminConstAppSettingKeys } from '@walnut-server/const/app/cache'
import { WalnutAdminConstDecoratorFunctionalMetadataKey } from '@walnut-server/const/decorator/functional'
import { WalnutAdminExceptionEndPointUnavailable } from '@walnut-server/exceptions/business/app'
import { describe, expect, it } from 'vitest'
import { WalnutAdminGuardFunctional } from '../functional.guard'

/**
 * F-24（CQ-008）：functional guard 对设置值 `JSON.parse` 无兜底 —— 管理端可写的设置串
 * 一旦是坏 JSON，挂本 guard 的**整域**端点从「开关关闭」退化成 50000（SyntaxError 冒到
 * 全局过滤器）。修复后解析失败按「设置缺失」语义收口：defaultClosed 端点 50301，
 * 其余放行，两者都留 warn 现场。
 *
 * 用例同时钉住「原本正确的行为不被改坏」：好 JSON 的 1 / 0 / 缺明细键三条判定不变。
 */

const MAIN_KEY = WalnutAdminConstAppSettingKeys.APP_AUTH_GITHUB
const DETAIL_KEY = 'authEnable'

function createContext(): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({}),
    }),
    getHandler: () => function functionalGuardSpecHandler() {},
    getClass: () => class FunctionalGuardSpecController {},
  } as unknown as ExecutionContext
}

interface IGuardOptions {
  /** getAppSettings() 的返回值（显式 null = 缓存整体缺失） */
  settings?: Record<string, unknown> | null
  /** 是否声明 defaultClosed（Google 登录那种「缺省即关闭」的端点） */
  defaultClosed?: boolean
  /** 明细键（缺省 null = 一级开关） */
  detailKey?: string | null
}

function createGuard(options: IGuardOptions = {}) {
  const metadata = new Map<string, unknown>([
    [WalnutAdminConstDecoratorFunctionalMetadataKey.MAIN_KEY, MAIN_KEY],
    [WalnutAdminConstDecoratorFunctionalMetadataKey.DETAIL_KEY, options.detailKey ?? null],
    [WalnutAdminConstDecoratorFunctionalMetadataKey.DEFAULT_CLOSED, options.defaultClosed === true],
  ])

  const reflector = {
    getAllAndOverride: (key: string) => metadata.get(key),
  } as unknown as Reflector

  const settings = options.settings === undefined ? {} : options.settings
  const cacheAppSettingsService = {
    getAppSettings: async () => settings,
  } as unknown as AppTechCacheAppSettingsService

  return new WalnutAdminGuardFunctional(reflector, cacheAppSettingsService)
}

describe('functional guard：设置值坏 JSON 的兜底（F-24）', () => {
  it('坏 JSON + defaultClosed → 受控 50301（修复前是 SyntaxError 兜底 50000）', async () => {
    const guard = createGuard({
      settings: { [MAIN_KEY]: '{"authEnable": 1' },
      defaultClosed: true,
      detailKey: DETAIL_KEY,
    })

    await expect(guard.canActivate(createContext()))
      .rejects
      .toBeInstanceOf(WalnutAdminExceptionEndPointUnavailable)
  })

  it('坏 JSON + 非 defaultClosed → 按「设置缺失」放行（历史口径不变）', async () => {
    const guard = createGuard({
      settings: { [MAIN_KEY]: 'not-json-at-all' },
      detailKey: DETAIL_KEY,
    })

    await expect(guard.canActivate(createContext())).resolves.toBe(true)
  })

  it('合法 JSON + detailKey=1 → 放行；detailKey=0 → 50301（原有开关语义不变）', async () => {
    const enabled = createGuard({
      settings: { [MAIN_KEY]: JSON.stringify({ [DETAIL_KEY]: 1 }) },
      detailKey: DETAIL_KEY,
    })
    await expect(enabled.canActivate(createContext())).resolves.toBe(true)

    const disabled = createGuard({
      settings: { [MAIN_KEY]: JSON.stringify({ [DETAIL_KEY]: 0 }) },
      detailKey: DETAIL_KEY,
    })
    await expect(disabled.canActivate(createContext()))
      .rejects
      .toBeInstanceOf(WalnutAdminExceptionEndPointUnavailable)
  })

  it('合法 JSON 但缺 detailKey：非 defaultClosed 放行 / defaultClosed 50301（缺失语义不变）', async () => {
    const openGuard = createGuard({
      settings: { [MAIN_KEY]: JSON.stringify({ other: 1 }) },
      detailKey: DETAIL_KEY,
    })
    await expect(openGuard.canActivate(createContext())).resolves.toBe(true)

    const closedGuard = createGuard({
      settings: { [MAIN_KEY]: JSON.stringify({ other: 1 }) },
      defaultClosed: true,
      detailKey: DETAIL_KEY,
    })
    await expect(closedGuard.canActivate(createContext()))
      .rejects
      .toBeInstanceOf(WalnutAdminExceptionEndPointUnavailable)
  })

  it('值不是字符串（对象 / 数组 / 标量 / null）→ 同样按缺失语义收口，不抛 TypeError', async () => {
    for (const raw of [{ authEnable: 1 }, [1, 2], 42, null]) {
      const guard = createGuard({
        settings: { [MAIN_KEY]: raw },
        detailKey: DETAIL_KEY,
      })

      await expect(guard.canActivate(createContext())).resolves.toBe(true)
    }

    const closed = createGuard({
      settings: { [MAIN_KEY]: { authEnable: 1 } },
      defaultClosed: true,
      detailKey: DETAIL_KEY,
    })

    await expect(closed.canActivate(createContext()))
      .rejects
      .toBeInstanceOf(WalnutAdminExceptionEndPointUnavailable)
  })

  it('一级开关（无 detailKey）的既有口径不变：值为 1 放行、缺失即 50301', async () => {
    const enabled = createGuard({ settings: { [MAIN_KEY]: 1 } })
    await expect(enabled.canActivate(createContext())).resolves.toBe(true)

    const missing = createGuard({ settings: {}, defaultClosed: true })
    await expect(missing.canActivate(createContext()))
      .rejects
      .toBeInstanceOf(WalnutAdminExceptionEndPointUnavailable)
  })
})
