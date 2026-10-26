/**
 * `src/db/etl-map.ts` 的用例 —— ETL / seed:pg / verify-etl 三条通道共用的映射层。
 *
 * 对账的正确性完全押在「同一份文档映射出同一行」上，所以用例盯四件事：
 * - **类型映射**：`$date`→timestamptz（Date）、数值/布尔缺省补齐、数组列、jsonb 原样；
 * - **引用重写**：`$oid`/hex → v5 派生、可空引用、已是 uuid 的回灌直通、坏值抛；
 * - **junction 拆分**：roles/menus 数组 → 关联表行、去重保序；
 * - **Q7 / Q4 专项**：stringify 列 parse + raw 旁路、setting_value 的 role hex 专项重写。
 */
import { ObjectId } from 'mongodb'
import { describe, expect, it } from 'vitest'
import {
  arrOr,
  dedupeKeepOrder,
  ETL_COLLECTION_ORDER,
  ETL_MAPPERS,
  mapErrorPayload,
  mapSettingValue,
  parseStringifiedJson,
  refUuid,
  refUuidOrNull,
  reqStr,
  reqTs,
  sortMenuRowsByDepth,
  tsOrNull,
} from '../etl-map.ts'
import { deriveUuidFromObjectId } from '../uuid5.ts'

/** 两个真实存量 id（与 uuid5.test.ts 同源向量，交叉钉住派生一致性） */
const VISITOR_ROLE_HEX = '5fb27aee3a30b717d8078eb5'
const VISITOR_ROLE_UUID = 'd6e8ca57-1faf-56d7-b090-9ff0c0b78ce6'
const OTHER_ROLE_HEX = '5fc63efbc661230af4695249'

const CTX = { roleHexes: new Set([VISITOR_ROLE_HEX, OTHER_ROLE_HEX]) }

const TS = '2020-11-24T13:54:44.222Z'

function baseDoc(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { _id: new ObjectId('5fbd10a430391c1438ef8aa0'), createdAt: new Date(TS), updatedAt: new Date(TS), ...extra }
}

describe('标量归一', () => {
  it('refUuid：ObjectId 实例与 hex 字符串等价；uuid 直通（export 回灌）；小写归一', () => {
    expect(refUuid(new ObjectId(VISITOR_ROLE_HEX), 'f')).toBe(VISITOR_ROLE_UUID)
    expect(refUuid(VISITOR_ROLE_HEX, 'f')).toBe(VISITOR_ROLE_UUID)
    expect(refUuid(VISITOR_ROLE_UUID, 'f')).toBe(VISITOR_ROLE_UUID)
    expect(refUuid(VISITOR_ROLE_UUID.toUpperCase(), 'f')).toBe(VISITOR_ROLE_UUID)
  })

  it('refUuid：坏值与空值抛（fail-closed，不静默换值）', () => {
    expect(() => refUuid('short', 'f')).toThrow()
    expect(() => refUuid(42, 'f')).toThrow()
    expect(() => refUuid(null, 'f')).toThrow()
  })

  it('refUuidOrNull：可空引用的 null 直通', () => {
    expect(refUuidOrNull(null, 'f')).toBeNull()
    expect(refUuidOrNull(undefined, 'f')).toBeNull()
    expect(refUuidOrNull(VISITOR_ROLE_HEX, 'f')).toBe(VISITOR_ROLE_UUID)
  })

  it('tsOrNull：Date 原样、ISO 字符串与毫秒数转换、坏形态抛', () => {
    const date = new Date(TS)
    expect(tsOrNull(date)?.getTime()).toBe(date.getTime())
    expect(tsOrNull(TS)?.getTime()).toBe(date.getTime())
    expect(tsOrNull(date.getTime())?.getTime()).toBe(date.getTime())
    expect(tsOrNull(null)).toBeNull()
    expect(() => tsOrNull({ nested: true })).toThrow()
  })

  it('reqStr / reqTs：NOT NULL 列缺值抛', () => {
    expect(reqStr('x', 'f')).toBe('x')
    expect(() => reqStr(null, 'f')).toThrow()
    expect(() => reqTs(null, 'f')).toThrow()
  })

  it('arrOr：缺省浅拷贝（不共享引用）、非数组抛', () => {
    const fallback = ['a']
    const first = arrOr(undefined, fallback)
    first.push('b')
    expect(fallback).toEqual(['a'])
    expect(() => arrOr('nope', [])).toThrow()
  })

  it('dedupeKeepOrder：复合 PK 去重保序', () => {
    expect(dedupeKeepOrder(['b', 'a', 'b', 'c', 'a'])).toEqual(['b', 'a', 'c'])
  })
})

