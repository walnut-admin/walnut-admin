import type { NestExpressApplication } from '@nestjs/platform-express'
import type { WalnutRootUserFixture } from './helpers/auth-login'
import { randomUUID } from 'node:crypto'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bodyOf, expectOk, WalnutApiClient } from './helpers/api-client'
import { performHttpOpaqueLogin, registerRootUserFixture } from './helpers/auth-login'
import { createApiApp } from './helpers/create-api-app'

/**
 * 批次 4-A（D2 段②）：list 入参从 `query: Partial<Entity>` 换成显式 `filters`。
 *
 * 本 spec 是**跨端点的契约面总闸**：20 个 list 端点在同一个文件里逐条验证四件事，
 * 避免每个 api-spec 各写一遍而漏掉某条。
 *
 * | 用例 | 断的是什么 |
 * |------|-----------|
 * | A. 显式 filters 合法 | 新 wire 可用（旧 `query` 的语义现在写成 `{ field, op, value }`） |
 * | B. 未知算子 `gt` | DTO 的 `op` 枚举拒绝 ⇒ **40099**（不再静默丢弃） |
 * | C. 算子与列类型不匹配（`like` 打 uuid 列） | 列类型裁决拒绝 ⇒ **40099**（R1 矩阵 42883 格） |
 * | D. 旧 `query` 槽位 | 顶层白名单拒绝 ⇒ **40099**（破坏性变更必须响亮） |
 *
 * 观测口径：全局异常过滤器恒回 HTTP 200，真实结果只看 `body.code`
 * （崩溃 50000 / 校验拒绝 40099 / 成功 20000）—— 断 HTTP status 会永远“通过”。
 */

interface IListEndpoint {
  /** 端点展示名（describe 文案用） */
  name: string
  path: string
  /** A 用例的合法过滤项：只用**文本列**（like 对所有端点安全，未知字段按列白名单丢弃） */
  validFilters: Array<{ field: string, op: string, value?: unknown }>
  /**
   * C 用例：该端点的实体是否有 uuid 主键 `id` 且走 QueryBuilder 主线。
   * logger（日志文件列表）与 cache（Redis 内存列表）不走 SQL，没有列类型裁决面。
   */
  columnTypeRejection: boolean
}

const ENDPOINTS: IListEndpoint[] = [
  { name: 'app/demo', path: '/app/demo/list', validFilters: [{ field: 'demoString', op: 'like', value: 'api' }], columnTypeRejection: true },
  { name: 'app/logger', path: '/app/logger/list', validFilters: [{ field: 'fileName', op: 'like', value: 'log' }], columnTypeRejection: false },
  { name: 'app/monitor/cache', path: '/app/monitor/cache/list', validFilters: [], columnTypeRejection: false },
  { name: 'app/monitor/user', path: '/app/monitor/user/list', validFilters: [{ field: 'userName', op: 'like', value: 'a' }], columnTypeRejection: true },
  { name: 'app/setting', path: '/app/setting/list', validFilters: [{ field: 'settingKey', op: 'like', value: 'app.' }], columnTypeRejection: true },
  { name: 'system/user', path: '/system/user/list', validFilters: [{ field: 'userName', op: 'like', value: 'root' }], columnTypeRejection: true },
  { name: 'system/role', path: '/system/role/list', validFilters: [{ field: 'roleName', op: 'like', value: 'root' }], columnTypeRejection: true },
  { name: 'system/dept', path: '/system/dept/list', validFilters: [{ field: 'deptCode', op: 'like', value: 'A' }], columnTypeRejection: true },
  { name: 'system/post', path: '/system/post/list', validFilters: [{ field: 'postCode', op: 'like', value: 'a' }], columnTypeRejection: true },
  { name: 'system/dict/type', path: '/system/dict/type/list', validFilters: [{ field: 'type', op: 'like', value: 'sys' }], columnTypeRejection: true },
  { name: 'system/dict/data', path: '/system/dict/data/list', validFilters: [{ field: 'label', op: 'like', value: 'dict' }], columnTypeRejection: true },
  { name: 'system/employee', path: '/system/employee/list', validFilters: [{ field: 'employeeNo', op: 'like', value: 'e' }], columnTypeRejection: true },
  { name: 'system/lang', path: '/system/lang/list', validFilters: [{ field: 'lang', op: 'like', value: 'en' }], columnTypeRejection: true },
  { name: 'system/locale', path: '/system/locale/list', validFilters: [{ field: 'key', op: 'like', value: 'app' }], columnTypeRejection: true },
  { name: 'system/menu', path: '/system/menu/list', validFilters: [{ field: 'name', op: 'like', value: 'a' }], columnTypeRejection: true },
  { name: 'system/device', path: '/system/device/list', validFilters: [{ field: 'deviceName', op: 'like', value: 'api' }], columnTypeRejection: true },
  { name: 'system/deleted', path: '/system/deleted/list', validFilters: [{ field: 'content', op: 'like', value: 'api' }], columnTypeRejection: true },
  { name: 'system/log/auth', path: '/system/log/auth/list', validFilters: [{ field: 'deviceId', op: 'like', value: 'api' }], columnTypeRejection: true },
  { name: 'system/log/operate', path: '/system/log/operate/list', validFilters: [{ field: 'deviceId', op: 'like', value: 'api' }], columnTypeRejection: true },
]

