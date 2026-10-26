import { describe, expect, it } from 'vitest'

import { toWalnutPgJsonbPayload } from './log.operate.jsonb'

/**
 * sys_log_operate 的 jsonb 写入形态归一（B8，phase2 4.16 / Q7 定案）：
 * 正常值直写 jsonb；序列化失败原文旁路 raw_*（零丢失语义）。
 */
describe('toWalnutPgJsonbPayload', () => {
  it('普通对象：data 直写对象、raw 为 null（jsonb 落库形态）', () => {
    const value = { a: 1, b: 'x', nested: { deep: true } }

    expect(toWalnutPgJsonbPayload(value)).toEqual({ data: value, raw: null })
  })

  it('数组（合法 JSON）：原样放行进 data', () => {
    const value = [1, 'two', { three: 3 }]

    expect(toWalnutPgJsonbPayload(value)).toEqual({ data: value, raw: null })
  })

  it('undefined：JSON.stringify 的 null 通道 → data 为 null、不进 raw', () => {
    expect(toWalnutPgJsonbPayload(undefined)).toEqual({ data: null, raw: null })
  })

  it('循环引用：stringify 抛错 → data 置空、原文尽力文本化落 raw', () => {
    const circular: Record<string, unknown> = { a: 1 }
    circular.self = circular

    const payload = toWalnutPgJsonbPayload(circular)

    expect(payload.data).toBeNull()
    // 无法 stringify 的值只能 String() 化（如实降级，见 log.operate.jsonb.ts）
    expect(payload.raw).toBe('[object Object]')
  })

  it('bigint 值：stringify 抛错 → data 置空、raw 兜底为字符串', () => {
    const payload = toWalnutPgJsonbPayload({ big: 1n })

    expect(payload.data).toBeNull()
    expect(typeof payload.raw).toBe('string')
  })

  it('输入对象不被改动（stringify → parse 纯变换，无副作用）', () => {
    const value = { a: 1 }
    toWalnutPgJsonbPayload(value)

    expect(value).toEqual({ a: 1 })
  })
})
