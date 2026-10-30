import type { EntityTarget, ObjectLiteral } from 'typeorm'
import type {
  IWalnutAdminDataScopeEntityConfig,
} from './data-scope'
import { readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { WalnutAdminConstDataScope, WalnutAdminConstDataScopeMode } from '@walnut-server/const/app/dataScope'
import { getMetadataArgsStorage, IsNull } from 'typeorm'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  buildWalnutDataScopeFindWhere,
  buildWalnutDataScopeSqlPredicate,
  getWalnutDataScopeEntityConfig,
  mergeWalnutDataScopeFindWhere,
  toWalnutDataScopeMode,
  WALNUT_DATA_SCOPE_ENTITIES,
  WALNUT_DATA_SCOPE_EXEMPT_ENTITIES,
} from './data-scope'

/**
 * 数据权限注册表守卫 + 谓词纯函数（docs/plans/data-scope-design.md §4 要点 3/4）。
 *
 * ① 注册完整性：**glob 全仓 `*.entity.ts` 动态 import**（不依赖 data-scope.ts 的显式
 *    import 清单 —— 否则新增实体只要没被 data-scope import 就天然逃过守卫），
 *    每张实体表必须逐张分类：注册（强制过滤）或豁免（逐条理由）。
 * ② 注册项真实：scopeColumn 必须是实体真实列；entity 必须是真实表。
 * ③ 谓词语义：ALL/SELF/CUSTOM/allowAnonymous/空集默认拒绝，SQL 与 FindOptions 两形态同源。
 */

function listEntityFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      found.push(...listEntityFiles(full))
    }
    else if (entry.isFile() && entry.name.endsWith('.entity.ts')) {
      found.push(full)
    }
  }
  return found
}

/** 本 spec 加载到的实体文件数（0 = glob 路径失效，守卫本身就是摆设） */
let loadedEntityFiles = 0

beforeAll(async () => {
  const entityDir = resolve(process.cwd(), 'apps/api/src/modules')
  const files = listEntityFiles(entityDir)

  // 动态 import（路径式）与 dto-entity drift spec 同款：commonjs tsconfig 下不能用
  // import.meta.glob；vitest 对绝对路径动态 import 走同一 transform 管道。
  for (const file of files) {
    await import(pathToFileURL(file).href)
  }

  loadedEntityFiles = files.length
})

function entityTableName(target: EntityTarget<ObjectLiteral>): string | undefined {
  return getMetadataArgsStorage().tables.find(table => table.target === target)?.name
}

/** EntityTarget 可能是 string / 类 / EntitySchema —— 测试里只用于报错信息 */
function targetName(target: EntityTarget<ObjectLiteral>): string {
  if (typeof target === 'string') {
    return target
  }
  return 'name' in target && typeof target.name === 'string' ? target.name : '<unnamed>'
}

function entityPropertyNames(target: EntityTarget<ObjectLiteral>): Set<string> {
  const columns = getMetadataArgsStorage().columns.filter(column => column.target === target).map(column => column.propertyName)
  const prototype = Object.getOwnPropertyNames((target as { prototype: object }).prototype)
    .filter(name => name !== 'constructor')

  return new Set([...columns, ...prototype])
}

/**
 * sys_user 的 owner 是主键 id 本身（SELF = 本人账号行）——注册完整性由
 * 「逐张分类」测试覆盖（sys_user 已注册，scopeColumn = id）。
 */

