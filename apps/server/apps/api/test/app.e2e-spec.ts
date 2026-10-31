import type { NestExpressApplication } from '@nestjs/platform-express'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bodyOf, expectOk, WalnutApiClient } from './api/helpers/api-client'
import { createApiApp } from './api/helpers/create-api-app'

/**
 * e2e 冒烟：全量 AppModule（真实 guard 链 / interceptor 链）装配 + 集成库。
 *
 * 装配走 `createApiApp`（与 integration 的 `createIntegrationApp` 同源：同款 AppModule、
 * 同款 CACHE_MANAGER 内存替换），并补齐 main.ts 的 bootstrap 配置（URI 版本化 /
 * ValidationPipe / ClassSerializerInterceptor）—— e2e 的请求要真正穿过生产 HTTP 栈。
 * 直接用 `createIntegrationApp` 不可行的原因：它不启用 URI 版本化，而 `WalnutApiClient`
 * 按配置拼 `/{prefix}/v{version}` 路径，握手第一步就会 404。
 *
 * `/` 是 JwtFree + DeviceFree 的公开端点，但 Sign guard 仍生效（裸请求 40112），
 * 因此用 `WalnutApiClient` 完成真实三步引导后以匿名单因子签名访问。
 * 文案真源是 `apps/api/src/i18n/en_US/index.json` 的 `index.hello`（'Hello World'，无感叹号）。
 */
describe('AppController (e2e)', () => {
  let app: NestExpressApplication
  let api: WalnutApiClient

  beforeAll(async () => {
    app = await createApiApp()
    api = await WalnutApiClient.create(app)
  })

  afterAll(async () => {
    await api.cleanupWalnutCacheKeys(api.deviceId)
    await app?.close()
  })

  it('/ (GET)', async () => {
    const res = await api.anon('GET', api.apiPath('/'))
    expect(res.status).toBe(200)
    expectOk(res, 'root hello')
    expect(bodyOf<string>(res).data).toBe('Hello World')
  })
})
