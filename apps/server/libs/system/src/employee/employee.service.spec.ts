import type { EntityManager } from 'typeorm'
import { WalnutAdminExceptionBadRequest } from '@walnut-server/exceptions/base.exception'
import { WalnutAdminExceptionDataExists } from '@walnut-server/exceptions/base/400'
import { describe, expect, it } from 'vitest'
import { SysEmployeeService } from './employee.service'

/**
 * 职工服务的编排契约（mock 仓储，风格对照 `setting.service.spec.ts`）：
 *
 * - **前置校验顺序**：工号唯一 → 部门存在 → 岗位存在；任一失败即短路，不落库；
 * - **PUT 显式列映射**：postId 缺省即 null；userId 永不进 update payload；
 * - **一号一职工**：绑定校验账号存在 + 未被其他职工占用（自身重复绑定幂等）；
 * - **解绑幂等**：未绑定直接返回原行，不做写操作。
 *
 * 数据库级唯一索引（uq_employee_no / uq_employee_user partial）与 HTTP 全链由
 * `employee.api-spec.ts` 覆盖；这里只钉 service 的分支与参数。
 */

interface EmployeeRow {
  id: string
  employeeNo: string
  employeeName?: string
  deptId?: string
  postId?: string | null
  userId?: string | null
  status?: string
}

class FakeEmployeeRepo {
  readonly calls: Array<{ method: string, args: unknown[] }> = []
  readonly employees = new Map<string, EmployeeRow>()
  readonly byNo = new Map<string, EmployeeRow>()
  readonly byUserId = new Map<string, EmployeeRow>()
  readonly users = new Set<string>()

  private record(method: string, args: unknown[]): void {
    this.calls.push({ method, args })
  }

  async findByEmployeeNo(employeeNo: string, em?: EntityManager): Promise<EmployeeRow | null> {
    this.record('findByEmployeeNo', [employeeNo, em])
    return this.byNo.get(employeeNo) ?? null
  }

  async findByUserId(userId: string, em?: EntityManager): Promise<EmployeeRow | null> {
    this.record('findByUserId', [userId, em])
    return this.byUserId.get(userId) ?? null
  }

  async countUserById(userId: string, em?: EntityManager): Promise<number> {
    this.record('countUserById', [userId, em])
    return this.users.has(userId) ? 1 : 0
  }

  async readById(id: string, em?: EntityManager): Promise<EmployeeRow | null> {
    this.record('readById', [id, em])
    return this.employees.get(id) ?? null
  }

  async create(payload: Record<string, unknown>): Promise<EmployeeRow> {
    this.record('create', [payload])
    return { id: 'emp-created', employeeNo: String(payload.employeeNo), ...payload }
  }

  async update(id: string, payload: Partial<EmployeeRow>, em?: EntityManager): Promise<EmployeeRow> {
    this.record('update', [id, payload, em])
    const current = this.employees.get(id) ?? { id, employeeNo: '' }
    const next = { ...current, ...payload }
    this.employees.set(id, next)
    return next
  }

  async deleteSoftById(id: string, userId: string, em?: EntityManager): Promise<boolean> {
    this.record('deleteSoftById', [id, userId, em])
    return true
  }

  async list(payload: unknown) {
    this.record('list', [payload])
    return { data: [], total: 0 }
  }
}

class FakeLookupRepo {
  readonly calls: string[] = []
  constructor(private readonly values = new Set<string>()) {}

  async findById(id: string, _em?: EntityManager) {
    this.calls.push(id)
    return this.values.has(id) ? { id } : null
  }
}

function createService() {
  const employeeRepo = new FakeEmployeeRepo()
  const deptRepo = new FakeLookupRepo(new Set(['dept-1']))
  const postRepo = new FakeLookupRepo(new Set(['post-1']))
  const service = new SysEmployeeService(
    employeeRepo as never,
    deptRepo as never,
    postRepo as never,
  )
  return { employeeRepo, deptRepo, postRepo, service }
}

const EM = { marker: 'entity-manager' } as unknown as EntityManager

function createPayload(overrides: Record<string, unknown> = {}) {
  return {
    employeeNo: 'E-1',
    employeeName: '职工一',
    deptId: 'dept-1',
    postId: 'post-1',
    entryDate: new Date('2026-01-01T00:00:00.000Z'),
    status: 'active',
    ...overrides,
  } as never
}

