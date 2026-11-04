import type { SchemaObject } from '@nestjs/swagger'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract'
import { describe, expect, it } from 'vitest'

import { WalnutAdminSwaggerResponseSuccessSchemeData } from '../ok.response'

/**
 * F-09：响应壳的 `code` 字段内联响应码枚举。
 *
 * 这里是「响应壳长什么样」的唯一来源（ApiWalnutOkResponse 与 CRUD 六个工厂都调它），
 * 所以用例钉在这里 —— 只要壳还带着全量枚举，全站 operation 的 200 schema 就都带着。
 */

/** 取壳 schema 的 properties（壳是 `allOf: [{ properties }]` 单元素形态） */
function shellProperties(data: SchemaObject = { type: 'null' }) {
  const shell = WalnutAdminSwaggerResponseSuccessSchemeData(data)
  const allOf = shell.allOf as SchemaObject[]

  return allOf[0].properties as Record<string, SchemaObject>
}

describe('walnutAdminSwaggerResponseSuccessSchemeData（F-09：code 枚举）', () => {
  it('code.enum 恰好是 WalnutAdminConstAppResponseCode 的全量取值', () => {
    const properties = shellProperties()

    expect(properties.code.enum).toEqual(Object.values(WalnutAdminConstAppResponseCode))
  })

  it('code.enum 覆盖成功值与 guard 拒绝链上的错误码（40xxx 分支才有依据）', () => {
    const enumValues = shellProperties().code.enum as number[]

    expect(enumValues).toContain(WalnutAdminConstAppResponseCode.SUCCESS)
    // 签名 / 设备 / 限流：守卫链在每个端点上都可能抛，此前文档里完全看不到
    expect(enumValues).toContain(WalnutAdminConstAppResponseCode.UNAUTHORIZED_INVALID_SIGNATURE)
    expect(enumValues).toContain(WalnutAdminConstAppResponseCode.NOT_ACCEPTABLE_DEVICE_UNSUPPORTED)
    expect(enumValues).toContain(WalnutAdminConstAppResponseCode.TOO_MANY_REQUESTS_RATE_LIMITED)
  })

  it('枚举不影响壳结构：data 原样透传、code 默认成功值、msg 仍是字符串', () => {
    const data: SchemaObject = { type: 'array', items: { type: 'string' } }
    const properties = shellProperties(data)

    expect(properties.data).toBe(data)
    expect(properties.code.default).toBe(WalnutAdminConstAppResponseCode.SUCCESS)
    expect(properties.msg.type).toBe('string')
  })
})
