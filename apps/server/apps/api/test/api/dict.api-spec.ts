import type { NestExpressApplication } from '@nestjs/platform-express'
import type { WalnutRootUserFixture } from './helpers/auth-login'
import { randomUUID } from 'node:crypto'
import { WalnutModelName } from '@walnut-server/db'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { bodyOf, expectOk, WalnutApiClient } from './helpers/api-client'
import { performHttpOpaqueLogin, registerRootUserFixture } from './helpers/auth-login'
import { createApiApp } from './helpers/create-api-app'

/**
 * C 段：`system/dict/type` + `system/dict/data` —— 标准 CRUD（dictData **无** deleteMany
 * 路由，Permissions.DELETE_MANY 常量存在但装饰器未接线 → 40400 钉现状）
 * + `GET /system/dict/type/s?types=a,b`（按业务键 type 批量取启用 dictData）。
 *
 * FK 语义（真实断言）：sys_dict_data.type_id → sys_dict_type ON DELETE CASCADE（migration
 * DDL）。dictType 的 HTTP delete 是「sys_deleted 快照 + 原行硬删」（pg-base.repository
 * deleteSoftById），因此删 type 时数据腿由 **DB 级 CASCADE** 静默清掉 —— sys_dict_data
 * 行直接消失、且**不产生** dictData 的 sys_deleted 快照（应用层 deleteMany 才会写快照）。
 *
 * dictData 自己的 HTTP delete 除了软删本行，还会按 label 级联软删 locale 行
 * （dictData.service.delete → localeSharedService.deleteByKey）—— 本轮 label 用唯一
 * seed 前缀，不命中任何 locale 行，级联腿空转。
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface DictTypeRow {
  id: string
  type?: string
  name?: string
  status?: boolean
  description?: string | null
  dictDataCount?: number
  dictData?: unknown
}

interface DictDataRow {
  id: string
  typeId?: string
  label?: string
  value?: string
  order?: number
  status?: boolean
  tagType?: string
}

/** GET /system/dict/type/s 出参行：{ type, name, dictData } */
interface DictTypeWithData {
  type: string
  name: string
  dictData: DictDataRow[]
}

interface DictTypeListData {
  data: DictTypeRow[]
  total: number
}

