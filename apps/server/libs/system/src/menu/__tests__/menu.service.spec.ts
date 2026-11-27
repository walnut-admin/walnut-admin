import type { ClassConstructor } from 'class-transformer'
import { plainToInstance } from 'class-transformer'
import { describe, expect, it } from 'vitest'

import { SYS_MENU_META_FIELD_MAP, SysMenuDTOUpdateRequest } from '../dto/menu.dto'
import { SysMenuService } from '../menu.service'

/**
 * menu.service.update 的真 PATCH 契约（2026-11 F1，mock 仓储）：
 *
 * - 请求里没给的**顶层列**不进 repo.update 的 payload（历史 bug：只改 title 会把
 *   name/title 等未给字符串列写成 NULL）；
 * - 显式传 null 是「清空」，必须原样进 payload；
 * - meta 给了即 19 个拍平列整体产出（Mongo 子文档语义，缺省键回默认值）；不给则 meta
 *   列一个都不进 payload；
 * - F3：只有 permission / status 真变化才清权限缓存。
 *
 * 数据库级落库（UPDATE 不写 NULL）由 `menu.api-spec.ts` 的真实 HTTP 用例覆盖。
 */

interface UpdateCall {
  id: string
  payload: Record<string, unknown>
}

class FakeMenuBasicRepo {
  readonly updateCalls: UpdateCall[] = []
  readonly createdPayloads: Record<string, unknown>[] = []

  constructor(private readonly row: Record<string, unknown>) {}

  async readById(_id: string) {
    return { ...this.row }
  }

  async update(id: string, payload: Record<string, unknown>) {
    this.updateCalls.push({ id, payload })
    return { ...this.row, ...payload }
  }

  async create(payload: Record<string, unknown>) {
    this.createdPayloads.push(payload)
    return { ...this.row, ...payload }
  }
}

function createService(row: Record<string, unknown> = {}) {
  const repo = new FakeMenuBasicRepo({
    id: 'menu-1',
    type: 'menu',
    name: 'origin-name',
    title: 'menu.title.origin',
    path: '/origin',
    icon: 'mdi:origin',
    permission: null,
    status: true,
    ...row,
  })
  const cleared: number[] = []
  const menuShared = {
    clearAllPermissionsCache: async () => {
      cleared.push(cleared.length + 1)
    },
  }
  const service = new SysMenuService(
    repo as never,
    menuShared as never,
    {} as never,
  )
  return { repo, cleared, service }
}

/** 与全局 ValidationPipe 同口径（main.ts：transform + exposeUnsetFields: false） */
function parse(dto: ClassConstructor<object>, body: Record<string, unknown>) {
  return plainToInstance(dto, body, { exposeUnsetFields: false })
}

describe('menu service update：只写调用方提供的列（真 PATCH）', () => {
  it('只给 name ⇒ payload 只有 name，title/path/icon 等未给列不出现（更不写 null）', async () => {
    const { repo, cleared, service } = createService()
    const dto = parse(SysMenuDTOUpdateRequest, { name: 'only-name' })

    await service.update('menu-1', dto)

    expect(repo.updateCalls).toHaveLength(1)
    const payload = repo.updateCalls[0].payload
    expect(payload).toEqual({ name: 'only-name' })
    expect(Object.keys(payload)).not.toContain('title')
    expect(Object.keys(payload)).not.toContain('path')
    expect(Object.keys(payload).every(key => payload[key] !== null)).toBe(true)
    expect(cleared).toEqual([])
  })

  it('只给 meta.permission ⇒ 19 个拍平列整体产出（缺省键回默认值），顶层 name/title 不进 payload', async () => {
    const { repo, cleared, service } = createService()
    const dto = parse(SysMenuDTOUpdateRequest, { meta: { permission: 'system:menu:probe' } })

    await service.update('menu-1', dto)

    const payload = repo.updateCalls[0].payload
    expect(payload.permission).toBe('system:menu:probe')
    expect(Object.keys(payload).sort()).toEqual(
      SYS_MENU_META_FIELD_MAP.map(([, columnKey]) => columnKey).sort(),
    )
    expect(Object.keys(payload)).not.toContain('name')
    expect(Object.keys(payload)).not.toContain('title')
    // permission 真变化 ⇒ 全量清权限缓存（F3）
    expect(cleared).toHaveLength(1)
  })

  it('显式传 null（清空 title）⇒ 原样进 payload', async () => {
    const { repo, service } = createService()
    const dto = parse(SysMenuDTOUpdateRequest, { title: null })

    await service.update('menu-1', dto)

    expect(repo.updateCalls[0].payload).toEqual({ title: null })
  })

  it('不给 meta ⇒ meta 列一个都不进 payload', async () => {
    const { repo, service } = createService()
    const dto = parse(SysMenuDTOUpdateRequest, { icon: 'mdi:updated' })

    await service.update('menu-1', dto)

    const payload = repo.updateCalls[0].payload
    expect(payload).toEqual({ icon: 'mdi:updated' })
    for (const [, columnKey] of SYS_MENU_META_FIELD_MAP) {
      expect(Object.keys(payload)).not.toContain(columnKey)
    }
  })

  it('meta 里 status 未变 ⇒ 不清权限缓存（F3 收窄）', async () => {
    const { cleared, service } = createService()
    const dto = parse(SysMenuDTOUpdateRequest, { meta: { status: true, order: 3 } })

    await service.update('menu-1', dto)

    expect(cleared).toEqual([])
  })
})
