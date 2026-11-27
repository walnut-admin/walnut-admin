import type { ClassConstructor } from 'class-transformer'
import { plainToInstance } from 'class-transformer'
import { validateSync } from 'class-validator'
import { describe, expect, it } from 'vitest'
import { SysDictTypeDTOUpdateRequest } from '../dictType.dto'

/**
 * ④（2026-11 F2）：update DTO 真 PATCH 语义（`RealPartialType(..., { preserveAbsent: true })`）。
 *
 * 与 F1 的 menu.dto.spec 同口径：字段装饰器会把 nil 在 toClassOnly 阶段落成 null，
 * preserveAbsent 的收尾 Transform 把**源请求体里不存在**的键还原成 undefined；
 * 显式 null（有意的清空）必须保留。service 侧 omitUndefined 后未给列不进 UPDATE。
 */
function parse(dto: ClassConstructor<object>, body: Record<string, unknown>) {
  return plainToInstance(dto, body, { exposeUnsetFields: false }) as Record<string, unknown>
}

describe('update DTO / dict type：真 partial（preserveAbsent）', () => {
  it('只给 name ⇒ 其余键不落键，校验放行', () => {
    const instance = parse(SysDictTypeDTOUpdateRequest, { name: 'only-name' })

    expect(Object.keys(instance)).toEqual(['name'])
    expect(instance.type).toBeUndefined()
    expect(instance.status).toBeUndefined()
    expect(instance.description).toBeUndefined()
    expect(validateSync(instance)).toEqual([])
  })

  it('显式 null（有意的清空）必须保留，不被当成「未提供」', () => {
    const instance = parse(SysDictTypeDTOUpdateRequest, { description: null })

    expect(Object.hasOwn(instance, 'description')).toBe(true)
    expect(instance.description).toBeNull()
    expect(instance.name).toBeUndefined()
  })
})
