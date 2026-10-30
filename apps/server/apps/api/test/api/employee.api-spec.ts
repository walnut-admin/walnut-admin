import type { NestExpressApplication } from '@nestjs/platform-express'
import type { WalnutRootUserFixture } from './helpers/auth-login'
import { randomUUID } from 'node:crypto'
import { WalnutModelName } from '@walnut-server/db'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { bodyOf, expectOk, WalnutApiClient } from './helpers/api-client'
import { performHttpOpaqueLogin, registerRootUserFixture } from './helpers/auth-login'
import { createApiApp } from './helpers/create-api-app'

/**
 * `system/employee` —— 职工模块（人事记录，真实 HTTP 全链）：
 * CRUD 闭环 + 工号唯一（uq_employee_no → 40001）+ 账号绑定/解绑闭环
 * （一号一职工：partial unique uq_employee_user + 服务层前置查重）+ 离职状态语义
 * （resigned 不删账号、不自动解绑）+ 软删进回收站（SYS_EMPLOYEE 快照）。
 *
 * 绑定用 root fixture 自己的 userId 作靶子（真实存在的账号行）；解绑后不留引用。
 */

interface EmployeeRow {
  id: string
  employeeNo?: string
  employeeName?: string
  deptId?: string
  postId?: string | null
  userId?: string | null
  status?: string
}

