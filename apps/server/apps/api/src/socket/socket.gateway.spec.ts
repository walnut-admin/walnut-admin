import { Logger } from '@nestjs/common'
import { instrument } from '@socket.io/admin-ui'
import { WalnutAdminConstAppEnv } from '@walnut-server/const/app/env'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WalnutAdminSocketNamespace } from './socket.const'
import { SocketGateway } from './socket.gateway'

/**
 * F-01（admin UI 门禁）单测：
 * - SOCKET_ADMIN_UI_USER / SOCKET_ADMIN_UI_PASSWORD 未**同时**配置 → 不挂载 instrument
 *   （fail-closed）并打 warn；
 * - 两者同时配置 → 以 auth: { type: 'basic', username, password } 挂载（不再 auth:false 裸奔）；
 * - mode 由 WalnutAdminEnv（libs/const）判定，production → 'production'，其余 → 'development'。
 * 门禁只关 admin UI：连接鉴权中间件与 socketService 挂载不受影响。
 */

vi.mock('@socket.io/admin-ui', () => ({ instrument: vi.fn() }))

const ADMIN_USER = 'spec-admin'
const ADMIN_PASSWORD = 'spec-strong-pass'

function createGatewayClass(GatewayClass: typeof SocketGateway, env: Record<string, string | undefined>) {
  const configService = { get: (key: string) => env[key] }
  const socketService = { socket: null as unknown }
  const gateway = new GatewayClass(
    socketService as never,
    configService as never,
    {} as never,
    {} as never,
    {} as never,
  )

  return { gateway, socketService }
}

function createNamespace() {
  return { use: vi.fn(), server: { 'spec-server': true } }
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('socketGateway.afterInit：F-01 admin UI 门禁（fail-closed）', () => {
  it('两个变量都未配置 → 不挂载 instrument，warn 提示', () => {
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {})
    const { gateway, socketService } = createGatewayClass(SocketGateway, {})
    const namespace = createNamespace()

    gateway.afterInit(namespace as never)

    expect(instrument).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalled()
    // 门禁只关 admin UI：鉴权中间件照常挂、socketService 照常接 namespace
    expect(namespace.use).toHaveBeenCalled()
    expect(socketService.socket).toBe(namespace)
  })

  it('只配 user 不配 password → 不挂载（要求两者同时在场）', () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {})
    const { gateway } = createGatewayClass(SocketGateway, { SOCKET_ADMIN_UI_USER: ADMIN_USER })
    const namespace = createNamespace()

    gateway.afterInit(namespace as never)

    expect(instrument).not.toHaveBeenCalled()
  })

  it('只配 password 不配 user → 不挂载', () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {})
    const { gateway } = createGatewayClass(SocketGateway, { SOCKET_ADMIN_UI_PASSWORD: ADMIN_PASSWORD })
    const namespace = createNamespace()

    gateway.afterInit(namespace as never)

    expect(instrument).not.toHaveBeenCalled()
  })

  it('两者都配置 → 以 auth:{user,password} + namespace 常量挂载（非 production 环境 mode 为 development）', () => {
    const { gateway } = createGatewayClass(SocketGateway, {
      SOCKET_ADMIN_UI_USER: ADMIN_USER,
      SOCKET_ADMIN_UI_PASSWORD: ADMIN_PASSWORD,
    })
    const namespace = createNamespace()

    gateway.afterInit(namespace as never)

    expect(instrument).toHaveBeenCalledTimes(1)
    expect(instrument).toHaveBeenCalledWith(
      namespace.server,
      expect.objectContaining({
        auth: { type: 'basic', username: ADMIN_USER, password: ADMIN_PASSWORD },
        mode: 'development',
        namespaceName: WalnutAdminSocketNamespace,
      }),
    )
  })

  it('生产环境（NODE_ENV=production）→ mode production（WalnutAdminEnv 判定，无裸 as 断言）', async () => {
    vi.resetModules()
    vi.stubEnv('NODE_ENV', WalnutAdminConstAppEnv.PROD)
    // WalnutAdminEnv 在模块求值时读一次 NODE_ENV —— 用 resetModules 拿生产语境的新实例
    const [{ instrument: freshInstrument }, { SocketGateway: ProdGateway }] = await Promise.all([
      import('@socket.io/admin-ui'),
      import('./socket.gateway'),
    ])
    const { gateway } = createGatewayClass(ProdGateway, {
      SOCKET_ADMIN_UI_USER: ADMIN_USER,
      SOCKET_ADMIN_UI_PASSWORD: ADMIN_PASSWORD,
    })
    const namespace = createNamespace()

    gateway.afterInit(namespace as never)

    expect(freshInstrument).toHaveBeenCalledTimes(1)
    expect(freshInstrument).toHaveBeenCalledWith(
      namespace.server,
      expect.objectContaining({
        auth: { type: 'basic', username: ADMIN_USER, password: ADMIN_PASSWORD },
        mode: 'production',
      }),
    )
  })
})
