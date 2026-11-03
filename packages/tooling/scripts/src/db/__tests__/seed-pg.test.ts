import type { TableMeta } from '../seed-pg.ts'
/**
 * `src/db/seed-pg.ts` 的用例 —— 行形态播种器的**纯函数**部分。
 *
 * 需要真库的那半（元数据读取、真实 upsert）由 `db:seed:verify` 的双库对拍覆盖；
 * 这里钉的是那些「错了也不会报错」的地方：装载顺序、自引用深度排序、jsonb 绑参、列集校验。
 */
import { describe, expect, it } from 'vitest'
import {
  buildBusinessUpsertSql,
  buildJunctionInsertSql,
  orderTablesByFk,
  parseSeedPgArgs,
  prepareParam,
  resolveColumns,
  sortRowsBySelfRefDepth,
} from '../seed-pg.ts'

/** 造一份表元数据（只填用例关心的字段） */
function meta(partial: Partial<TableMeta> = {}): TableMeta {
  return {
    columns: ['id', 'created_at', 'updated_at'],
    requiredColumns: ['id', 'created_at', 'updated_at'],
    jsonbColumns: new Set(),
    primaryKey: ['id'],
    fkRefs: new Map(),
    selfRef: null,
    ...partial,
  }
}

describe('prepareParam（jsonb 绑参）', () => {
  it('jsonb 列的对象/数组 → JSON 文本（node-pg 会把 JS 数组按 PG 数组字面量发，jsonb 不认）', () => {
    expect(prepareParam([{ a: 1 }], true)).toBe('[{"a":1}]')
    expect(prepareParam({ a: 1 }, true)).toBe('{"a":1}')
  })

  it('jsonb 列的 null 与标量原样；非 jsonb 列一律原样', () => {
    expect(prepareParam(null, true)).toBeNull()
    expect(prepareParam('x', true)).toBe('x')
    expect(prepareParam([1, 2], false)).toEqual([1, 2])
  })
})

describe('uPSERT 语句', () => {
  it('业务表：ON CONFLICT (id) DO UPDATE，SET 列表不含 id', () => {
    const sql = buildBusinessUpsertSql('sys_user', ['id', 'user_name'], 2)
    expect(sql).toContain('INSERT INTO sys_user ("id", "user_name") VALUES ($1, $2), ($3, $4)')
    expect(sql).toContain('ON CONFLICT (id) DO UPDATE SET "user_name" = EXCLUDED."user_name"')
    expect(sql).not.toContain('"id" = EXCLUDED."id"')
  })

  it('junction 表：复合主键 ON CONFLICT DO NOTHING（只补缺不回收）', () => {
    const sql = buildJunctionInsertSql('sys_user_role', ['user_id', 'role_id'], 1, ['user_id', 'role_id'])
    expect(sql).toContain('ON CONFLICT ("user_id", "role_id") DO NOTHING')
  })

  it('junction 没有主键 → 抛（无从判重）', () => {
    expect(() => buildJunctionInsertSql('t', ['a'], 1, [])).toThrow(/没有主键/)
  })
})

describe('resolveColumns（列集校验）', () => {
  it('逐行列集必须一致（不一致会让多行 VALUES 错位）', () => {
    expect(() => resolveColumns('t', [{ id: 'a', x: 1 }, { id: 'b' }], meta({ columns: ['id', 'x'], requiredColumns: ['id'] }))).toThrow(/列集与首行不一致/)
  })

  it('出现 PG 表里没有的列 → 抛（表结构变了就重新导出）', () => {
    expect(() => resolveColumns('t', [{ id: 'a', ghost: 1 }], meta())).toThrow(/不存在的列：ghost/)
  })

  it('缺 NOT NULL 列 → 抛（不靠 PG 报错猜）', () => {
    expect(() => resolveColumns('t', [{ id: 'a' }], meta())).toThrow(/缺 NOT NULL 列：created_at, updated_at/)
  })

  it('合法行原样返回列序', () => {
    expect(resolveColumns('t', [{ id: 'a', created_at: 'x', updated_at: 'y' }], meta())).toEqual(['id', 'created_at', 'updated_at'])
  })
})

