import type { NestExpressApplication } from '@nestjs/platform-express'
import type { WalnutRootUserFixture } from './helpers/auth-login'
import type { SeedPermissionChainFixture } from './helpers/seed-permissions'
import { randomUUID } from 'node:crypto'
import { WalnutModelName } from '@walnut-server/db'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { bodyOf, expectOk, WalnutApiClient } from './helpers/api-client'
import { performHttpOpaqueLogin, registerRootUserFixture } from './helpers/auth-login'
import { createApiApp } from './helpers/create-api-app'
import { cleanupPermissionChainSeed, seedPermissionChainUser } from './helpers/seed-permissions'

/**
 * `system/dept` —— 组织基础表的部门模块（真实 HTTP 全链）。
 *
 * 覆盖：
 * - CRUD 闭环（create/read/update/list/delete 软删）+ 业务键唯一（uq_dept_code → 40001）；
 * - 树能力三层：`GET tree`（全量嵌套）/ `GET children?parentId=`（按父查一层）/
 *   `GET :id/subtree`（递归 CTE + CYCLE，出参含 children）；
 * - 防环：把父部门挂到自己的后代下 → 40000；
 * - RESTRICT：有子部门 / 有职工时删除 → 40000（FK 兜底，业务前置给受控错误）；
 * - 软删进回收站：sys_deleted 落 SYS_DEPT 快照；
 * - 权限：非 root 无权限点 → 40105，root 短路放行（真实缓存链路，I 段种子助手）。
 */

interface DeptRow {
  id: string
  parentId?: string | null
  deptCode?: string
  deptName?: string
  leader?: string | null
  email?: string | null
  sortOrder?: number
  status?: string
  children?: DeptRow[]
}

interface TreeNode extends DeptRow {
  children?: TreeNode[]
}