describe('q7：stringify 列 parse', () => {
  it('合法 JSON → parsed，raw 为 null', () => {
    const r = parseStringifiedJson('{"a":1}')
    expect(r.parsed).toEqual({ a: 1 })
    expect(r.raw).toBeNull()
  })

  it('非法 JSON → parsed null，原文进 raw（零丢失）', () => {
    const r = parseStringifiedJson('{oops')
    expect(r.parsed).toBeNull()
    expect(r.raw).toBe('{oops')
  })

  it('空串 / null 双侧皆 null（不算 parse 失败）', () => {
    expect(parseStringifiedJson('')).toEqual({ parsed: null, raw: null })
    expect(parseStringifiedJson(null)).toEqual({ parsed: null, raw: null })
  })

  it('已是对象的新数据原样通过；parse 出标量按失败处理', () => {
    expect(parseStringifiedJson({ a: 1 }).parsed).toEqual({ a: 1 })
    expect(parseStringifiedJson('"42"').parsed).toBeNull()
    expect(parseStringifiedJson('"42"').raw).toBe('"42"')
  })
})

describe('q7：app_error.payload 逐成员 parse', () => {
  it('成员 stringify 字符串全部 parse 成 jsonb 对象', () => {
    const r = mapErrorPayload({ body: '{}', params: '{"locale":"zh_CN"}', query: '{"cache":"1"}' })
    expect(r.payload).toEqual({ body: {}, params: { locale: 'zh_CN' }, query: { cache: '1' } })
    expect(r.rawPayload).toBeNull()
  })

  it('任一成员 parse 失败 → payload NULL，整体原文进 raw_payload', () => {
    const original = { body: '{ok', params: '{"a":1}', query: null }
    const r = mapErrorPayload(original)
    expect(r.payload).toBeNull()
    expect(r.rawPayload).toBe(JSON.stringify(original))
  })

  it('payload 整体缺失 → 双侧 null；新数据（成员已是对象）原样保留', () => {
    expect(mapErrorPayload(null)).toEqual({ payload: null, rawPayload: null })
    const r = mapErrorPayload({ body: { a: 1 } })
    expect(r.payload).toEqual({ body: { a: 1 } })
  })
})

describe('q4：app_setting.setting_value 重写', () => {
  it('整值 role hex → v5；非 role hex 抛（不盲改）', () => {
    expect(mapSettingValue(VISITOR_ROLE_HEX, CTX)).toBe(VISITOR_ROLE_UUID)
    expect(() => mapSettingValue('666666666666666666666666', CTX)).toThrow()
  })

  it('整值已是 uuid → 幂等原样', () => {
    expect(mapSettingValue(VISITOR_ROLE_UUID, CTX)).toBe(VISITOR_ROLE_UUID)
  })

  it('jSON 内嵌 role hex → v5；其余标量与历史 hex 不动', () => {
    const before = JSON.stringify({ defaultRole: VISITOR_ROLE_HEX, ttl: 300, plain: 'walnut-admin-api-sign-v1' })
    const after = JSON.parse(mapSettingValue(before, CTX)) as Record<string, unknown>
    expect(after.defaultRole).toBe(VISITOR_ROLE_UUID)
    expect(after.ttl).toBe(300)
    expect(after.plain).toBe('walnut-admin-api-sign-v1')
  })

  it('非 JSON 文本（如 "0"、开关值）原样返回', () => {
    expect(mapSettingValue('0', CTX)).toBe('0')
    expect(mapSettingValue('FORCE_IMMEDIATE_SIGNOUT', CTX)).toBe('FORCE_IMMEDIATE_SIGNOUT')
  })

  it('空值抛（setting_value NOT NULL）', () => {
    expect(() => mapSettingValue(null, CTX)).toThrow()
  })
})