describe('数据权限注册表（注册 = 强制过滤；未注册 = 显式豁免）', () => {
  it('glob 加载到了实体文件（防止守卫因路径失效变成空断言）', () => {
    expect(loadedEntityFiles).toBeGreaterThan(0)
  })

  it('每张实体表都被显式分类（注册或豁免）——新增实体不登记即红', () => {
    const tables = getMetadataArgsStorage().tables.map(table => table.target as EntityTarget<ObjectLiteral>)
    const registered = new Set(WALNUT_DATA_SCOPE_ENTITIES.map(config => config.entity))
    const exempt = new Set(WALNUT_DATA_SCOPE_EXEMPT_ENTITIES.map(item => item.entity))

    const unclassified = tables
      .filter(target => !registered.has(target) && !exempt.has(target))
      .map(target => entityTableName(target) ?? targetName(target))

    expect(unclassified, '实体未登记进 WALNUT_DATA_SCOPE_ENTITIES 或 WALNUT_DATA_SCOPE_EXEMPT_ENTITIES').toEqual([])

    // 反向：清单里写了不存在的实体（改名/删除后未同步）
    const tableSet = new Set(tables)
    expect([...registered, ...exempt].filter(target => !tableSet.has(target)).map(target => entityTableName(target) ?? targetName(target)))
      .toEqual([])
  })

  it('注册项 ↔ 豁免项互斥且各自唯一', () => {
    const registered = WALNUT_DATA_SCOPE_ENTITIES.map(config => config.entity)
    const exempt = WALNUT_DATA_SCOPE_EXEMPT_ENTITIES.map(item => item.entity)

    expect(new Set(registered).size).toBe(registered.length)
    expect(new Set(exempt).size).toBe(exempt.length)
    expect(registered.filter(entity => exempt.includes(entity))).toEqual([])
  })

  it('注册的 scopeColumn 是实体真实列（属性名口径，TypeORM 负责列名映射）', () => {
    const problems: string[] = []

    for (const config of WALNUT_DATA_SCOPE_ENTITIES) {
      const props = entityPropertyNames(config.entity)
      if (!props.has(config.scopeColumn)) {
        problems.push(`${entityTableName(config.entity)}.${config.scopeColumn} 不是实体属性`)
      }
      if (config.note.trim() === '') {
        problems.push(`${entityTableName(config.entity)} 缺少注册理由`)
      }
    }

    expect(problems).toEqual([])
  })

  it('豁免清单每一条都有非空理由', () => {
    const missing = WALNUT_DATA_SCOPE_EXEMPT_ENTITIES
      .filter(({ reason }) => reason.trim() === '')
      .map(({ entity }) => entityTableName(entity) ?? targetName(entity))

    expect(missing).toEqual([])
  })

  it('一期注册清单快照（改清单必须同步本 spec 与文档）', () => {
    const names = WALNUT_DATA_SCOPE_ENTITIES.map(config => entityTableName(config.entity)).sort()

    expect(names).toEqual([
      'app_demo',
      'app_monitor_user',
      'sys_deleted',
      'sys_employee',
      'sys_log_auth',
      'sys_log_operate',
      'sys_user',
    ])
  })

  it('getWalnutDataScopeEntityConfig 按实体类引用命中（未注册返回 undefined）', () => {
    const demoConfig = getWalnutDataScopeEntityConfig(
      WALNUT_DATA_SCOPE_ENTITIES.find(config => entityTableName(config.entity) === 'app_demo')!.entity,
    )

    expect(demoConfig?.scopeColumn).toBe('createdBy')
    expect(getWalnutDataScopeEntityConfig(WALNUT_DATA_SCOPE_EXEMPT_ENTITIES[0].entity)).toBeUndefined()
  })
})