describe('组织基础表：system/dept CRUD + 树 + RESTRICT + 权限（真实 HTTP 全链）', () => {
  let app: NestExpressApplication
  let api: WalnutApiClient

  const seed8 = randomUUID().slice(0, 8)
  const deptPrefix = `apispec-dept-${seed8}`
  const employeePrefix = `apispec-emp-${seed8}`
  let fixture: WalnutRootUserFixture | null = null

  // 权限用例的非 root 用户（无任何权限点）
  let deniedUser: WalnutApiClient | null = null
  let deniedFixture: SeedPermissionChainFixture | null = null

  function deptPayload(tag: string, overrides: Record<string, unknown> = {}) {
    return {
      parentId: null,
      deptCode: `${deptPrefix}-${tag}`,
      deptName: `部门 ${tag}`,
      leader: null,
      phone: null,
      email: null,
      sortOrder: 1,
      status: 'enabled',
      ...overrides,
    }
  }

  async function createDept(tag: string, overrides: Record<string, unknown> = {}): Promise<DeptRow> {
    const res = await api.root('POST', api.apiPath('/system/dept'), deptPayload(tag, overrides))
    expectOk(res, `dept create ${tag}`)
    return bodyOf<DeptRow>(res).data
  }

  async function createEmployee(deptId: string, tag: string) {
    const res = await api.root('POST', api.apiPath('/system/employee'), {
      employeeNo: `${employeePrefix}-${tag}`,
      employeeName: `职工 ${tag}`,
      deptId,
      entryDate: '2026-01-01T00:00:00.000Z',
      status: 'active',
    })
    expectOk(res, `employee create ${tag}`)
    return bodyOf<{ id: string }>(res).data
  }

  function findNode(nodes: TreeNode[], deptCode: string): TreeNode | null {
    for (const node of nodes) {
      if (node.deptCode === deptCode) {
        return node
      }
      if (node.children !== undefined && node.children.length > 0) {
        const hit = findNode(node.children, deptCode)
        if (hit !== null) {
          return hit
        }
      }
    }
    return null
  }

  /** FK 安全清理：先删职工，再由叶到根逐层删部门（单条 DELETE 的行序不保证） */
  async function purgeDeptRows() {
    await api.pgDataSource.query('DELETE FROM sys_employee WHERE employee_no LIKE $1', [`${employeePrefix}%`])

    for (let i = 0; i < 10; i++) {
      const left: Array<{ c: number }> = await api.pgDataSource.query(
        'SELECT count(*)::int AS c FROM sys_dept WHERE dept_code LIKE $1',
        [`${deptPrefix}%`],
      )
      if (left[0].c === 0) {
        return
      }
      await api.pgDataSource.query(
        'DELETE FROM sys_dept d WHERE d.dept_code LIKE $1 AND NOT EXISTS (SELECT 1 FROM sys_dept c WHERE c.parent_id = d.id)',
        [`${deptPrefix}%`],
      )
    }
  }

  beforeAll(async () => {
    app = await createApiApp()
    api = await WalnutApiClient.create(app)

    fixture = await registerRootUserFixture(app, api.pgDataSource, `dept-${seed8}`)
    const tokens = await performHttpOpaqueLogin(api, app, fixture)
    api.setAuth(tokens)
    await api.seedMfaVerifiedCache(fixture.userId)

    // 非 root、无任何权限点的真实登录用户（权限缓存写空数组后仍 40105）
    deniedFixture = await seedPermissionChainUser(app, api.pgDataSource, {
      userNamePrefix: `dept-denied-${seed8}`,
      grantedPermissions: [],
    })
    deniedUser = await WalnutApiClient.create(app)
    const deniedTokens = await performHttpOpaqueLogin(deniedUser, app, deniedFixture)
    deniedUser.setAuth(deniedTokens)
    await deniedUser.seedMfaVerifiedCache(deniedFixture.userId)
  })

  afterEach(async () => {
    await purgeDeptRows()
    await api.pgDataSource.query('DELETE FROM sys_deleted WHERE content->>\'deptCode\' LIKE $1', [`${deptPrefix}%`])
    await api.pgDataSource.query('DELETE FROM sys_deleted WHERE content->>\'employeeNo\' LIKE $1', [`${employeePrefix}%`])
  })

  afterAll(async () => {
    if (api !== undefined && fixture !== null) {
      await purgeDeptRows()
      await api.pgDataSource.query('DELETE FROM sys_deleted WHERE content->>\'deptCode\' LIKE $1', [`${deptPrefix}%`])
      await api.pgDataSource.query('DELETE FROM sys_user WHERE id = $1', [fixture.userId])
      await api.pgDataSource.query('DELETE FROM sys_role WHERE id = $1', [fixture.roleId])
      await api.pgDataSource.query('DELETE FROM sys_device WHERE device_id = $1', [api.deviceId])

      if (deniedUser !== null && deniedFixture !== null) {
        await cleanupPermissionChainSeed(api, [deniedFixture], [deniedUser.deviceId])
      }
      await api.cleanupWalnutCacheKeys(seed8, api.deviceId, fixture.userId)
    }
    await app.close()
  })

  it('CRUD 闭环：create → read → update → list（业务键 + 可空联系方式往返）', async () => {
    const created = await createDept('R1', {
      leader: '张三',
      phone: '010-12345678',
      email: 'dept-r1@example.com',
      sortOrder: 7,
    })

    const readRes = await api.root('GET', api.apiPath(`/system/dept/${created.id}`))
    expectOk(readRes, 'dept read')
    const read = bodyOf<DeptRow>(readRes).data
    expect(read.parentId).toBeNull()
    expect(read.deptCode).toBe(`${deptPrefix}-R1`)
    expect(read.deptName).toBe('部门 R1')
    expect(read.leader).toBe('张三')
    expect(read.email).toBe('dept-r1@example.com')
    expect(read.sortOrder).toBe(7)
    expect(read.status).toBe('enabled')

    // PUT 整体替换：必填核（deptCode/deptName/status）全量回填
    const updateRes = await api.root('PUT', api.apiPath(`/system/dept/${created.id}`), {
      deptCode: `${deptPrefix}-R1`,
      deptName: '部门 R1 改名',
      leader: null,
      status: 'disabled',
    })
    expectOk(updateRes, 'dept update')
    const updated = bodyOf<DeptRow>(updateRes).data
    expect(updated.deptName).toBe('部门 R1 改名')
    expect(updated.leader).toBeNull()
    expect(updated.status).toBe('disabled')
    // PUT 整体替换：缺省的可空字段被清空（email 未回填 → null）
    expect(updated.email).toBeNull()

    const listRes = await api.root('POST', api.apiPath('/system/dept/list'), {
      query: { deptCode: `${deptPrefix}-R1` },
      page: { page: 1, pageSize: 10 },
    })
    expectOk(listRes, 'dept list')
    const list = bodyOf<{ data: DeptRow[], total: number }>(listRes).data
    expect(list.total).toBe(1)
    expect(list.data[0].id).toBe(created.id)

    // 非法状态值 → 40099（IsEnum）
    const badStatus = await api.root('POST', api.apiPath('/system/dept'), deptPayload('R2', { status: 'frozen' }))
    expect(bodyOf(badStatus).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)
  })

  it('树能力：tree 嵌套 / children 按父查一层 / subtree 递归 CTE 子树', async () => {
    const parent = await createDept('T1', { sortOrder: 1 })
    const child = await createDept('T2', { parentId: parent.id, sortOrder: 2 })
    const grandchild = await createDept('T3', { parentId: child.id, sortOrder: 3 })

    const treeRes = await api.root('GET', api.apiPath('/system/dept/tree'))
    expectOk(treeRes, 'dept tree')
    const tree = bodyOf<TreeNode[]>(treeRes).data
    const parentNode = findNode(tree, `${deptPrefix}-T1`)
    expect(parentNode?.id).toBe(parent.id)
    expect(parentNode?.children?.[0]?.id).toBe(child.id)
    expect(parentNode?.children?.[0]?.children?.[0]?.id).toBe(grandchild.id)

    // children 按父查一层（根层缺省 → parent 属于根层）
    const rootRes = await api.root('GET', api.apiPath('/system/dept/children'))
    expectOk(rootRes, 'dept children root')
    const roots = bodyOf<DeptRow[]>(rootRes).data
    expect(roots.some(n => n.id === parent.id)).toBe(true)
    expect(roots.some(n => n.id === child.id)).toBe(false)

    const childrenRes = await api.root('GET', api.apiPath(`/system/dept/children?parentId=${parent.id}`))
    expectOk(childrenRes, 'dept children by parent')
    const children = bodyOf<DeptRow[]>(childrenRes).data
    expect(children.map(n => n.id)).toEqual([child.id])

    // 非法 parentId → 40002
    const badChildren = await api.root('GET', api.apiPath('/system/dept/children?parentId=not-a-uuid'))
    expect(bodyOf(badChildren).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_INVALID_ID)

    // 递归 CTE 子树：根带两层 children
    const subtreeRes = await api.root('GET', api.apiPath(`/system/dept/${parent.id}/subtree`))
    expectOk(subtreeRes, 'dept subtree')
    const subtree = bodyOf<TreeNode>(subtreeRes).data
    expect(subtree.id).toBe(parent.id)
    expect(subtree.children?.[0]?.id).toBe(child.id)
    expect(subtree.children?.[0]?.children?.[0]?.id).toBe(grandchild.id)

    // 防环：把父部门挂到自己的孙部门下 → 40000
    const cycleRes = await api.root('PUT', api.apiPath(`/system/dept/${parent.id}`), deptPayload('T1', {
      parentId: grandchild.id,
    }))
    expect(bodyOf(cycleRes).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)

    // 自身为父 → 40000
    const selfRes = await api.root('PUT', api.apiPath(`/system/dept/${parent.id}`), deptPayload('T1', {
      parentId: parent.id,
    }))
    expect(bodyOf(selfRes).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)
  })

  it('业务键唯一：dept_code 重复 → 40001；父部门不存在 → 40000', async () => {
    await createDept('U1')

    const dup = await api.root('POST', api.apiPath('/system/dept'), deptPayload('U1'))
    expect(bodyOf(dup).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_EXISTS)

    const missingParent = await api.root('POST', api.apiPath('/system/dept'), deptPayload('U2', {
      parentId: randomUUID(),
    }))
    expect(bodyOf(missingParent).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)

    // 更新成已存在的编码同样受控
    const another = await createDept('U3')
    const dupUpdate = await api.root('PUT', api.apiPath(`/system/dept/${another.id}`), deptPayload('U3', {
      deptCode: `${deptPrefix}-U1`,
    }))
    expect(bodyOf(dupUpdate).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_EXISTS)
  })

  it('RESTRICT：有子部门 / 有职工时删除 → 40000；清空后软删进回收站', async () => {
    const parent = await createDept('D1')
    const child = await createDept('D2', { parentId: parent.id })

    const hasChildren = await api.root('DELETE', api.apiPath(`/system/dept/${parent.id}`))
    expect(bodyOf(hasChildren).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)

    // 子部门上挂职工 → 删子部门被职工拦住
    const employee = await createEmployee(child.id, 'D2')
    const hasEmployees = await api.root('DELETE', api.apiPath(`/system/dept/${child.id}`))
    expect(bodyOf(hasEmployees).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST)

    // 软删职工 → 子部门可删（软删进回收站）
    const deleteEmployee = await api.root('DELETE', api.apiPath(`/system/employee/${employee.id}`))
    expectOk(deleteEmployee, 'employee delete before dept')

    const deleteChild = await api.root('DELETE', api.apiPath(`/system/dept/${child.id}`))
    expectOk(deleteChild, 'dept delete child')

    const leftChild: Array<{ c: number }> = await api.pgDataSource.query(
      'SELECT count(*)::int AS c FROM sys_dept WHERE id = $1',
      [child.id],
    )
    expect(leftChild[0].c).toBe(0)

    const snapshots: Array<{ model_name: string }> = await api.pgDataSource.query(
      'SELECT model_name FROM sys_deleted WHERE deleted_id = $1',
      [child.id],
    )
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0].model_name).toBe(WalnutModelName.SYS_DEPT)

    const deleteParent = await api.root('DELETE', api.apiPath(`/system/dept/${parent.id}`))
    expectOk(deleteParent, 'dept delete parent')
  })

  it('权限：非 root 无权限点 → 40105；root 短路放行', async () => {
    expect(deniedUser).not.toBeNull()
    expect(deniedFixture).not.toBeNull()

    // 真实权限链路：先拉权限（写 AUTH:PERMISSIONS 缓存），再访问受保护端点
    const permissionsRes = await deniedUser!.root('GET', deniedUser!.apiPath('/auth/permissions'))
    expectOk(permissionsRes, 'denied user permissions')

    const denied = await deniedUser!.root('POST', deniedUser!.apiPath('/system/dept/list'), {
      page: { page: 1, pageSize: 10 },
    })
    expect(bodyOf(denied).code).toBe(WalnutAdminConstAppResponseCode.UNAUTHORIZED_NO_PERMISSION)

    // root 短路：同一端点 20000
    const granted = await api.root('POST', api.apiPath('/system/dept/list'), {
      page: { page: 1, pageSize: 10 },
    })
    expectOk(granted, 'root dept list')
  })
})