describe('junction 拆分', () => {
  it('sys_user.roles → sys_user_role 行；currentRole → current_role_id v5', () => {
    const mapped = ETL_MAPPERS.sys_user(baseDoc({
      userName: 'visitor',
      roles: [VISITOR_ROLE_HEX, VISITOR_ROLE_HEX, OTHER_ROLE_HEX],
      currentRole: VISITOR_ROLE_HEX,
      roleMode: 'switchable',
      gender: 1,
      age: 22,
      status: true,
      mfaSetup: false,
    }), CTX)

    expect(mapped.table).toBe('sys_user')
    expect(mapped.row.id).toBe(deriveUuidFromObjectId('5fbd10a430391c1438ef8aa0'))
    expect(mapped.row.current_role_id).toBe(VISITOR_ROLE_UUID)
    expect(mapped.junction?.table).toBe('sys_user_role')
    // 重复引用只落一行（复合 PK 去重）
    expect(mapped.junction?.rows).toEqual([
      { user_id: mapped.row.id, role_id: VISITOR_ROLE_UUID },
      { user_id: mapped.row.id, role_id: deriveUuidFromObjectId(OTHER_ROLE_HEX) },
    ])
  })

  it('sys_role.menus → sys_role_menu 行；role_name 为 null 抛（7.3 预检口径）', () => {
    const menuHex = '5fc8e3cd0144eb274c1c9780'
    const mapped = ETL_MAPPERS.sys_role(baseDoc({ roleName: 'visitor', menus: [menuHex] }), CTX)
    expect(mapped.junction?.table).toBe('sys_role_menu')
    expect(mapped.junction?.rows).toEqual([
      { role_id: mapped.row.id, menu_id: deriveUuidFromObjectId(menuHex) },
    ])
    expect(() => ETL_MAPPERS.sys_role(baseDoc({ roleName: null }), CTX)).toThrow()
  })

  it('roles / menus 键缺失 → junction 零行（不抛）', () => {
    const user = ETL_MAPPERS.sys_user(baseDoc({ userName: 'x' }), CTX)
    expect(user.junction?.rows).toEqual([])
    const role = ETL_MAPPERS.sys_role(baseDoc({ roleName: 'x' }), CTX)
    expect(role.junction?.rows).toEqual([])
  })
})