describe('orderTablesByFk（装载顺序 = FK 拓扑序）', () => {
  const metas = new Map<string, TableMeta>([
    ['sys_lang', meta()],
    ['sys_locale', meta({ fkRefs: new Map([['lang_id', 'sys_lang']]) })],
    ['sys_menu', meta({ selfRef: 'pid', fkRefs: new Map([['pid', 'sys_menu']]) })],
    ['sys_role', meta({ fkRefs: new Map([['x_role', 'sys_menu']]) })],
    ['sys_role_menu', meta({ primaryKey: ['role_id', 'menu_id'], fkRefs: new Map([['role_id', 'sys_role'], ['menu_id', 'sys_menu']]) })],
  ])

  it('父表先于子表；自引用不算环', () => {
    const ordered = orderTablesByFk(['sys_role_menu', 'sys_locale', 'sys_menu', 'sys_role', 'sys_lang'], metas)
    expect(ordered.indexOf('sys_lang')).toBeLessThan(ordered.indexOf('sys_locale'))
    expect(ordered.indexOf('sys_menu')).toBeLessThan(ordered.indexOf('sys_role'))
    expect(ordered.indexOf('sys_role')).toBeLessThan(ordered.indexOf('sys_role_menu'))
    expect(ordered.indexOf('sys_menu')).toBeLessThan(ordered.indexOf('sys_role_menu'))
  })

  it('只排参与本次播种的表（未播种的父表不参与，交给 PG 的 FK 兜底）', () => {
    expect(orderTablesByFk(['sys_locale'], metas)).toEqual(['sys_locale'])
  })

  it('成环 → 抛', () => {
    const cyclic = new Map<string, TableMeta>([
      ['a', meta({ fkRefs: new Map([['b_id', 'b']]) })],
      ['b', meta({ fkRefs: new Map([['a_id', 'a']]) })],
    ])
    expect(() => orderTablesByFk(['a', 'b'], cyclic)).toThrow(/成环/)
  })
})

describe('sortRowsBySelfRefDepth（pid 自引用 FK 的装载序）', () => {
  const row = (id: string, pid: string | null): Record<string, unknown> => ({ id, pid })

  it('子行排在父行之后（深度稳定排序，同深度保原序）', () => {
    const rows = [
      row('child-1', 'root-2'),
      row('root-1', null),
      row('grandchild', 'child-2'),
      row('root-2', null),
      row('child-2', 'root-1'),
    ]
    expect(sortRowsBySelfRefDepth(rows, 'pid').map(item => item.id)).toEqual(['root-1', 'root-2', 'child-1', 'child-2', 'grandchild'])
    // 不改入参
    expect(rows[0].id).toBe('child-1')
  })

  it('pid 指向本次不存在的行 → 抛（fail-closed）', () => {
    expect(() => sortRowsBySelfRefDepth([row('orphan', 'ghost')], 'pid')).toThrow()
  })

  it('pid 链成环 → 抛', () => {
    expect(() => sortRowsBySelfRefDepth([row('a', 'b'), row('b', 'a')], 'pid')).toThrow(/成环/)
  })

  it('深链（>2 级）正确展开', () => {
    expect(sortRowsBySelfRefDepth([row('l3', 'l2'), row('l2', 'l1'), row('l1', null)], 'pid').map(item => item.id)).toEqual(['l1', 'l2', 'l3'])
  })
})

describe('参数解析', () => {
  it('默认值：仓内 seed 目录、非 dry-run、造 app_key', () => {
    expect(parseSeedPgArgs([])).toMatchObject({ seedDir: 'apps/server/db/seed', dryRun: false, skipAppKeys: false })
  })

  it('--only 逗号分隔；未知参数抛', () => {
    expect(parseSeedPgArgs(['--only', 'sys_role, sys_user']).only).toEqual(['sys_role', 'sys_user'])
    expect(() => parseSeedPgArgs(['--nope'])).toThrow(/未知参数/)
  })
})
