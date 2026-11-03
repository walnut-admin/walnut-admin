import type { CallHandler, ExecutionContext } from '@nestjs/common'
import type { Observable } from 'rxjs'
import { firstValueFrom, of } from 'rxjs'
import { describe, expect, it, vi } from 'vitest'
import { WalnutAdminInterceptorResponseSuccess } from './success.interceptor'

/**
 * 风控降级的**可观测通道**（批次 8 / B2）—— 不敏感端点 fail-open 放行时，
 * 「本次请求风控不可用」必须落进响应壳，而不是只出现在日志里。
 *
 * 通道选型：`meta.riskDegraded`。理由：`_devMsg` 只在 `isDev` 落盘（生产看不到），
 * 加响应头前端拿不到，而 `meta` 是响应壳里**一直存在且当前没人用**的字段
 * （见 libs/utils/src/response.ts 的 WalnutAdminResponseSuccess）—— 缺省不传即零 diff。
 *
 * 负对照：把成功拦截器里 `const meta = ...` 那段删掉（或改回只传三个参数），
 * 用例 1 立刻红。
 */

vi.mock('nestjs-i18n', () => ({
  I18nContext: { current: () => ({ t: (key: string) => key }) },
}))

interface ISpecRequest {
  id: string
  url: string
  realIp: string
  timezone: string
  language: string
  version: string
  repoVersion: string
  riskDegraded?: string
}

function createContext(options: { riskDegraded?: string, freeResponse?: boolean }): ExecutionContext {
  const request: ISpecRequest = {
    id: 'spec-request-id',
    url: '/w/v1/app/monitor/user/state',
    realIp: '203.0.113.9',
    timezone: 'Asia/Shanghai',
    language: 'zh_CN',
    version: '1.0.0',
    repoVersion: 'spec',
    riskDegraded: options.riskDegraded,
  }

  const response = { setHeader: () => response }

  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
    getHandler: () => function specHandler() {},
    getClass: () => class SpecController {},
  } as unknown as ExecutionContext
}

function createInterceptor(freeResponse?: boolean) {
  const reflector = {
    getAllAndOverride: () => freeResponse,
  }

  return new WalnutAdminInterceptorResponseSuccess(reflector as never)
}

async function run(options: { riskDegraded?: string, freeResponse?: boolean, data?: unknown }) {
  const interceptor = createInterceptor(options.freeResponse)
  const next: CallHandler = { handle: () => of(options.data ?? { ok: true }) as Observable<unknown> }

  const stream = await interceptor.intercept(createContext(options), next)

  return firstValueFrom(stream) as unknown as Promise<Record<string, unknown>>
}

describe('成功拦截器：风控降级留痕（meta.riskDegraded）', () => {
  it('带 riskDegraded ⇒ 响应壳 meta 里出现该原因（旧实现只传三个参数，恒 undefined）', async () => {
    const response = await run({ riskDegraded: 'no-device-id' })

    expect(response.meta).toEqual({ riskDegraded: 'no-device-id' })
    // 业务数据与业务码照常（留痕不改变语义）
    expect(response.code).toBe(20000)
  })

  it('三种降级原因原样透出（no-device-id / risk-evaluation-failed / risk-recommendation-missing）', async () => {
    for (const reason of ['no-device-id', 'risk-evaluation-failed', 'risk-recommendation-missing']) {
      const response = await run({ riskDegraded: reason })

      expect(response.meta, reason).toEqual({ riskDegraded: reason })
    }
  })

  it('没有降级 ⇒ 不带 meta（既有响应形态零变化）', async () => {
    const response = await run({})

    expect(response.meta).toBeUndefined()
  })

  it('freeResponse 端点不套壳，也不追加 meta（cap / sign 的自定义 schema 不受影响）', async () => {
    const payload = { challenge: { c: 1, s: 2, d: 3 }, token: 'spec' }
    const response = await run({ riskDegraded: 'no-device-id', freeResponse: true, data: payload })

    expect(response).toEqual(payload)
  })
})