describe('逐表映射抽查（拍平 / 缺省 / 特殊列）', () => {
  it('sys_menu：meta 拍平 19 列；根节点缺 pid → NULL；meta 缺键按 schema 缺省', () => {
    const mapped = ETL_MAPPERS.sys_menu(baseDoc({ type: 'catalog', title: 'app.base.root' }), CTX)
    const row = mapped.row
    expect(row.pid).toBeNull()
    expect(row.type).toBe('catalog')
    expect(row.title).toBe('app.base.root')
    expect(row.sort_order).toBeNull()
    expect(row.ternal).toBe('none')
    expect(row.is_show).toBe(true)
    expect(row.cache).toBe(false)
    expect(row.status).toBe(true)
    expect(row.affix).toBe(false)
    expect(row.menu_active_same_tab).toBe(false)
    expect(row.position).toBe(false)
    expect(row.leave_tip).toBe(false)
    expect(row.mask_url).toBe(false)
    expect(row.hijack_refresh).toBe(false)
    expect(row.transition).toBe('fade')
    expect(row.watermark).toBeNull()
    expect(row.cache_key_strategy).toBeNull()

    const full = ETL_MAPPERS.sys_menu(baseDoc({
      pid: new ObjectId(VISITOR_ROLE_HEX),
      meta: { order: 3, ternal: 'external', url: 'https://x', show: false, cache: true, status: true, affix: true, permission: '*:*:*', menuActiveName: 'n', menuActiveSameTab: true, badge: 'b', activeIcon: 'i', position: true, leaveTip: true, maskUrl: true, hijackRefresh: true, watermark: { content: 'w' }, transition: 'fade', cacheKeyStrategy: 'name' },
    }), CTX)
    expect(full.row.pid).toBe(VISITOR_ROLE_UUID)
    expect(full.row.sort_order).toBe(3)
    expect(full.row.ternal).toBe('external')
    expect(full.row.is_show).toBe(false)
    expect(full.row.watermark).toEqual({ content: 'w' })
    expect(full.row.menu_active_name).toBe('n')
  })

  it('sys_device：sr/vp/geo 拍平、GeoJSON coordinates 取 [经,纬]、数组列缺省', () => {
    const mapped = ETL_MAPPERS.sys_device(baseDoc({
      deviceName: 'D1',
      deviceId: 'fp',
      deviceInfo: { os: 'Windows 10' },
      sr: { height: 1080, width: 1920 },
      vp: { height: 911, width: 1203 },
      geoLocation: { type: 'Point', coordinates: [null, null] },
      ipHistory: ['127.0.0.1'],
    }), CTX)
    expect(mapped.row.sr_height).toBe(1080)
    expect(mapped.row.vp_width).toBe(1203)
    expect(mapped.row.geo_longitude).toBeNull()
    expect(mapped.row.geo_latitude).toBeNull()
    expect(mapped.row.ip_history).toEqual(['127.0.0.1'])
    expect(mapped.row.location_history).toEqual([])
    expect(mapped.row.risk_score).toBe(0)
    expect(mapped.row.device_info).toEqual({ os: 'Windows 10' })
  })

  it('sys_locale / sys_dict_data：引用列 v5、required 抛、tag_type 缺省', () => {
    const locale = ETL_MAPPERS.sys_locale(baseDoc({ langId: VISITOR_ROLE_HEX, key: 'app.base.yes', value: 'Yes' }), CTX)
    expect(locale.row.lang_id).toBe(VISITOR_ROLE_UUID)
    expect(() => ETL_MAPPERS.sys_locale(baseDoc({ langId: null, key: 'k' }), CTX)).toThrow()

    const data = ETL_MAPPERS.sys_dict_data(baseDoc({ typeId: VISITOR_ROLE_HEX, label: 'l', value: 'v' }), CTX)
    expect(data.row.sort_order).toBe(0)
    expect(data.row.tag_type).toBe('primary')
    expect(() => ETL_MAPPERS.sys_dict_data(baseDoc({ typeId: VISITOR_ROLE_HEX, label: null, value: 'v' }), CTX)).toThrow()
  })

  it('sys_log_operate：requestData/responseData 走 Q7；success 三态；operated_at 兜底 createdAt', () => {
    const mapped = ETL_MAPPERS.sys_log_operate(baseDoc({
      title: 't',
      actionType: 'UPDATE',
      requestData: '{"a":1}',
      responseData: '{bad',
      correspondingMS: 12,
      userId: VISITOR_ROLE_HEX,
      snapshotBefore: { x: 1 },
      snapshotAfter: '{"y":2}',
    }), CTX)
    expect(mapped.row.request_data).toEqual({ a: 1 })
    expect(mapped.row.raw_request_data).toBeNull()
    expect(mapped.row.response_data).toBeNull()
    expect(mapped.row.raw_response_data).toBe('{bad')
    expect(mapped.row.success).toBeNull()
    expect(mapped.row.user_id).toBe(VISITOR_ROLE_UUID)
    expect(mapped.row.snapshot_before).toEqual({ x: 1 })
    expect(mapped.row.snapshot_after).toEqual({ y: 2 })
    expect((mapped.row.operated_at as Date).getTime()).toBe(new Date(TS).getTime())
  })

  it('sys_log_operate：snapshot 的坏字符串 fail-closed 抛（无旁路列）', () => {
    expect(() => ETL_MAPPERS.sys_log_operate(baseDoc({ title: 't', actionType: 'UPDATE', snapshotBefore: '{bad' }), CTX)).toThrow()
  })

  it('app_monitor_user：left → is_left；focus 缺省 true（源 schema 口径）；改名时间列', () => {
    const mapped = ETL_MAPPERS.app_monitor_user(baseDoc({
      visitorId: 'fp',
      left: true,
      firstVisitAt: new Date(TS),
      lastActiveAt: new Date(TS),
    }), CTX)
    expect(mapped.row.is_left).toBe(true)
    expect(mapped.row.focus).toBe(true)
    expect((mapped.row.first_visit_at as Date).getTime()).toBe(new Date(TS).getTime())
  })

  it('app_error：headers 缺省 {}；created_at 必有（无 updated_at）', () => {
    const mapped = ETL_MAPPERS.app_error(baseDoc({}), CTX)
    expect(mapped.row.headers).toEqual({})
    expect(mapped.row).toHaveProperty('created_at')
    expect(mapped.row).not.toHaveProperty('updated_at')
  })

  it('shared_area：无时间列；code/name/pcode 必填', () => {
    const mapped = ETL_MAPPERS.shared_area(baseDoc({ code: '110000', name: '北京', pcode: '0' }), CTX)
    expect(Object.keys(mapped.row).sort()).toEqual(['code', 'id', 'name', 'pcode'])
    expect(() => ETL_MAPPERS.shared_area(baseDoc({ code: '110000', name: 'x' }), CTX)).toThrow()
  })

  it('app_setting：created_by 松引用 v5；setting_value 专项重写走通', () => {
    const mapped = ETL_MAPPERS.app_setting(baseDoc({
      settingName: '应用默认 - 角色',
      settingKey: 'app.default.role',
      settingValue: VISITOR_ROLE_HEX,
      settingType: 'functional',
      createdBy: '5fc63f5640cad739606d1700',
    }), CTX)
    expect(mapped.row.setting_value).toBe(VISITOR_ROLE_UUID)
    expect(mapped.row.created_by).toBe(deriveUuidFromObjectId('5fc63f5640cad739606d1700'))
  })
})

