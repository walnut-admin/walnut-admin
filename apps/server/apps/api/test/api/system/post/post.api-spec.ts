import type { NestExpressApplication } from '@nestjs/platform-express'
import type { WalnutRootUserFixture } from '../../helpers/auth-login'
import { randomUUID } from 'node:crypto'
import { WalnutModelName } from '@walnut-server/db'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { bodyOf, expectOk, WalnutApiClient } from '../../helpers/api-client'
import { performHttpOpaqueLogin, registerRootUserFixture } from '../../helpers/auth-login'
import { createApiApp } from '../../helpers/create-api-app'

/**
 * `system/post` —— 岗位模块（平表，真实 HTTP 全链）：
 * CRUD 闭环 + 业务键唯一（uq_post_code → 40001）+ 有职工时删除受控（FK RESTRICT）
 * + 软删进回收站（SYS_POST 快照）。
 */

interface PostRow {
  id: string
  postCode?: string
  postName?: string
  sortOrder?: number
  status?: string
  remark?: string | null
}

describe('组织基础表：system/post CRUD + 唯一键 + RESTRICT（真实 HTTP 全链）', () => {
  let app: NestExpressApplication
  let api: WalnutApiClient

  const seed8 = randomUUID().slice(0, 8)
  const postPrefix = `apispec-post-${seed8}`
  const deptPrefix = `apispec-postdept-${seed8}`
  const employeePrefix = `apispec-postemp-${seed8}`
  let fixture: WalnutRootUserFixture | null = null

  function postPayload(tag: string, overrides: Record<string, unknown> = {}) {
    return {
      postCode: `${postPrefix}-${tag}`,
      postName: `岗位 ${tag}`,
      sortOrder: 1,
      status: 'enabled',
      remark: null,
      ...overrides,
    }
  }

  async function createPost(tag: string, overrides: Record<string, unknown> = {}): Promise<PostRow> {
    const res = await api.root('POST', api.apiPath('/system/post'), postPayload(tag, overrides))
    expectOk(res, `post create ${tag}`)
    return bodyOf<PostRow>(res).data
  }

  async function purgeRows() {
    await api.pgDataSource.query('DELETE FROM sys_employee WHERE employee_no LIKE $1', [`${employeePrefix}%`])
    await api.pgDataSource.query('DELETE FROM sys_post WHERE post_code LIKE $1', [`${postPrefix}%`])
    await api.pgDataSource.query('DELETE FROM sys_dept WHERE dept_code LIKE $1', [`${deptPrefix}%`])
    await api.pgDataSource.query('DELETE FROM sys_deleted WHERE content->>\'postCode\' LIKE $1', [`${postPrefix}%`])
    await api.pgDataSource.query('DELETE FROM sys_deleted WHERE content->>\'employeeNo\' LIKE $1', [`${employeePrefix}%`])
    await api.pgDataSource.query('DELETE FROM sys_deleted WHERE content->>\'deptCode\' LIKE $1', [`${deptPrefix}%`])
  }

  beforeAll(async () => {
    app = await createApiApp()
    api = await WalnutApiClient.create(app)

    fixture = await registerRootUserFixture(app, api.pgDataSource, `post-${seed8}`)
    const tokens = await performHttpOpaqueLogin(api, app, fixture)
    api.setAuth(tokens)
    await api.seedMfaVerifiedCache(fixture.userId)
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

  it('CRUD 闭环：create → read → update → list（remark 可空往返）', async () => {
    const created = await createPost('R1', { remark: '负责技术架构', sortOrder: 5 })

    const readRes = await api.root('GET', api.apiPath(`/system/post/${created.id}`))
    expectOk(readRes, 'post read')
    const read = bodyOf<PostRow>(readRes).data
    expect(read.postCode).toBe(`${postPrefix}-R1`)
    expect(read.postName).toBe('岗位 R1')
    expect(read.remark).toBe('负责技术架构')
    expect(read.sortOrder).toBe(5)
    expect(read.status).toBe('enabled')

    // PUT 整体替换：必填核（postCode/postName/status）全量回填
    const updateRes = await api.root('PUT', api.apiPath(`/system/post/${created.id}`), {
      postCode: `${postPrefix}-R1`,
      postName: '岗位 R1 改名',
      remark: null,
      status: 'disabled',
    })
    expectOk(updateRes, 'post update')
    const updated = bodyOf<PostRow>(updateRes).data
    expect(updated.postName).toBe('岗位 R1 改名')
    expect(updated.remark).toBeNull()
    expect(updated.status).toBe('disabled')
    expect(updated.sortOrder).toBe(5)

    const listRes = await api.root('POST', api.apiPath('/system/post/list'), {
      filters: [{ field: 'postCode', op: 'like', value: `${postPrefix}-R1` }],
      page: { page: 1, pageSize: 10 },
    })
    expectOk(listRes, 'post list')
    const list = bodyOf<{ data: PostRow[], total: number }>(listRes).data
    expect(list.total).toBe(1)
    expect(list.data[0].id).toBe(created.id)
  })

  it('业务键唯一：post_code 重复 → 40001（create 与 update 两条腿）', async () => {
    await createPost('U1')
    const another = await createPost('U2')

    const dupCreate = await api.root('POST', api.apiPath('/system/post'), postPayload('U1'))
    expect(bodyOf(dupCreate).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_EXISTS)

    const dupUpdate = await api.root('PUT', api.apiPath(`/system/post/${another.id}`), postPayload('U2', {
      postCode: `${postPrefix}-U1`,
    }))
    expect(bodyOf(dupUpdate).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_EXISTS)
  })

  it('RESTRICT：有职工时删除 → 40000；职工清掉后软删进回收站', async () => {
    const post = await createPost('D1')

    const deptRes = await api.root('POST', api.apiPath('/system/dept'), {
      deptCode: `${deptPrefix}-D1`,
      deptName: '岗位删除测试部门',
      status: 'enabled',
    })
    expectOk(deptRes, 'dept for post delete')
    const dept = bodyOf<{ id: string }>(deptRes).data

    const employeeRes = await api.root('POST', api.apiPath('/system/employee'), {
      employeeNo: `${employeePrefix}-D1`,
      employeeName: '岗位删除测试职工',
      deptId: dept.id,
      postId: post.id,
      entryDate: '2026-01-01T00:00:00.000Z',
      status: 'active',
    })
    expectOk(employeeRes, 'employee for post delete')
    const employee = bodyOf<{ id: string }>(employeeRes).data

    const blocked = await api.root('DELETE', api.apiPath(`/system/post/${post.id}`))
    expect(bodyOf(blocked).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)

    const deleteEmployee = await api.root('DELETE', api.apiPath(`/system/employee/${employee.id}`))
    expectOk(deleteEmployee, 'employee delete before post')

    const deletePost = await api.root('DELETE', api.apiPath(`/system/post/${post.id}`))
    expectOk(deletePost, 'post delete')

    const left: Array<{ c: number }> = await api.pgDataSource.query(
      'SELECT count(*)::int AS c FROM sys_post WHERE id = $1',
      [post.id],
    )
    expect(left[0].c).toBe(0)

    const snapshots: Array<{ model_name: string }> = await api.pgDataSource.query(
      'SELECT model_name FROM sys_deleted WHERE deleted_id = $1',
      [post.id],
    )
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0].model_name).toBe(WalnutModelName.SYS_POST)
  })

  it('read 不存在的 uuid → 40401', async () => {
    const readRes = await api.root('GET', api.apiPath(`/system/post/${randomUUID()}`))
    expect(bodyOf(readRes).code).toBe(WalnutAdminConstAppResponseCode.NOT_FOUND_DATA_NOT_FOUND)
  })
})
