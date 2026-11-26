import type { ClassConstructor } from 'class-transformer'
import { plainToInstance } from 'class-transformer'
import { validateSync } from 'class-validator'
import { describe, expect, it } from 'vitest'

import { SysMenuDTOCreateRequest, SysMenuDTOUpdateRequest } from '../menu.dto'

/**
 * update 真 PATCH 语义（2026-11 F1）：
 *
 * 字段装饰器（`WalnutAdminDecoratorFieldString/Boolean`）在 toClassOnly 阶段把 nil 落成
 * null —— 这是 create 的默认值兜底。但 class-transformer 的 PLAIN_TO_CLASS 会对所有
 * `@Expose` 键跑 Transform，未提供的键也会被写成显式 null；update 把 DTO 整份交给
 * repo.update 时就会 `SET col = NULL` 覆盖未给列（历史 bug：只改 title 会清掉 name/title
 * 之外的标量列）。
 *
 * `RealPartialType(..., { preserveAbsent: true })` 用收尾 Transform 把**源请求体里不存在**
 * 的键还原成 undefined（ValidationPipe 的 `exposeUnsetFields: false` 因此不落键）。
 * 显式 null 是调用方有意的「清空」动作，必须保留。
 */

/** 与全局 ValidationPipe 同口径（main.ts：transform + exposeUnsetFields: false） */
function parse(dto: ClassConstructor<object>, body: Record<string, unknown>) {
  return plainToInstance(dto, body, { exposeUnsetFields: false }) as Record<string, unknown>
}

describe('update DTO：真 partial（preserveAbsent）', () => {
  it('只给 meta ⇒ 顶层字符串字段不落键（不再被伪造成 null）', () => {
    const instance = parse(SysMenuDTOUpdateRequest, { meta: { order: 6 } })

    expect(Object.keys(instance).sort()).toEqual(['meta'])
    expect(instance.path).toBeUndefined()
    expect(instance.name).toBeUndefined()
    expect(instance.title).toBeUndefined()
    expect(instance.icon).toBeUndefined()
    expect(instance.type).toBeUndefined()
    expect(instance.pid).toBeUndefined()
    // 校验放行：可选字段缺省不报错
    expect(validateSync(instance)).toEqual([])
  })

  it('只给 name ⇒ 只有 name 落键，title 等其余顶层字段保持未提供', () => {
    const instance = parse(SysMenuDTOUpdateRequest, { name: 'only-name' })

    expect(Object.keys(instance)).toEqual(['name'])
    expect(instance.name).toBe('only-name')
    expect(instance.title).toBeUndefined()
  })

  it('显式传 null（有意的清空）必须保留，不被当成「未提供」', () => {
    const instance = parse(SysMenuDTOUpdateRequest, { title: null, icon: 'mdi:new' })

    expect(Object.hasOwn(instance, 'title')).toBe(true)
    expect(instance.title).toBeNull()
    expect(instance.icon).toBe('mdi:new')
    expect(instance.name).toBeUndefined()
  })

  it('对照：Create DTO 仍是原语义（缺省字符串字段回填 null），未被 update 的选项波及', () => {
    const instance = plainToInstance(
      SysMenuDTOCreateRequest,
      { type: 'menu' },
      { exposeUnsetFields: false },
    ) as unknown as Record<string, unknown>

    expect(instance.name).toBeNull()
    expect(instance.title).toBeNull()
    expect(instance.type).toBe('menu')
  })
})
