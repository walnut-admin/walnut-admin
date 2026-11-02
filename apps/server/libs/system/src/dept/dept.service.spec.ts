import type { EntityManager } from 'typeorm'
import type { ISysDeptSubtreeRow } from './dept.basic.repository'
import { WalnutAdminExceptionBadRequest } from '@walnut-server/exceptions/base.exception'
import { describe, expect, it } from 'vitest'
import { SysDeptService } from './dept.service'

/**
 * F-25（CQ-009）：dept create / update 与 delete 的事务口径不一致 ——
 * controller 不挂 `@WalnutTx()`、service 不收 em ⇒ 「查重 / 存在性 / 防环」这些
 * check-then-write 前置校验与随后的写腿不在同一事务，防环读腿也没有行锁。
 *
 * 本用例只钉接线契约（mock 仓储记录调用，风格对照 employee.service.spec）：
 * 1. em 逐层透传（读腿与写腿用同一个事务句柄）；
 * 2. 防环读腿前先对「被移动行 + 目标父行」加锁，且锁在子树读之前；
 * 3. 受控错误语义不变（自身当父 / 父在子树内 → 40000 parentCycle，且不落写腿）。
 *
 * 真实并发（两笔反向移动只有一笔成功）由 integration 库用例覆盖。
 */

const EM = { marker: 'entity-manager' } as unknown as EntityManager
const SELF_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_ID = '22222222-2222-4222-8222-222222222222'

interface IDeptRow {
  id: string
  parentId: string | null
  deptCode: string
  deptName: string
  status: string
}

function deptRow(patch: Partial<IDeptRow> = {}): IDeptRow {
  return {
    id: SELF_ID,
    parentId: null,
    deptCode: 'dept-a',
    deptName: '部门 A',
    status: 'enabled',
    ...patch,
  }
}

function subtreeRow(id: string): ISysDeptSubtreeRow {
  return {
    id,
    parentId: null,
    deptCode: 'x',
    deptName: 'x',
    leader: null,
    phone: null,
    email: null,
    sortOrder: 0,
    status: 'enabled',
    depth: 0,
    isCycle: false,
  }
}

/** 记录调用的假仓储（只回放 current / parent / subtree 三份数据） */
class FakeDeptRepo {
  readonly calls: Array<{ method: string, args: unknown[] }> = []

  current: IDeptRow = deptRow()
  parent: IDeptRow | null = deptRow({ id: OTHER_ID, deptCode: 'dept-b' })
  subtreeIds: string[] = [SELF_ID]

  private record(method: string, args: unknown[]): void {
    this.calls.push({ method, args })
  }

  methods(): string[] {
    return this.calls.map(call => call.method)
  }

  argsOf(method: string): unknown[] | undefined {
    return this.calls.find(call => call.method === method)?.args
  }

  async create(dto: unknown, em?: EntityManager) {
    this.record('create', [dto, em])
    return { ...this.current, ...(dto as object) }
  }

  async update(id: string, dto: unknown, em?: EntityManager) {
    this.record('update', [id, dto, em])
    return { ...this.current, id, ...(dto as object) }
  }

  async readById(id: string, em?: EntityManager) {
    this.record('readById', [id, em])
    return this.current
  }

  async findByCode(deptCode: string, em?: EntityManager) {
    this.record('findByCode', [deptCode, em])
    return null
  }

  async findById(id: string, em?: EntityManager) {
    this.record('findById', [id, em])
    return this.parent
  }

  async findSubtreeById(id: string, options?: unknown, em?: EntityManager) {
    this.record('findSubtreeById', [id, options, em])
    return this.subtreeIds.map(subtreeRow)
  }

  async findAncestorDeptIds(id: string, em?: EntityManager) {
    this.record('findAncestorDeptIds', [id, em])
    return []
  }

  async lockByIdsForUpdate(ids: Array<string | null | undefined>, em?: EntityManager) {
    this.record('lockByIdsForUpdate', [ids, em])
    return true
  }
}

class FakeDataScopeService {
  readonly movedDepts: string[][] = []

  async invalidateForDeptMove(deptId: string, oldAncestorIds: string[]): Promise<void> {
    this.movedDepts.push([deptId, ...oldAncestorIds])
  }
}