describe('注册表形态', () => {
  it('24 个集合全注册，装载顺序父表在前（FK 依赖）', () => {
    expect(ETL_COLLECTION_ORDER).toHaveLength(24)
    const indexOf = (name: string) => ETL_COLLECTION_ORDER.indexOf(name)
    expect(indexOf('sys_lang')).toBeLessThan(indexOf('sys_locale'))
    expect(indexOf('sys_dict_type')).toBeLessThan(indexOf('sys_dict_data'))
    // sys_role_menu 挂 menu、sys_user_role 挂 role ⇒ menu → role → user
    expect(indexOf('sys_menu')).toBeLessThan(indexOf('sys_role'))
    expect(indexOf('sys_role')).toBeLessThan(indexOf('sys_user'))
    expect(indexOf('sys_user')).toBeLessThan(indexOf('sys_user_identity'))
    expect(indexOf('sys_device')).toBeLessThan(indexOf('sys_user_device'))
  })
})

describe('sortMenuRowsByDepth（pid 自引用 FK 的装载序整理）', () => {
  const menuRow = (id: string, pid: string | null) => ({ id, pid })

  it('子行排在父行之后（深度稳定排序，同深度保原序）', () => {
    const rows = [
      menuRow('child-1', 'root-2'),
      menuRow('root-1', null),
      menuRow('grandchild', 'child-2'),
      menuRow('root-2', null),
      menuRow('child-2', 'root-1'),
    ]
    const sorted = sortMenuRowsByDepth(rows)
    expect(sorted.map(row => row.id)).toEqual(['root-1', 'root-2', 'child-1', 'child-2', 'grandchild'])
    // 不改入参
    expect(rows[0].id).toBe('child-1')
  })

  it('pid 指向不存在的节点 → 抛（fail-closed）', () => {
    expect(() => sortMenuRowsByDepth([menuRow('orphan', 'ghost')])).toThrow()
  })

  it('pid 链成环 → 抛', () => {
    expect(() => sortMenuRowsByDepth([
      menuRow('a', 'b'),
      menuRow('b', 'a'),
    ])).toThrow(/成环/)
  })

  it('深链（>2 级）正确展开', () => {
    const rows = [
      menuRow('l3', 'l2'),
      menuRow('l2', 'l1'),
      menuRow('l1', null),
    ]
    expect(sortMenuRowsByDepth(rows).map(row => row.id)).toEqual(['l1', 'l2', 'l3'])
  })
})