describe('组织基础表：system/employee CRUD + 绑定解绑 + 一号一职工（真实 HTTP 全链）', () => {
  let app: NestExpressApplication
  let api: WalnutApiClient

  const seed8 = randomUUID().slice(0, 8)
  const employeePrefix = `apispec-employee-${seed8}`
  const deptPrefix = `apispec-empdept-${seed8}`
  const postPrefix = `apispec-emppost-${seed8}`
  let fixture: WalnutRootUserFixture | null = null

  let deptId = ''
  let postId = ''

  function employeePayload(tag: string, overrides: Record<string, unknown> = {}) {
    return {
      employeeNo: `${employeePrefix}-${tag}`,
      employeeName: `职工 ${tag}`,
      deptId,
      postId,
      entryDate: '2026-01-01T00:00:00.000Z',
      status: 'active',
      ...overrides,
    }
  }

  async function createEmployee(tag: string, overrides: Record<string, unknown> = {}): Promise<EmployeeRow> {
    const res = await api.root('POST', api.apiPath('/system/employee'), employeePayload(tag, overrides))
    expectOk(res, `employee create ${tag}`)
    return bodyOf<EmployeeRow>(res).data
  }

  async function purgeRows() {
    await api.pgDataSource.query('DELETE FROM sys_employee WHERE employee_no LIKE $1', [`${employeePrefix}%`])
    await api.pgDataSource.query('DELETE FROM sys_post WHERE post_code LIKE $1', [`${postPrefix}%`])
    await api.pgDataSource.query('DELETE FROM sys_dept WHERE dept_code LIKE $1', [`${deptPrefix}%`])
    await api.pgDataSource.query('DELETE FROM sys_deleted WHERE content->>\'employeeNo\' LIKE $1', [`${employeePrefix}%`])
    await api.pgDataSource.query('DELETE FROM sys_deleted WHERE content->>\'postCode\' LIKE $1', [`${postPrefix}%`])
    await api.pgDataSource.query('DELETE FROM sys_deleted WHERE content->>\'deptCode\' LIKE $1', [`${deptPrefix}%`])
  }

  beforeAll(async () => {
    app = await createApiApp()
    api = await WalnutApiClient.create(app)

    fixture = await registerRootUserFixture(app, api.pgDataSource, `employee-${seed8}`)
    const tokens = await performHttpOpaqueLogin(api, app, fixture)
    api.setAuth(tokens)
    await api.seedMfaVerifiedCache(fixture.userId)
  })

  // 载体部门 / 岗位每例现建（afterEach 会按前缀清掉它们，beforeAll 只建一次会被连带清空）
  beforeEach(async () => {
    const deptRes = await api.root('POST', api.apiPath('/system/dept'), {
      deptCode: `${deptPrefix}-main`,
      deptName: '职工测试部门',
      status: 'enabled',
    })
    expectOk(deptRes, 'dept for employee spec')
    deptId = bodyOf<{ id: string }>(deptRes).data.id

    const postRes = await api.root('POST', api.apiPath('/system/post'), {
      postCode: `${postPrefix}-main`,
      postName: '职工测试岗位',
      status: 'enabled',
    })
    expectOk(postRes, 'post for employee spec')
    postId = bodyOf<{ id: string }>(postRes).data.id
  })

  afterEach(async () => {
    await purgeRows()
  })

  afterAll(async () => {
    if (api !== undefined && fixture !== null) {
      await purgeRows()
      await api.pgDataSource.query('DELETE FROM sys_user WHERE id = $1', [fixture.userId])
      await api.pgDataSource.query('DELETE FROM sys_role WHERE id = $1', [fixture.roleId])
      await api.pgDataSource.query('DELETE FROM sys_device WHERE device_id = $1', [api.deviceId])
      await api.cleanupWalnutCacheKeys(seed8, api.deviceId, fixture.userId)
    }
    await app.close()
  })

  it('CRUD 闭环：create（部门/岗位直挂）→ read → update → list', async () => {
    const created = await createEmployee('R1')
    expect(created.deptId).toBe(deptId)
    expect(created.postId).toBe(postId)
    expect(created.userId).toBeNull()
    expect(created.status).toBe('active')

    const readRes = await api.root('GET', api.apiPath(`/system/employee/${created.id}`))
    expectOk(readRes, 'employee read')
    const read = bodyOf<EmployeeRow>(readRes).data
    expect(read.employeeNo).toBe(`${employeePrefix}-R1`)
    expect(read.employeeName).toBe('职工 R1')
    expect(read.deptId).toBe(deptId)
    expect(read.postId).toBe(postId)

    // PUT 整体替换：必填核全量回填（缺省即 null，会被 IsNotEmpty 拦成 40099）
    const updateRes = await api.root('PUT', api.apiPath(`/system/employee/${created.id}`), {
      employeeNo: `${employeePrefix}-R1`,
      employeeName: '职工 R1 改名',
      deptId,
      entryDate: '2026-01-01T00:00:00.000Z',
      // 未定岗：postId 显式置空（可空列）
      postId: null,
      status: 'probation',
    })
    expectOk(updateRes, 'employee update')
    const updated = bodyOf<EmployeeRow>(updateRes).data
    expect(updated.employeeName).toBe('职工 R1 改名')
    expect(updated.postId).toBeNull()
    expect(updated.status).toBe('probation')

    const listRes = await api.root('POST', api.apiPath('/system/employee/list'), {
      query: { employeeNo: `${employeePrefix}-R1` },
      page: { page: 1, pageSize: 10 },
    })
    expectOk(listRes, 'employee list')
    const list = bodyOf<{ data: EmployeeRow[], total: number }>(listRes).data
    expect(list.total).toBe(1)
    expect(list.data[0].id).toBe(created.id)
  })

  it('工号唯一：employee_no 重复 → 40001（create 与 update 两条腿）', async () => {
    await createEmployee('U1')
    const another = await createEmployee('U2')

    const dupCreate = await api.root('POST', api.apiPath('/system/employee'), employeePayload('U1'))
    expect(bodyOf(dupCreate).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_EXISTS)

    const dupUpdate = await api.root('PUT', api.apiPath(`/system/employee/${another.id}`), {
      employeeNo: `${employeePrefix}-U1`,
      employeeName: '职工 U2',
      deptId,
      postId,
      entryDate: '2026-01-01T00:00:00.000Z',
      status: 'active',
    })
    expect(bodyOf(dupUpdate).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_EXISTS)
  })

  it('绑定/解绑账号闭环：bind-user → 一号一职工冲突 → unbind-user 幂等', async () => {
    const first = await createEmployee('B1')
    const second = await createEmployee('B2')

    const bindRes = await api.root('POST', api.apiPath(`/system/employee/${first.id}/bind-user`), {
      userId: fixture!.userId,
    })
    expectOk(bindRes, 'employee bind user')
    expect(bodyOf<EmployeeRow>(bindRes).data.userId).toBe(fixture!.userId)

    // 一号一职工：另一职工绑定同一账号 → 40001
    const conflict = await api.root('POST', api.apiPath(`/system/employee/${second.id}/bind-user`), {
      userId: fixture!.userId,
    })
    expect(bodyOf(conflict).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_EXISTS)

    // 绑定不存在的账号 → 40000（user_id 是松引用，没有 FK 兜底）
    const missingUser = await api.root('POST', api.apiPath(`/system/employee/${second.id}/bind-user`), {
      userId: randomUUID(),
    })
    expect(bodyOf(missingUser).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)

    const unbindRes = await api.root('POST', api.apiPath(`/system/employee/${first.id}/unbind-user`))
    expectOk(unbindRes, 'employee unbind user')
    expect(bodyOf<EmployeeRow>(unbindRes).data.userId).toBeNull()

    // 幂等：未绑定时再解绑仍 20000 且 userId 为 null
    const unbindAgain = await api.root('POST', api.apiPath(`/system/employee/${first.id}/unbind-user`))
    expectOk(unbindAgain, 'employee unbind user again')
    expect(bodyOf<EmployeeRow>(unbindAgain).data.userId).toBeNull()
  })

  it('离职状态语义：resigned 不删账号、不自动解绑；软删进回收站', async () => {
    const bound = await createEmployee('S1')
    const bindRes = await api.root('POST', api.apiPath(`/system/employee/${bound.id}/bind-user`), {
      userId: fixture!.userId,
    })
    expectOk(bindRes, 'employee bind for resign')

    const resignRes = await api.root('PUT', api.apiPath(`/system/employee/${bound.id}`), {
      employeeNo: `${employeePrefix}-S1`,
      employeeName: '职工 S1',
      deptId,
      postId,
      entryDate: '2026-01-01T00:00:00.000Z',
      status: 'resigned',
    })
    expectOk(resignRes, 'employee resign')
    expect(bodyOf<EmployeeRow>(resignRes).data.status).toBe('resigned')
    // 离职不自动解绑
    expect(bodyOf<EmployeeRow>(resignRes).data.userId).toBe(fixture!.userId)

    // 账号本体仍存在（人事状态不驱动账号生命周期）
    const userRows: Array<{ c: number }> = await api.pgDataSource.query(
      'SELECT count(*)::int AS c FROM sys_user WHERE id = $1',
      [fixture!.userId],
    )
    expect(userRows[0].c).toBe(1)

    // 软删：原行消失 + SYS_EMPLOYEE 快照
    const deleteRes = await api.root('DELETE', api.apiPath(`/system/employee/${bound.id}`))
    expectOk(deleteRes, 'employee delete')

    const left: Array<{ c: number }> = await api.pgDataSource.query(
      'SELECT count(*)::int AS c FROM sys_employee WHERE id = $1',
      [bound.id],
    )
    expect(left[0].c).toBe(0)

    const snapshots: Array<{ model_name: string }> = await api.pgDataSource.query(
      'SELECT model_name FROM sys_deleted WHERE deleted_id = $1',
      [bound.id],
    )
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0].model_name).toBe(WalnutModelName.SYS_EMPLOYEE)
  })

  it('引用校验：部门 / 岗位不存在 → 40000', async () => {
    const missingDept = await api.root('POST', api.apiPath('/system/employee'), employeePayload('V1', {
      deptId: randomUUID(),
    }))
    expect(bodyOf(missingDept).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)

    const missingPost = await api.root('POST', api.apiPath('/system/employee'), employeePayload('V2', {
      postId: randomUUID(),
    }))
    expect(bodyOf(missingPost).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)
  })
})