describe('C 段：system/dict type+data CRUD 与 FK 级联（真实 HTTP 全链）', () => {
  let app: NestExpressApplication
  let api: WalnutApiClient

  const seed8 = randomUUID().slice(0, 8)
  /** dict type 业务键（uq_dict_type 唯一索引）：本轮行统一前缀，afterEach 按 LIKE 清 */
  const typePrefix = `api-spec-${seed8}`
  let fixture: WalnutRootUserFixture | null = null

  /** 本轮创建的行 id（PG 硬删行按 id 清；软删快照按 deleted_id 清） */
  const collect = {
    typeIds: [] as string[],
    typeKeys: [] as string[],
    dataIds: [] as string[],
  }

  function dictTypePayload(tag: string) {
    return {
      type: `${typePrefix}-${tag}`,
      name: `dict-name-${seed8}-${tag}`,
      status: true,
      description: `dict type ${tag}`,
    }
  }

  function dictDataPayload(typeId: string, tag: string) {
    return {
      typeId,
      label: `dict-label-${seed8}-${tag}`,
      value: `dict-value-${seed8}-${tag}`,
      order: 1,
      status: true,
      tagType: 'primary',
      description: `dict data ${tag}`,
    }
  }

  async function createDictType(tag: string): Promise<DictTypeRow> {
    const res = await api.root('POST', api.apiPath('/system/dict/type'), dictTypePayload(tag))
    expectOk(res, `dict type create ${tag}`)
    const row = bodyOf<DictTypeRow>(res).data
    collect.typeIds.push(row.id)
    collect.typeKeys.push(`${typePrefix}-${tag}`)
    return row
  }

  async function createDictData(typeId: string, tag: string): Promise<DictDataRow> {
    const res = await api.root('POST', api.apiPath('/system/dict/data'), dictDataPayload(typeId, tag))
    expectOk(res, `dict data create ${tag}`)
    const row = bodyOf<DictDataRow>(res).data
    collect.dataIds.push(row.id)
    return row
  }

  beforeAll(async () => {
    app = await createApiApp()
    api = await WalnutApiClient.create(app)

    fixture = await registerRootUserFixture(app, api.pgDataSource, `dict-${seed8}`)

    const tokens = await performHttpOpaqueLogin(api, app, fixture)
    api.setAuth(tokens)
    await api.seedMfaVerifiedCache(fixture.userId)
  })

  afterEach(async () => {
    // dictData 先清（若 CASCADE 用例已连带清掉则 IN 空集无害）；再 type；最后软删快照
    await api.pgDataSource.query('DELETE FROM sys_dict_data WHERE id = ANY($1::uuid[])', [collect.dataIds])
    await api.pgDataSource.query('DELETE FROM sys_dict_type WHERE id = ANY($1::uuid[])', [collect.typeIds])
    await api.pgDataSource.query('DELETE FROM sys_dict_type WHERE type LIKE $1', [`${typePrefix}%`])
    const touchedIds = [...collect.dataIds, ...collect.typeIds]
    if (touchedIds.length > 0) {
      await api.pgDataSource.query('DELETE FROM sys_deleted WHERE deleted_id = ANY($1::uuid[])', [touchedIds])
    }
    collect.typeIds = []
    collect.typeKeys = []
    collect.dataIds = []
  })

  afterAll(async () => {
    if (api !== undefined && fixture !== null) {
      await api.pgDataSource.query('DELETE FROM sys_dict_type WHERE type LIKE $1', [`${typePrefix}%`])
      await api.pgDataSource.query('DELETE FROM sys_user WHERE id = $1', [fixture.userId])
      await api.pgDataSource.query('DELETE FROM sys_role WHERE id = $1', [fixture.roleId])
      await api.pgDataSource.query('DELETE FROM sys_device WHERE device_id = $1', [api.deviceId])
      await api.cleanupWalnutCacheKeys(seed8, api.deviceId, fixture.userId)
    }
    await app.close()
  })

  it('dictType create → uuid 主键；read 回读一致', async () => {
    const created = await createDictType('R1')
    expect(created.id).toMatch(UUID_RE)

    const readRes = await api.root('GET', api.apiPath(`/system/dict/type/${created.id}`))
    expectOk(readRes, 'dict type read')
    const row = bodyOf<DictTypeRow>(readRes).data
    expect(row.id).toBe(created.id)
    expect(row.type).toBe(`${typePrefix}-R1`)
    expect(row.name).toBe(`dict-name-${seed8}-R1`)
    expect(row.status).toBe(true)
    expect(row.description).toBe('dict type R1')
  })

  it('dictType update → 修改持久化；list 按 type 过滤 + dictDataCount 计数', async () => {
    const created = await createDictType('U1')
    await createDictType('U2')

    const updateRes = await api.root('PUT', api.apiPath(`/system/dict/type/${created.id}`), {
      type: `${typePrefix}-U1`,
      name: `dict-name-${seed8}-U1-updated`,
      status: false,
      description: 'dict type updated',
    })
    expectOk(updateRes, 'dict type update')
    expect(bodyOf<DictTypeRow>(updateRes).data.status).toBe(false)

    // 造两条 data 让计数子查询有值（order 1/2 均启用）
    await createDictData(created.id, 'U1a')
    await createDictData(created.id, 'U1b')

    const listRes = await api.root('POST', api.apiPath('/system/dict/type/list'), {
      query: { type: `${typePrefix}-U1` },
      sort: [{ field: 'createdAt', order: 'ascend', priority: 1 }],
      page: { page: 1, pageSize: 10 },
    })
    expectOk(listRes, 'dict type list')
    const list = bodyOf<DictTypeListData>(listRes).data
    expect(list.total).toBe(1)
    expect(list.data[0].dictDataCount).toBe(2)

    // list 出参不带关联数据本体（计数列才是 Mongo 版 $size 的对齐物）
    expect(list.data[0].dictData).toBeUndefined()
  })

  it('GET /system/dict/type/s?types=… → 按 type 批量回启用 data（order 升序）；未知 type 跳过', async () => {
    const t1 = await createDictType('S1')
    await createDictData(t1.id, 'S1a')
    const dataB = await createDictData(t1.id, 'S1b')

    // order 大的排后面；再关掉一条，只回启用行
    const updateRes = await api.root('PUT', api.apiPath(`/system/dict/data/${dataB.id}`), {
      typeId: t1.id,
      label: dataB.label,
      value: dataB.value,
      order: 9,
      status: true,
      tagType: 'success',
    })
    expectOk(updateRes, 'dict data update reorder')
    expect(bodyOf<DictDataRow>(updateRes).data.tagType).toBe('success')

    const t2 = await createDictType('S2')
    await createDictData(t2.id, 'S2a')
    const disabled = await createDictData(t2.id, 'S2-off')
    const disableRes = await api.root('PUT', api.apiPath(`/system/dict/data/${disabled.id}`), {
      typeId: t2.id,
      label: disabled.label,
      value: disabled.value,
      order: 1,
      status: false,
      tagType: 'primary',
    })
    expectOk(disableRes, 'dict data disable')

    const res = await api.root('GET', api.apiPath(`/system/dict/type/s?types=${typePrefix}-S1,${typePrefix}-S2,${typePrefix}-missing`))
    expectOk(res, 'dict type s endpoint')

    const rows = bodyOf<DictTypeWithData[]>(res).data
    // 未知 type 在 service 层直接短路为空并被 flat 掉
    expect(rows).toHaveLength(2)

    const s1 = rows.find(r => r.type === `${typePrefix}-S1`)!
    expect(s1.dictData).toHaveLength(2)
    expect(s1.dictData.map(d => d.order)).toEqual([1, 9])

    const s2 = rows.find(r => r.type === `${typePrefix}-S2`)!
    // status=false 的行不进 getByType（match { status: true }）
    expect(s2.dictData).toHaveLength(1)
    expect(s2.dictData[0].label).toBe(`dict-label-${seed8}-S2a`)
  })

  it('dictData create/update/read/list（typeId 关联）→ 全链一致', async () => {
    const type = await createDictType('D1')
    const data = await createDictData(type.id, 'D1a')

    const readRes = await api.root('GET', api.apiPath(`/system/dict/data/${data.id}`))
    expectOk(readRes, 'dict data read')
    const row = bodyOf<DictDataRow>(readRes).data
    expect(row.typeId).toBe(type.id)
    expect(row.label).toBe(`dict-label-${seed8}-D1a`)
    expect(row.value).toBe(`dict-value-${seed8}-D1a`)

    const listRes = await api.root('POST', api.apiPath('/system/dict/data/list'), {
      query: { typeId: type.id },
      sort: [{ field: 'createdAt', order: 'ascend', priority: 1 }],
      page: { page: 1, pageSize: 10 },
    })
    expectOk(listRes, 'dict data list')
    const list = bodyOf<{ data: DictDataRow[], total: number }>(listRes).data
    expect(list.total).toBe(1)
    expect(list.data[0].id).toBe(data.id)
  })

  it('dictData delete → 软删（sys_deleted 快照）+ read 40401', async () => {
    const type = await createDictType('DD1')
    const data = await createDictData(type.id, 'DD1a')

    const deleteRes = await api.root('DELETE', api.apiPath(`/system/dict/data/${data.id}`))
    expectOk(deleteRes, 'dict data delete')
    expect(bodyOf<DictDataRow>(deleteRes).data.id).toBe(data.id)

    const readRes = await api.root('GET', api.apiPath(`/system/dict/data/${data.id}`))
    expect(bodyOf(readRes).code).toBe(WalnutAdminConstAppResponseCode.NOT_FOUND_DATA_NOT_FOUND)

    const snapshots: Array<{ deleted_id: string, model_name: string }> = await api.pgDataSource.query(
      'SELECT deleted_id, model_name FROM sys_deleted WHERE deleted_id = $1',
      [data.id],
    )
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0].model_name).toBe(WalnutModelName.SYS_DICT_DATA)

    collect.dataIds = collect.dataIds.filter(id => id !== data.id)
  })

  it('dictData 无 deleteMany 路由（Permissions.DELETE_MANY 常量未接线）→ 40400 钉现状', async () => {
    const type = await createDictType('M1')
    const a = await createDictData(type.id, 'M1a')
    const b = await createDictData(type.id, 'M1b')

    // update DTO 需要全量字段：先各改一次拿到可删的两行（顺带覆盖 update 路径）
    for (const row of [a, b]) {
      const res = await api.root('PUT', api.apiPath(`/system/dict/data/${row.id}`), {
        typeId: type.id,
        label: row.label,
        value: row.value,
        order: 2,
        status: true,
        tagType: 'info',
      })
      expectOk(res, `dict data update ${row.label}`)
      expect(bodyOf<DictDataRow>(res).data.order).toBe(2)
    }

    // deleteMany：controller 只解构了 Create/Read/Update/Delete/List，deleteMany 装饰器
    // 没接 —— 路由不存在（B 段 demo/monitor 的 deleteMany 形态不适用于 dictData）
    const deleteManyRes = await api.root('DELETE', api.apiPath(`/system/dict/data/deleteMany/${a.id},${b.id}`))
    expect(bodyOf(deleteManyRes).code).toBe(WalnutAdminConstAppResponseCode.NOT_FOUND)
  })

  it('FK 语义：删 type → data 行被 DB CASCADE 硬删，且不产生 data 的软删快照', async () => {
    const type = await createDictType('FK1')
    const a = await createDictData(type.id, 'FK1a')
    const b = await createDictData(type.id, 'FK1b')

    const deleteRes = await api.root('DELETE', api.apiPath(`/system/dict/type/${type.id}`))
    expectOk(deleteRes, 'dict type delete (FK case)')
    collect.typeIds = collect.typeIds.filter(id => id !== type.id)

    // data 行随 FK CASCADE 消失
    const leftData: Array<{ c: number }> = await api.pgDataSource.query(
      'SELECT count(*)::int AS c FROM sys_dict_data WHERE id = ANY($1::uuid[])',
      [[a.id, b.id]],
    )
    expect(leftData[0].c).toBe(0)

    // sys_deleted 只有 type 的快照行 —— CASCADE 是 DB 级，不走应用层软删
    const snapshots: Array<{ model_name: string }> = await api.pgDataSource.query(
      'SELECT model_name FROM sys_deleted WHERE deleted_id = ANY($1::uuid[])',
      [[type.id, a.id, b.id]],
    )
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0].model_name).toBe(WalnutModelName.SYS_DICT_TYPE)

    collect.typeIds = []
    collect.typeKeys = collect.typeKeys.filter(key => key !== `${typePrefix}-FK1`)
    collect.dataIds = []
  })

  it('校验失败 → 40099（缺必填 / typeId 非 uuid / 未知字段）', async () => {
    const missingName = await api.root('POST', api.apiPath('/system/dict/type'), {
      type: `${typePrefix}-V1`,
      status: true,
    })
    expect(bodyOf(missingName).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)

    const badTypeId = await api.root('POST', api.apiPath('/system/dict/data'), {
      typeId: 'not-a-uuid',
      label: 'x',
      value: 'y',
      order: 1,
      status: true,
    })
    expect(bodyOf(badTypeId).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)

    const unknownField = await api.root('POST', api.apiPath('/system/dict/type'), {
      ...dictTypePayload('V2'),
      notAField: 'boom',
    })
    expect(bodyOf(unknownField).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)
  })

  it('read 不存在的 id → 40401（type / data 两腿）', async () => {
    const typeRead = await api.root('GET', api.apiPath(`/system/dict/type/${randomUUID()}`))
    expect(bodyOf(typeRead).code).toBe(WalnutAdminConstAppResponseCode.NOT_FOUND_DATA_NOT_FOUND)

    const dataRead = await api.root('GET', api.apiPath(`/system/dict/data/${randomUUID()}`))
    expect(bodyOf(dataRead).code).toBe(WalnutAdminConstAppResponseCode.NOT_FOUND_DATA_NOT_FOUND)
  })
})