describe('数据权限谓词（决策层 → 执行层单点）', () => {
  const config = WALNUT_DATA_SCOPE_ENTITIES.find(item => entityTableName(item.entity) === 'app_demo')!
  const anonymousConfig: IWalnutAdminDataScopeEntityConfig = {
    ...config,
    allowAnonymous: true,
  }
  const userId = '11111111-1111-4111-8111-111111111111'

  it('aLL → 不注入谓词（null）', () => {
    expect(buildWalnutDataScopeSqlPredicate(config, { mode: WalnutAdminConstDataScopeMode.ALL }, userId, 'entity'))
      .toBeNull()
    expect(buildWalnutDataScopeFindWhere(config, { mode: WalnutAdminConstDataScopeMode.ALL }, userId))
      .toBeNull()
  })

  it('sELF → owner = 当前用户（参数化）', () => {
    const predicate = buildWalnutDataScopeSqlPredicate(
      config,
      { mode: WalnutAdminConstDataScopeMode.SELF },
      userId,
      'entity',
    )

    expect(predicate).toEqual({
      clause: 'entity.createdBy = :walnut_data_scope_user',
      params: { walnut_data_scope_user: userId },
    })

    expect(buildWalnutDataScopeFindWhere(config, { mode: WalnutAdminConstDataScopeMode.SELF }, userId))
      .toEqual([{ createdBy: userId }])
  })

  it('sELF + allowAnonymous → 并上 owner IS NULL', () => {
    const predicate = buildWalnutDataScopeSqlPredicate(
      anonymousConfig,
      { mode: WalnutAdminConstDataScopeMode.SELF },
      userId,
      'entity',
    )

    expect(predicate?.clause).toBe('(entity.createdBy = :walnut_data_scope_user OR entity.createdBy IS NULL)')

    const where = buildWalnutDataScopeFindWhere(anonymousConfig, { mode: WalnutAdminConstDataScopeMode.SELF }, userId)
    expect(where).toHaveLength(2)
  })

  it('cUSTOM → owner IN (:...userIds)（去重）', () => {
    const predicate = buildWalnutDataScopeSqlPredicate(
      config,
      { mode: WalnutAdminConstDataScopeMode.CUSTOM, userIds: [userId, userId, 'other'] },
      userId,
      'entity',
    )

    expect(predicate?.clause).toBe('entity.createdBy IN (:...walnut_data_scope_users)')
    expect(predicate?.params.walnut_data_scope_users).toEqual([userId, 'other'])
  })

  it('cUSTOM + allowAnonymous → IN 或 IS NULL', () => {
    const predicate = buildWalnutDataScopeSqlPredicate(
      anonymousConfig,
      { mode: WalnutAdminConstDataScopeMode.CUSTOM, userIds: [userId] },
      userId,
      'entity',
    )

    expect(predicate?.clause).toBe('(entity.createdBy IN (:...walnut_data_scope_users) OR entity.createdBy IS NULL)')
  })

  it('cUSTOM 空集 → 恒假（默认拒绝，不猜 ALL）', () => {
    expect(buildWalnutDataScopeSqlPredicate(
      config,
      { mode: WalnutAdminConstDataScopeMode.CUSTOM, userIds: [] },
      userId,
      'entity',
    )).toEqual({ clause: '1 = 0', params: {} })

    expect(buildWalnutDataScopeFindWhere(
      config,
      { mode: WalnutAdminConstDataScopeMode.CUSTOM, userIds: [] },
      userId,
    )).toBe('deny')
  })

  it('merge：业务条件与每个 scope 分支做 AND（OR 数组展开）', () => {
    const scope = buildWalnutDataScopeFindWhere(
      anonymousConfig,
      { mode: WalnutAdminConstDataScopeMode.SELF },
      userId,
    )
    const merged = mergeWalnutDataScopeFindWhere({ demoString: 'x' }, scope)

    expect(merged).toEqual([
      { demoString: 'x', createdBy: userId },
      { demoString: 'x', createdBy: IsNull() },
    ])
  })

  it('merge：deny 原样上抛（调用方按查无此行处理）', () => {
    expect(mergeWalnutDataScopeFindWhere({}, 'deny')).toBe('deny')
  })

  it('toWalnutDataScopeMode：1/2/3 映射，非法值 null', () => {
    expect(toWalnutDataScopeMode(WalnutAdminConstDataScope.ALL)).toBe(WalnutAdminConstDataScopeMode.ALL)
    expect(toWalnutDataScopeMode(WalnutAdminConstDataScope.SELF)).toBe(WalnutAdminConstDataScopeMode.SELF)
    expect(toWalnutDataScopeMode(WalnutAdminConstDataScope.CUSTOM)).toBe(WalnutAdminConstDataScopeMode.CUSTOM)
    expect(toWalnutDataScopeMode(0)).toBeNull()
    expect(toWalnutDataScopeMode(null)).toBeNull()
  })
})
