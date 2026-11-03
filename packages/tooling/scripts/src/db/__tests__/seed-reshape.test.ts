/**
 * `src/db/seed-reshape.ts` 的用例 —— 历史导出 → PG 行形态的**唯一**映射面。
 *
 * 这份映射的失效方式是静默的：漏一列 ⇒ seed 少一列 ⇒ 灌库后那列是 NULL，而没有任何报错。
 * 所以用例盯三件事：
 * - **字段对齐**：`meta.*` 拍平、`_id` → `id`、驼峰 → 列名、`Date` → ISO 字符串；
 * - **fail-closed**：未消费的键、缺键、非 uuid 的 id/引用 一律抛（这是「导出器加字段而这里没跟」的拦口）；
 * - **junction 拆分**：`roles` / `menus` → 独立行，复合主键去重。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { JUNCTION_SPECS, JUNCTION_TABLES, reshapeCollection, ROW_SPECS, SEED_TABLES, stringifySeedRows, toSeedValue } from '../seed-reshape.ts'

const TS = '2020-11-24T13:54:44.222Z'
const USER_ID = '404d0cbd-1328-58e5-a5a7-e9f5de7c0895'
const ROLE_ID = 'd6e8ca57-1faf-56d7-b090-9ff0c0b78ce6'
const MENU_ID = '001b1262-ac50-5fbf-8bf0-cca2a87c8353'

/** 一个完整的导出文档（字段与 `export-pg.ts` 的反向映射同形） */
function userDoc(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    _id: USER_ID,
    userName: 'visitor',
    nickName: 'Shinji',
    age: 22,
    gender: 1,
    avatar: null,
    description: '1',
    status: true,
    roles: [ROLE_ID],
    roleMode: 'switchable',
    currentRole: ROLE_ID,
    mfaSetup: false,
    createdAt: new Date(TS),
    updatedAt: new Date(TS),
    ...extra,
  }
}

describe('值转换', () => {
  it('date → ISO 字符串（PG timestamptz 直接吃它，不丢毫秒）', () => {
    expect(toSeedValue(new Date(TS), 'x')).toBe(TS)
  })

  it('对象/数组递归转换，标量与 null 原样', () => {
    expect(toSeedValue({ a: new Date(TS), b: [1, null, 'x'] }, 'x')).toEqual({ a: TS, b: [1, null, 'x'] })
    expect(toSeedValue(null, 'x')).toBeNull()
    expect(toSeedValue(3, 'x')).toBe(3)
  })

  it('undefined（导出文档缺键）抛 —— 缺一列是静默的，必须在这里红', () => {
    expect(() => toSeedValue(undefined, 'sys_role.description')).toThrow(/缺键/)
  })
})

describe('reshapeCollection —— sys_user', () => {
  it('列名对齐 + roles 拆成 sys_user_role 行', () => {
    const { rows, junctions } = reshapeCollection('sys_user', [userDoc()])
    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(Object.keys(row)).toEqual([
      'id',
      'user_name',
      'nick_name',
      'age',
      'gender',
      'avatar',
      'description',
      'status',
      'role_mode',
      'current_role_id',
      'mfa_setup',
      'created_at',
      'updated_at',
    ])
    expect(row.id).toBe(USER_ID)
    expect(row.user_name).toBe('visitor')
    expect(row.current_role_id).toBe(ROLE_ID)
    expect(row.created_at).toBe(TS)

    expect(junctions).toHaveLength(1)
    expect(junctions[0].table).toBe('sys_user_role')
    expect(junctions[0].rows).toEqual([{ user_id: USER_ID, role_id: ROLE_ID }])
  })

  it('同一个角色引用出现两次只落一行（复合主键去重）', () => {
    const { junctions } = reshapeCollection('sys_user', [userDoc({ roles: [ROLE_ID, ROLE_ID] })])
    expect(junctions[0].rows).toHaveLength(1)
  })

  it('roles 键缺失 → junction 零行（不抛）', () => {
    const doc = userDoc()
    delete doc.roles
    expect(reshapeCollection('sys_user', [doc]).junctions[0].rows).toEqual([])
  })

  it('id 不是 uuid → 抛（钉住「导出通道输出的已是 uuid 本体」这条前提）', () => {
    expect(() => reshapeCollection('sys_user', [userDoc({ _id: '5fc8e3cd0144eb274c1c9780' })])).toThrow(/必须是 uuid/)
  })

  it('引用不是 uuid → 抛（junction 行不能带 hex 历史 id）', () => {
    expect(() => reshapeCollection('sys_user', [userDoc({ roles: ['5fc8e3cd0144eb274c1c9780'] })])).toThrow(/不是 uuid/)
  })

  it('文档里出现未消费的键 → 抛（导出器加了字段而字段表没跟）', () => {
    expect(() => reshapeCollection('sys_user', [userDoc({ someNewField: 1 })])).toThrow(/未消费的键：someNewField/)
  })
})