function createService() {
  const repo = new FakeDeptRepo()
  const dataScopeService = new FakeDataScopeService()
  const service = new SysDeptService(repo as never, dataScopeService as never)

  return { repo, dataScopeService, service }
}

function updatePayload(parentId: string | null) {
  return {
    deptCode: 'dept-a',
    deptName: '部门 A',
    parentId,
    status: 'enabled',
  } as never
}

function responseOf(error: unknown): Record<string, unknown> {
  return (error as { getResponse: () => Record<string, unknown> }).getResponse()
}

describe('dept service：事务口径 + 防环行锁（F-25）', () => {
  it('create：查重 / 父存在性 / 写腿共用同一个 em，且不锁父行（新行 INSERT 前不可能成环）', async () => {
    const { repo, service } = createService()

    await service.create({ deptCode: 'dept-c', deptName: '部门 C', parentId: OTHER_ID, status: 'enabled' } as never, EM)

    expect(repo.methods()).toEqual(['findByCode', 'findById', 'create'])
    expect(repo.argsOf('findByCode')).toEqual(['dept-c', EM])
    expect(repo.argsOf('findById')).toEqual([OTHER_ID, EM])
    expect(repo.argsOf('create')?.[1]).toBe(EM)
  })

  it('update：先锁「被移动行 + 目标父行」，再读子树判环，最后才写（读腿全程同一 em）', async () => {
    const { repo, service } = createService()

    await service.update(SELF_ID, updatePayload(OTHER_ID), EM)

    // 锁的 id 集合与顺序：调用方把「自身 + 目标父」交给仓库（仓库内部再按 id 升序加锁）
    expect(repo.argsOf('lockByIdsForUpdate')).toEqual([[SELF_ID, OTHER_ID], EM])

    // 锁必须在子树读之前 —— 否则又是「先读后锁」的竞态窗口
    const methods = repo.methods()
    expect(methods.indexOf('lockByIdsForUpdate')).toBeLessThan(methods.indexOf('findSubtreeById'))

    expect(repo.argsOf('findById')).toEqual([OTHER_ID, EM])
    expect(repo.argsOf('findSubtreeById')?.[2]).toBe(EM)
    expect(repo.argsOf('update')?.[0]).toBe(SELF_ID)
    expect(repo.argsOf('update')?.[1]).toMatchObject({ parentId: OTHER_ID })
    expect(repo.argsOf('update')?.[2]).toBe(EM)
  })

  it('update：目标父节点落在自身子树内 → 受控 40000 parentCycle 且不落写腿', async () => {
    const { repo, service } = createService()
    repo.subtreeIds = [SELF_ID, OTHER_ID]

    const error = await service.update(SELF_ID, updatePayload(OTHER_ID), EM).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(WalnutAdminExceptionBadRequest)
    expect(responseOf(error).errMsg).toBe('business.system.dept.parentCycle')
    expect(repo.methods()).not.toContain('update')
  })

  it('update：自身当父 → 受控 40000 parentCycle，不锁也不写', async () => {
    const { repo, service } = createService()

    const error = await service.update(SELF_ID, updatePayload(SELF_ID), EM).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(WalnutAdminExceptionBadRequest)
    expect(responseOf(error).errMsg).toBe('business.system.dept.parentCycle')
    expect(repo.methods()).not.toContain('lockByIdsForUpdate')
    expect(repo.methods()).not.toContain('update')
  })

  it('update：parentId 为 null（提升为根）不需要防环锁，也不做父存在性校验', async () => {
    const { repo, service } = createService()
    repo.current = deptRow({ parentId: OTHER_ID })

    await service.update(SELF_ID, updatePayload(null), EM)

    expect(repo.methods()).not.toContain('lockByIdsForUpdate')
    expect(repo.methods()).not.toContain('findById')
    expect(repo.argsOf('update')?.[1]).toMatchObject({ parentId: null })
    expect(repo.argsOf('update')?.[2]).toBe(EM)
  })

  it('update：父节点变更触发数据权限失效（after-commit 钩子无事务上下文时内联执行）', async () => {
    const { dataScopeService, service } = createService()

    await service.update(SELF_ID, updatePayload(OTHER_ID), EM)

    // 当前行是根（parentId=null）→ 没有旧祖先链要失效，只失效被移动的部门本身
    expect(dataScopeService.movedDepts).toEqual([[SELF_ID]])
  })
})