function updatePayload(overrides: Record<string, unknown> = {}) {
  return {
    employeeNo: 'E-1',
    employeeName: '职工一',
    deptId: 'dept-1',
    postId: 'post-1',
    entryDate: new Date('2026-01-01T00:00:00.000Z'),
    status: 'active',
    ...overrides,
  } as never
}

function responseOf(error: unknown): Record<string, unknown> {
  return (error as { getResponse: () => Record<string, unknown> }).getResponse()
}

describe('sysEmployeeService 编排契约', () => {
  it('create：工号→部门→岗位依次校验后落库', async () => {
    const { employeeRepo, deptRepo, postRepo, service } = createService()
    const payload = createPayload()

    await expect(service.create(payload)).resolves.toMatchObject({ employeeNo: 'E-1' })

    expect(employeeRepo.calls.map(call => call.method)).toEqual(['findByEmployeeNo', 'create'])
    expect(deptRepo.calls).toEqual(['dept-1'])
    expect(postRepo.calls).toEqual(['post-1'])
  })

  it('create：postId 缺省/null 时跳过岗位校验', async () => {
    for (const postId of [undefined, null]) {
      const { employeeRepo, postRepo, service } = createService()

      await service.create(createPayload({ postId }))

      expect(postRepo.calls).toEqual([])
      expect(employeeRepo.calls.map(call => call.method)).toEqual(['findByEmployeeNo', 'create'])
    }
  })

  it('create：工号已存在 → 40001，且不查部门/岗位、不落库', async () => {
    const { employeeRepo, deptRepo, postRepo, service } = createService()
    employeeRepo.byNo.set('E-1', { id: 'existing', employeeNo: 'E-1' })

    const error = await service.create(createPayload()).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(WalnutAdminExceptionDataExists)

    expect(deptRepo.calls).toEqual([])
    expect(postRepo.calls).toEqual([])
    expect(employeeRepo.calls.map(call => call.method)).toEqual(['findByEmployeeNo'])
  })

  it('create：部门不存在 → 40000(employee.deptNotFound)', async () => {
    const { service } = createService()

    const error = await service.create(createPayload({ deptId: 'missing' })).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(WalnutAdminExceptionBadRequest)
    expect(responseOf(error).errMsg).toBe('business.system.employee.deptNotFound')
  })

  it('create：岗位不存在 → 40000(employee.postNotFound)', async () => {
    const { service } = createService()

    const error = await service.create(createPayload({ postId: 'missing' })).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(WalnutAdminExceptionBadRequest)
    expect(responseOf(error).errMsg).toBe('business.system.employee.postNotFound')
  })

  it('update：工号未变不查唯一性；变更时查；postId 缺省写成 null，userId 不进 payload', async () => {
    const unchanged = createService()
    unchanged.employeeRepo.employees.set('emp-1', { id: 'emp-1', employeeNo: 'E-1', userId: 'user-bound' })

    await unchanged.service.update('emp-1', updatePayload(), EM)

    expect(unchanged.employeeRepo.calls.map(call => call.method)).toEqual(['readById', 'update'])
    const updateCall = unchanged.employeeRepo.calls.find(call => call.method === 'update')!
    expect(updateCall.args[1]).toEqual({
      employeeNo: 'E-1',
      employeeName: '职工一',
      deptId: 'dept-1',
      postId: 'post-1',
      entryDate: new Date('2026-01-01T00:00:00.000Z'),
      status: 'active',
    })
    expect((updateCall.args[1] as Record<string, unknown>).userId).toBeUndefined()
    expect(updateCall.args[2]).toBe(EM)

    // 工号变更 → 走唯一性查重；postId 未给 → null（PUT 整体替换语义）
    const changed = createService()
    changed.employeeRepo.employees.set('emp-1', { id: 'emp-1', employeeNo: 'E-1' })
    await changed.service.update('emp-1', updatePayload({ employeeNo: 'E-2', postId: undefined }), EM)

    expect(changed.employeeRepo.calls.map(call => call.method)).toEqual([
      'readById',
      'findByEmployeeNo',
      'update',
    ])
    const changedUpdate = changed.employeeRepo.calls.find(call => call.method === 'update')!
    expect((changedUpdate.args[1] as Record<string, unknown>).postId).toBeNull()
    expect(changed.postRepo.calls).toEqual([])
  })

  it('update：改成别人的工号 → 40001，不落库', async () => {
    const { employeeRepo, service } = createService()
    employeeRepo.employees.set('emp-1', { id: 'emp-1', employeeNo: 'E-1' })
    employeeRepo.byNo.set('E-2', { id: 'emp-2', employeeNo: 'E-2' })

    const error = await service.update('emp-1', updatePayload({ employeeNo: 'E-2' }), EM).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(WalnutAdminExceptionDataExists)
    expect(employeeRepo.calls.map(call => call.method)).toEqual(['readById', 'findByEmployeeNo'])
  })

  it('bindUser：账号存在且未被占用 → update({ userId })，em 透传', async () => {
    const { employeeRepo, service } = createService()
    employeeRepo.employees.set('emp-1', { id: 'emp-1', employeeNo: 'E-1', userId: null })
    employeeRepo.users.add('user-1')

    await expect(service.bindUser('emp-1', 'user-1', EM)).resolves.toMatchObject({ userId: 'user-1' })

    expect(employeeRepo.calls.map(call => call.method)).toEqual([
      'readById',
      'countUserById',
      'findByUserId',
      'update',
    ])
    const updateCall = employeeRepo.calls.find(call => call.method === 'update')!
    expect(updateCall.args).toEqual(['emp-1', { userId: 'user-1' }, EM])
  })

  it('bindUser：账号不存在 → 40000(userNotFound)', async () => {
    const { employeeRepo, service } = createService()
    employeeRepo.employees.set('emp-1', { id: 'emp-1', employeeNo: 'E-1' })

    const error = await service.bindUser('emp-1', 'missing-user', EM).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(WalnutAdminExceptionBadRequest)
    expect(responseOf(error).errMsg).toBe('business.system.employee.userNotFound')
    expect(employeeRepo.calls.map(call => call.method)).toEqual(['readById', 'countUserById'])
  })

  it('bindUser：账号已被其他职工绑定 → 40001；同一职工重复绑定幂等', async () => {
    const occupied = createService()
    occupied.employeeRepo.employees.set('emp-1', { id: 'emp-1', employeeNo: 'E-1' })
    occupied.employeeRepo.users.add('user-1')
    occupied.employeeRepo.byUserId.set('user-1', { id: 'emp-other', employeeNo: 'E-OTHER' })

    const error = await occupied.service.bindUser('emp-1', 'user-1', EM).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(WalnutAdminExceptionDataExists)
    expect(occupied.employeeRepo.calls.map(call => call.method)).toEqual([
      'readById',
      'countUserById',
      'findByUserId',
    ])

    const self = createService()
    self.employeeRepo.employees.set('emp-1', { id: 'emp-1', employeeNo: 'E-1' })
    self.employeeRepo.users.add('user-1')
    self.employeeRepo.byUserId.set('user-1', { id: 'emp-1', employeeNo: 'E-1' })

    await expect(self.service.bindUser('emp-1', 'user-1', EM)).resolves.toMatchObject({ id: 'emp-1' })
  })

  it('unbindUser：已绑定 → update({ userId: null })；未绑定 → 原行返回且不写', async () => {
    const bound = createService()
    bound.employeeRepo.employees.set('emp-1', { id: 'emp-1', employeeNo: 'E-1', userId: 'user-1' })

    await expect(bound.service.unbindUser('emp-1', EM)).resolves.toMatchObject({ userId: null })
    expect(bound.employeeRepo.calls.map(call => call.method)).toEqual(['readById', 'update'])
    expect(bound.employeeRepo.calls[1].args).toEqual(['emp-1', { userId: null }, EM])

    const unbound = createService()
    unbound.employeeRepo.employees.set('emp-1', { id: 'emp-1', employeeNo: 'E-1', userId: null })

    await expect(unbound.service.unbindUser('emp-1', EM)).resolves.toMatchObject({ userId: null })
    expect(unbound.employeeRepo.calls.map(call => call.method)).toEqual(['readById'])
  })

  it('delete / list 透传（含 em）', async () => {
    const { employeeRepo, service } = createService()
    const listPayload = { page: { page: 1, pageSize: 10 } } as never

    await expect(service.delete('emp-1', 'user-1', EM)).resolves.toBe(true)
    await expect(service.list(listPayload)).resolves.toEqual({ data: [], total: 0 })

    expect(employeeRepo.calls).toEqual([
      { method: 'deleteSoftById', args: ['emp-1', 'user-1', EM] },
      { method: 'list', args: [listPayload] },
    ])
  })
})
