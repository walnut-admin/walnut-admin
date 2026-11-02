import type { IWalnutAdminSocketEventDataMap } from './socket'

import { describe, expect, it } from 'vitest'
import { WalnutAdminConstCookieKeys } from './cookie'
import { AES_GCM_WIRE, AppKeyTypeConst } from './crypto-wire'
import { DataScope } from './data-scope'
import { RequestHeaders } from './http'
import { Locale } from './i18n'
import * as contract from './index'
import { CacheKeyStrategy, MenuTernal, MenuType } from './menu'
import { WalnutAdminConstSysUserMfaType, WalnutAdminConstSysUserMfaWebauthnTransport } from './mfa'
import { SortOrderValues } from './pagination'
import { colorModeConst, CVDConst, fontSizeConst, fontSizeValues, layoutModeConst } from './preference'
import { WalnutAdminConstAppResponseCode } from './response-code'
import { Role, RoleMode } from './role'
import { AppRoutes, AuthRoutes, SecurityRoutes, SharedRoutes, SystemEndpointRoutes, SystemRoutes } from './routes'
import { WalnutAdminConstAppSettingForceQuitStrategy } from './setting'
import { WalnutAdminSocketEvents, WalnutAdminSocketRooms } from './socket'
import { WalnutAdminSseEvents } from './sse'
import { WalnutAdminConstAppTokenKey } from './token-key'
import { LockModeConst } from './user-lock'

/**
 * 契约快照测试 — @walnut/contract 是前后端共享的 API 契约。
 * 任何常量的意外变更都会在快照 diff 中暴露，提醒破坏性变更需要显式决策
 * （错误码数值、路由路径、wire format 常数均不可静默改动）。
 */
describe('contract snapshots', () => {
  it('public API surface stays stable', () => {
    expect(Object.keys(contract).sort()).toMatchSnapshot()
  })

  it('aes-gcm wire format constants never change silently', () => {
    expect(AES_GCM_WIRE).toMatchSnapshot()
  })

  it('app key types never change silently', () => {
    expect(AppKeyTypeConst).toMatchSnapshot()
  })

  it('response codes never change silently', () => {
    expect(WalnutAdminConstAppResponseCode).toMatchSnapshot()
  })

  it('roles never change silently', () => {
    expect(Role).toMatchSnapshot()
  })

  it('role modes never change silently', () => {
    expect(RoleMode).toMatchSnapshot()
  })

  it('data scope tiers never change silently', () => {
    expect(DataScope).toMatchSnapshot()
  })

  it('cookie keys never change silently', () => {
    expect(WalnutAdminConstCookieKeys).toMatchSnapshot()
  })

  it('request header names never change silently', () => {
    expect(RequestHeaders).toMatchSnapshot()
  })

  it('locale values never change silently', () => {
    expect(Locale).toMatchSnapshot()
  })

  it('menu enums never change silently', () => {
    expect({ CacheKeyStrategy, MenuTernal, MenuType }).toMatchSnapshot()
  })

  it('mfa methods and transports never change silently', () => {
    expect({ WalnutAdminConstSysUserMfaType, WalnutAdminConstSysUserMfaWebauthnTransport }).toMatchSnapshot()
  })

  it('user lock modes never change silently', () => {
    expect(LockModeConst).toMatchSnapshot()
  })

  it('preference value sets never change silently', () => {
    expect({ fontSizeConst, fontSizeValues, colorModeConst, CVDConst, layoutModeConst }).toMatchSnapshot()
  })

  it('force quit strategies never change silently', () => {
    expect(WalnutAdminConstAppSettingForceQuitStrategy).toMatchSnapshot()
  })

  it('sse event names never change silently', () => {
    expect(WalnutAdminSseEvents).toMatchSnapshot()
  })

  it('socket force quit payload carries a known strategy', () => {
    const payload: IWalnutAdminSocketEventDataMap['force:quit'] = {
      strategy: WalnutAdminConstAppSettingForceQuitStrategy.FORCE_IMMEDIATE_SIGNOUT,
    }
    expect(payload.strategy).toBe('FORCE_IMMEDIATE_SIGNOUT')
  })

  it('sort order values never change silently', () => {
    expect(SortOrderValues).toMatchSnapshot()
  })

  it('socket events and rooms never change silently', () => {
    expect({ WalnutAdminSocketEvents, WalnutAdminSocketRooms }).toMatchSnapshot()
  })

  it('token keys never change silently', () => {
    expect(WalnutAdminConstAppTokenKey).toMatchSnapshot()
  })

  it('api routes never change silently', () => {
    expect({ AppRoutes, AuthRoutes, SecurityRoutes, SharedRoutes, SystemEndpointRoutes, SystemRoutes }).toMatchSnapshot()
  })
})