describe('reshapeCollection —— sys_menu（meta 拍平）', () => {
  const menuDoc = (meta: Record<string, unknown>): Record<string, unknown> => ({
    _id: MENU_ID,
    pid: null,
    type: 'catalog',
    path: null,
    name: null,
    component: null,
    icon: null,
    title: 'app.base.root',
    meta: {
      order: 1,
      ternal: 'none',
      url: null,
      show: true,
      cache: false,
      status: true,
      affix: false,
      permission: null,
      menuActiveName: null,
      menuActiveSameTab: false,
      badge: null,
      activeIcon: null,
      position: false,
      leaveTip: false,
      maskUrl: false,
      hijackRefresh: false,
      watermark: null,
      transition: 'fade',
      cacheKeyStrategy: null,
      ...meta,
    },
    createdAt: new Date(TS),
    updatedAt: new Date(TS),
  })

  it('meta 的 19 个字段落到独立列，且不再有 meta 键', () => {
    const { rows } = reshapeCollection('sys_menu', [menuDoc({})])
    const row = rows[0]
    expect(row).not.toHaveProperty('meta')
    // 29 列 = 菜单自身 8 + meta 拍平 17 + id/created_at/updated_at
    expect(Object.keys(row)).toHaveLength(29)
    expect(row.sort_order).toBe(1)
    expect(row.is_show).toBe(true)
    expect(row.cache).toBe(false)
    expect(row.menu_active_same_tab).toBe(false)
    expect(row.transition).toBe('fade')
    expect(row.watermark).toBeNull()
  })

  it('jsonb 列（watermark）原样保留对象', () => {
    const { rows } = reshapeCollection('sys_menu', [menuDoc({ watermark: { content: 'w' } })])
    expect(rows[0].watermark).toEqual({ content: 'w' })
  })

  it('meta 缺键 → 抛（缺列比错列更危险）', () => {
    const doc = menuDoc({})
    delete (doc.meta as Record<string, unknown>).transition
    expect(() => reshapeCollection('sys_menu', [doc])).toThrow(/缺键/)
  })
})

describe('reshapeCollection —— sys_role', () => {
  it('menus 拆成 sys_role_menu 行（列序 role_id, menu_id）', () => {
    const { rows, junctions } = reshapeCollection('sys_role', [{
      _id: ROLE_ID,
      roleName: 'visitor',
      description: null,
      order: 2,
      menus: [MENU_ID],
      status: true,
      dataScope: 5,
      createdAt: new Date(TS),
      updatedAt: new Date(TS),
    }])
    expect(rows[0].role_name).toBe('visitor')
    expect(rows[0].sort_order).toBe(2)
    expect(rows[0].data_scope).toBe(5)
    expect(junctions[0].table).toBe('sys_role_menu')
    expect(junctions[0].rows).toEqual([{ role_id: ROLE_ID, menu_id: MENU_ID }])
  })
})

describe('注册表形态', () => {
  it('8 个业务集合 + 2 个 junction，junction 与父集合的对应关系固定', () => {
    expect(SEED_TABLES).toEqual([
      'app_setting',
      'sys_dict_data',
      'sys_dict_type',
      'sys_lang',
      'sys_locale',
      'sys_menu',
      'sys_role',
      'sys_user',
    ])
    expect(JUNCTION_TABLES).toEqual(['sys_role_menu', 'sys_user_role'])
    expect(JUNCTION_SPECS.sys_user.arrayKey).toBe('roles')
    expect(JUNCTION_SPECS.sys_role.arrayKey).toBe('menus')
  })

  it('每个业务表的列里都有 id / created_at / updated_at（行形态的最小不变量）', () => {
    for (const [collection, spec] of Object.entries(ROW_SPECS)) {
      const cols = spec.map(([column]) => column)
      expect(cols, collection).toContain('id')
      expect(cols, collection).toContain('created_at')
      expect(cols, collection).toContain('updated_at')
    }
  })

  it('未知集合 → 抛（新集合必须先登记列映射）', () => {
    expect(() => reshapeCollection('sys_device', [])).toThrow(/不在 ROW_SPECS/)
  })
})

describe('仓内 seed 文件（真源形态）', () => {
  const seedDir = fileURLToPath(new URL('../../../../../../apps/server/db/seed', import.meta.url))

  it('每个文件都是**行数组**：有 id、没有 $oid / $date 包装', () => {
    for (const collection of SEED_TABLES) {
      const text = readFileSync(join(seedDir, `${collection}.json`), 'utf8')
      expect(text, collection).not.toContain('"$oid"')
      expect(text, collection).not.toContain('"$date"')
      const rows = JSON.parse(text) as Record<string, unknown>[]
      expect(rows.length, collection).toBeGreaterThan(0)
      expect(typeof rows[0].id, collection).toBe('string')
      expect(rows[0], collection).toHaveProperty('created_at')
    }
  })

  it('junction 文件是复合主键行（没有 id 列）', () => {
    for (const table of JUNCTION_TABLES) {
      const rows = JSON.parse(readFileSync(join(seedDir, `${table}.json`), 'utf8')) as Record<string, unknown>[]
      expect(rows.length, table).toBeGreaterThan(0)
      expect(rows[0], table).not.toHaveProperty('id')
    }
  })

  it('stringifySeedRows：稳定 2 空格缩进 + 结尾换行（diff 可审）', () => {
    const text = stringifySeedRows([{ id: USER_ID }])
    expect(text).toBe(`[\n  {\n    "id": "${USER_ID}"\n  }\n]\n`)
  })
})
