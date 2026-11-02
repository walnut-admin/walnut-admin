import { Buffer } from 'node:buffer'
import { createHmac } from 'node:crypto'
import { WalnutAdminConstAppCacheKeys } from '@walnut-server/const/app/cache'
import { describe, expect, it } from 'vitest'
import { OAuthStateService } from './oauth-state.service'

/**
 * P2-13 state 通道 + 批次6-B 的收口单测（libs/auth，无 DB / 无 Redis 依赖）。
 *
 * 钉住四条不变量：
 * 1. **state 明文段只有 `{ lang, nonce }`** —— 客户端指纹（fp）与 deviceId 都不外发
 *    （deviceId 只落 Redis，避免把它交给第三方 IdP 与沿途日志）；
 * 2. `consumeState` 返回的 deviceId **就是签发时绑定的那台设备**（不是回读请求 cookie），
 *    回调侧据此推导投递频道；
 * 3. 跨设备 / 重放 / 篡改签名一律 null，且**验签与设备绑定失败都不烧掉 nonce**
 *    （正牌设备仍能完成授权）；
 * 4. 部署窗口兼容：旧格式 state（明文段里还带 fp）在 10 分钟 TTL 内仍可消费。
 */

const DEVICE_A = 'device-aaaaaaaaaaaaaaaa'
const DEVICE_B = 'device-bbbbbbbbbbbbbbbb'
const SECRET = 'unit-test-session-secret'

/** 内存版 AppTechCacheService：只用 set / get / delAndCount 三个方法（语义与 Redis 版一致） */
interface CacheStub {
  store: Map<string, unknown>
  set: (key: string, value: unknown, options?: unknown) => Promise<void>
  get: (key: string) => Promise<unknown>
  delAndCount: (key: string) => Promise<number>
}

function createCacheStub(): CacheStub {
  const store = new Map<string, unknown>()

  return {
    store,
    set: async (key, value) => {
      store.set(key, value)
    },
    get: async key => (store.has(key) ? store.get(key) : null),
    delAndCount: async key => (store.delete(key) ? 1 : 0),
  }
}

function createHarness() {
  const cache = createCacheStub()
  const configService = { get: (key: string) => (key === 'app.session.secret' ? SECRET : undefined) }

  const service = new OAuthStateService(configService as never, cache as never)

  return { service, cache }
}

function nonceCacheKey(nonce: string) {
  return `${WalnutAdminConstAppCacheKeys.AUTH_OAUTH_STATE}:${nonce}`
}

/** 解出 state 的明文段（签名段不验，验签由 consumeState 覆盖） */
function decodePayload(state: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(state.split('.')[0], 'base64url').toString('utf8')) as Record<string, unknown>
}

describe('oauth state service (P2-13 + 批次6-B)', () => {
  it('state 明文段只有 lang 与 nonce：fp 已移除，deviceId 不外发', async () => {
    const { service } = createHarness()

    const state = await service.issueState('zh_CN', DEVICE_A)
    const payload = decodePayload(state)

    expect(Object.keys(payload).sort()).toEqual(['lang', 'nonce'])
    expect(payload.lang).toBe('zh_CN')
    expect(payload.nonce).toMatch(/^[0-9a-f]{32}$/)
    // 绑定值只落 Redis（服务端），不出现在任何一段 state 里
    expect(state).not.toContain(DEVICE_A)
  })

  it('签发-消费闭环：consumeState 返回的 deviceId 就是签发时绑定的那台设备', async () => {
    const { service } = createHarness()

    const state = await service.issueState('zh_CN', DEVICE_A)
    const consumed = await service.consumeState(state, DEVICE_A)

    expect(consumed).toEqual({ lang: 'zh_CN', deviceId: DEVICE_A })
  })

  it('跨设备消费一律 null，且不烧掉 nonce（正牌设备随后仍能完成授权）', async () => {
    const { service, cache } = createHarness()

    const state = await service.issueState('zh_CN', DEVICE_A)

    expect(await service.consumeState(state, DEVICE_B)).toBeNull()
    // 绑定失败发生在 DEL 之前 —— nonce 仍在，正牌设备不受影响
    expect(cache.store.size).toBe(1)

    const consumed = await service.consumeState(state, DEVICE_A)
    expect(consumed?.deviceId).toBe(DEVICE_A)
  })

  it('一次性：同一 state 第二次消费返回 null（Redis DEL 计数只有一个赢家）', async () => {
    const { service } = createHarness()

    const state = await service.issueState('en_US', DEVICE_A)

    expect(await service.consumeState(state, DEVICE_A)).not.toBeNull()
    expect(await service.consumeState(state, DEVICE_A)).toBeNull()
  })

  it('篡改签名 → null，且不影响原始 state', async () => {
    const { service } = createHarness()

    const state = await service.issueState('zh_CN', DEVICE_A)
    const last = state.slice(-1)
    const tampered = `${state.slice(0, -1)}${last === 'A' ? 'B' : 'A'}`

    expect(await service.consumeState(tampered, DEVICE_A)).toBeNull()
    // 验签失败在消费之前：nonce 未被 DEL
    expect(await service.consumeState(state, DEVICE_A)).not.toBeNull()
  })

  it('形态非法 / 缺失的 state 一律 null（不抛异常）', async () => {
    const { service } = createHarness()

    expect(await service.consumeState(undefined, DEVICE_A)).toBeNull()
    expect(await service.consumeState('', DEVICE_A)).toBeNull()
    expect(await service.consumeState('no-signature-part', DEVICE_A)).toBeNull()
    expect(await service.consumeState('a.b.c', DEVICE_A)).toBeNull()
    expect(await service.consumeState(`${Buffer.from('{"nonce":"x"}', 'utf8').toString('base64url')}.bad`, DEVICE_A)).toBeNull()
  })

  it('空 deviceId 既不签发也不接受（F5：不依赖 null == null 的伪绑定）', async () => {
    const { service } = createHarness()

    await expect(service.issueState('zh_CN', '')).rejects.toBeTruthy()
    await expect(service.issueState('zh_CN', undefined as never)).rejects.toBeTruthy()

    const state = await service.issueState('zh_CN', DEVICE_A)
    expect(await service.consumeState(state, '')).toBeNull()
  })

  it('部署窗口兼容：旧格式 state（明文段还带 fp）在 TTL 内仍可消费', async () => {
    const { service, cache } = createHarness()

    // 模拟旧版本签发出去的 state（按同一签名算法本地复现，不依赖旧代码）
    const nonce = 'a'.repeat(32)
    await cache.set(nonceCacheKey(nonce), { fp: 'legacy-fp', deviceId: DEVICE_A }, {})

    const encoded = Buffer.from(JSON.stringify({ fp: 'legacy-fp', lang: 'zh_CN', nonce }), 'utf8').toString('base64url')
    const signature = createHmac('sha256', SECRET).update(encoded, 'utf8').digest('base64url')

    const consumed = await service.consumeState(`${encoded}.${signature}`, DEVICE_A)

    expect(consumed).toEqual({ lang: 'zh_CN', deviceId: DEVICE_A })
  })
})