describe('批次 4-A：list 显式 filters wire（20 个端点 × 新旧映射）', () => {
  let app: NestExpressApplication
  let api: WalnutApiClient
  let fixture: WalnutRootUserFixture | null = null

  const seed8 = randomUUID().slice(0, 8)

  /**
   * 只带 filters，**不带 sort** —— 各端点的 sort 白名单（`sortOnlyIn`）不一样，
   * 带上 createdAt 会让部分端点在 sort 槽位先 40099，掩盖 filters 侧的结论。
   */
  function listBody(filters: unknown[]): Record<string, unknown> {
    return {
      filters,
      sort: [],
      page: { page: 1, pageSize: 5 },
    }
  }

  beforeAll(async () => {
    app = await createApiApp()
    api = await WalnutApiClient.create(app)

    fixture = await registerRootUserFixture(app, api.pgDataSource, `listfilters-${seed8}`)
    const tokens = await performHttpOpaqueLogin(api, app, fixture)
    api.setAuth(tokens)
    await api.seedMfaVerifiedCache(fixture.userId)
  })

  afterAll(async () => {
    if (api !== undefined && fixture !== null) {
      await api.pgDataSource.query('DELETE FROM sys_user WHERE id = $1', [fixture.userId])
      await api.pgDataSource.query('DELETE FROM sys_role WHERE id = $1', [fixture.roleId])
      await api.pgDataSource.query('DELETE FROM sys_device WHERE device_id = $1', [api.deviceId])
      await api.cleanupWalnutCacheKeys(seed8, api.deviceId, fixture.userId)
    }
    await app.close()
  })

  async function statusOf(path: string, body: Record<string, unknown>) {
    return api.root('POST', api.apiPath(path), body)
  }

  describe('A · 显式 filters 合法（旧 query 语义 → { field, op, value }）', () => {
    it.each(ENDPOINTS)('$name 接受显式 filters', async ({ path, validFilters }) => {
      const res = await statusOf(path, listBody(validFilters))

      expectOk(res, `list ${path} with filters`)
      // 恒有 data/total 两键（分页壳不因 wire 变化而变）
      const data = bodyOf<{ data?: unknown[], total?: number }>(res).data
      expect(Array.isArray(data.data)).toBe(true)
      expect(typeof data.total).toBe('number')
    })
  })

  describe('B · 未知算子 ⇒ 40099（DTO 枚举，不再静默丢弃）', () => {
    it.each(ENDPOINTS)('$name 拒绝 op=gt', async ({ path }) => {
      const res = await statusOf(path, listBody([{ field: 'createdAt', op: 'gt', value: 'x' }]))

      expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)
    })
  })

  describe('C · 算子与列类型不匹配 ⇒ 40099（R1 矩阵 42883 格）', () => {
    it.each(ENDPOINTS.filter(e => e.columnTypeRejection))('$name 拒绝 like 打 uuid 主键', async ({ path }) => {
      const res = await statusOf(path, listBody([{ field: 'id', op: 'like', value: 'abc' }]))

      expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)
    })
  })

  describe('D · 旧 query 槽位 ⇒ 40099（破坏性变更必须响亮）', () => {
    it.each(ENDPOINTS)('$name 拒绝旧的 query 对象', async ({ path }) => {
      const res = await statusOf(path, {
        query: { userName: 'x' },
        page: { page: 1, pageSize: 5 },
      })

      expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)
    })
  })

  describe('E · 空 filters 与缺省等价（既有调用面不破）', () => {
    it('filters: [] 与完全不带 filters 都回 20000', async () => {
      const withEmpty = await statusOf('/system/user/list', listBody([]))
      expectOk(withEmpty, 'user list filters=[]')

      const withoutFilters = await statusOf('/system/user/list', { page: { page: 1, pageSize: 5 } })
      expectOk(withoutFilters, 'user list without filters')

      expect(bodyOf<{ total: number }>(withEmpty).data.total)
        .toBe(bodyOf<{ total: number }>(withoutFilters).data.total)
    })
  })

  describe('F · 排序稳定性（D15：默认排序追加主键兜底）', () => {
    it('同毫秒多行在 created_at 排序下不重不漏（逐页拼回 = 一次取全）', async () => {
      // 用 user 列表的真实行：分页 1 行 × N 页拼回，与一次取 N 行比较 id 集合
      const oneShot = await statusOf('/system/user/list', {
        filters: [],
        sort: [{ field: 'createdAt', order: 'descend', priority: 1 }],
        page: { page: 1, pageSize: 50 },
      })
      expectOk(oneShot, 'user list one shot')
      const ids = bodyOf<{ data: Array<{ id: string }> }>(oneShot).data.data.map(i => i.id)

      const paged: string[] = []
      for (let page = 1; page <= Math.min(ids.length, 5); page++) {
        const res = await statusOf('/system/user/list', {
          filters: [],
          sort: [{ field: 'createdAt', order: 'descend', priority: 1 }],
          page: { page, pageSize: 1 },
        })
        expectOk(res, `user list page ${page}`)
        paged.push(...bodyOf<{ data: Array<{ id: string }> }>(res).data.data.map(i => i.id))
      }

      // 逐页拼回的顺序必须与一次取全的前缀逐项相等（有全序才可能成立）
      expect(paged).toEqual(ids.slice(0, paged.length))
    })
  })

  describe('G · 字典布尔值（`sys_shared_status` 的 "true"/"false"）筛选布尔列', () => {
    // 表头的真实 wire：`status` 列的筛选项来自字典，字典值是**字符串** "true"/"false"，
    // 而前端只有「值形态」没有「列类型」（`apps/admin/src/utils/table/list-filters.ts`），
    // 于是它必然发 `{ op: 'like', value: 'true' }`。批次 4-A 之前这是 50000（boolean ~~* unknown），
    // 批次 4-A 之后是 40099（like 打布尔列）—— 两种都不是可用状态。
    // 现在由列类型裁决点把字典布尔值翻成真布尔（唯一转换点：`pg-column-op` 的 resolvePgFilterCondition）。
    const statusFilters = (value: string) => [{ field: 'status', op: 'like', value }]

    it('status like "true" ⇒ 20000，且返回行**全部**是启用状态', async () => {
      const res = await statusOf('/system/user/list', listBody(statusFilters('true')))

      expectOk(res, 'user list status like true')
      const data = bodyOf<{ data: Array<{ status: boolean }>, total: number }>(res).data
      expect(data.total).toBeGreaterThan(0)
      expect(data.data.length).toBeGreaterThan(0)
      expect(data.data.every(row => row.status === true)).toBe(true)
    })

    it('status like "false" ⇒ 20000（可能 0 行，但不许 40099/50000）', async () => {
      const res = await statusOf('/system/user/list', listBody(statusFilters('false')))

      expectOk(res, 'user list status like false')
      const data = bodyOf<{ data: Array<{ status: boolean }>, total: number }>(res).data
      expect(data.data.every(row => row.status === false)).toBe(true)
    })

    it('布尔列 + like 但值不是布尔字面量 ⇒ 仍然 40099（只放行字典那两颗值）', async () => {
      const res = await statusOf('/system/user/list', listBody(statusFilters('yes')))

      expect(bodyOf(res).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)
    })
  })
})
