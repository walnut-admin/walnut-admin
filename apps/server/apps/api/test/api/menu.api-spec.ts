import type { NestExpressApplication } from '@nestjs/platform-express'
import type { WalnutRootUserFixture } from './helpers/auth-login'
import { randomUUID } from 'node:crypto'
import { WalnutAdminConstAppCacheKeys, WalnutAdminConstAppCacheType } from '@walnut-server/const/app/cache'
import { WalnutModelName } from '@walnut-server/db'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract/response-code'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { AppTechCacheService } from '@/modules/techniques/cache/cache.service'
import { bodyOf, expectOk, WalnutApiClient } from './helpers/api-client'
import { performHttpOpaqueLogin, registerRootUserFixture } from './helpers/auth-login'
import { createApiApp } from './helpers/create-api-app'

/**
 * C 段：`system/menu` —— GET tree + CRUD（pid 自引用、meta 拍平出入参往返、
 * delete `?_cascade=` 的两种行为）。
 *
 * - meta：入参经 flattenSysMenuMeta 拆 19 个拍平列（部分给出 → 缺省键回填 schema 默认
 *   值，对齐 Mongo 子文档整体替换）；出参经 assembleSysMenu 组装回 meta 对象（缺键回填
 *   默认值）。read/list/tree 断言往返后逐字段一致。
 * - `?_cascade=`（WalnutAdminDecoratorQueryDeleteCascade，query 名 `_cascade`，默认 0）：
 *   两种行为都是「软删 menu 本行（sys_deleted 快照 + 原行硬删）」，cascade=1 **额外**按
 *   title 级联软删 locale 行（menu.service.delete → localeSharedService.deleteByKey）；
 *   不是删子菜单（pid 自引用 FK 是 ON DELETE RESTRICT，防误删扩面在 DB 层兜底）。
 * - menu.tree 形态：`fullTree` 取的是 **首根节点**（order 最小的 pid=NULL 行）的
 *   children —— 集成库无 seed 菜单，本 spec 自建唯一根（order 给负值保证排最前）后树里
 *   只有子节点；`treeWithoutTypeElement` 走完整根数组，根节点在内。P1-8 修复后空表
 *   GET tree 回受控空树（fullTree=[]），不再 `fullTree[0].children` TypeError → 50000
 *   （空表形态由 menu.shared.service.spec 单测覆盖，集成层用例顺序仍先建菜单）。
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface MenuMeta {
  order?: number | null
  ternal?: string
  url?: string | null
  show?: boolean
  cache?: boolean
  status?: boolean
  affix?: boolean
  permission?: string | null
  transition?: string
  [key: string]: unknown
}

interface MenuRow {
  id: string
  pid?: string | null
  type?: string
  path?: string | null
  name?: string | null
  title?: string | null
  icon?: string | null
  meta?: MenuMeta
}

interface TreeNode {
  id?: string
  name?: string | null
  title?: string | null
  type?: string
  meta?: MenuMeta
  children?: TreeNode[]
}

interface TreeResponse {
  fullTree: TreeNode[]
  treeWithoutTypeElement: TreeNode[]
  menuActiveNamesOptions: Array<{ name: string | null, title: string | null }>
}

describe('C 段：system/menu tree + CRUD（meta 往返 / _cascade 两态）（真实 HTTP 全链）', () => {
  let app: NestExpressApplication
  let api: WalnutApiClient

  const seed8 = randomUUID().slice(0, 8)
  /** 菜单 name（partial unique）；本轮行统一前缀，afterEach 按 LIKE 清 */
  const namePrefix = `apispec${seed8}`
  let fixture: WalnutRootUserFixture | null = null

  /** locale 级联用例的载体行（lang 直插 + locale 走 HTTP） */
  let localeLangId = ''
  const localeKeyOf = (title: string) => title
  const zhMessageCacheKey = `${WalnutAdminConstAppCacheKeys.SYS_LOCALE_MESSAGES}:ZH_CN`

  function menuPayload(tag: string, overrides: Record<string, unknown> = {}) {
    return {
      pid: null,
      type: 'menu',
      path: `/${namePrefix}-${tag}`,
      name: `${namePrefix}-${tag}`,
      title: `menu.title.${seed8}.${tag}`,
      icon: 'mdi:test-tube',
      meta: { order: 1 },
      ...overrides,
    }
  }

  async function createMenu(tag: string, overrides: Record<string, unknown> = {}): Promise<MenuRow> {
    const res = await api.root('POST', api.apiPath('/system/menu'), menuPayload(tag, overrides))
    expectOk(res, `menu create ${tag}`)
    return bodyOf<MenuRow>(res).data
  }

  /** 递归找树里的节点（拿 name 对齐，name 本轮唯一） */
  function findNode(nodes: TreeNode[], name: string): TreeNode | null {
    for (const node of nodes) {
      if (node.name === name) {
        return node
      }
      if (node.children !== undefined && node.children.length > 0) {
        const hit = findNode(node.children, name)
        if (hit !== null) {
          return hit
        }
      }
    }
    return null
  }

  beforeAll(async () => {
    app = await createApiApp()
    api = await WalnutApiClient.create(app)

    // 固定缓存键跨轮共享，先清冷态（locale create/delete 的事务后刷新会重写它们）
    await api.cleanupFixedCacheKeys(zhMessageCacheKey, WalnutAdminConstAppCacheKeys.SYS_LANG_ID_LIST)

    fixture = await registerRootUserFixture(app, api.pgDataSource, `menu-${seed8}`)

    const tokens = await performHttpOpaqueLogin(api, app, fixture)
    api.setAuth(tokens)
    await api.seedMfaVerifiedCache(fixture.userId)

    // locale 级联腿的载体：lang 行直插（LocaleLangIdValidate 对空缓存放行任意 uuid）
    const langRows: Array<{ id: string }> = await api.pgDataSource.query(
      'INSERT INTO sys_lang (lang, description, "sort_order", status) VALUES ($1, $2, 1, true) RETURNING id',
      ['zh_CN', `menu-spec ${seed8}`],
    )
    localeLangId = langRows[0].id
  })

  /** pid 自引用 FK 是 ON DELETE RESTRICT：先删子行（pid 非空）再删根行 */
  async function cleanupMenuRows() {
    await api.pgDataSource.query(
      'DELETE FROM sys_menu WHERE pid IS NOT NULL AND (name LIKE $1 OR title LIKE $2)',
      [`${namePrefix}%`, `menu.title.${seed8}%`],
    )
    await api.pgDataSource.query(
      'DELETE FROM sys_menu WHERE name LIKE $1 OR title LIKE $2',
      [`${namePrefix}%`, `menu.title.${seed8}%`],
    )
  }

  afterEach(async () => {
    await cleanupMenuRows()
    await api.pgDataSource.query('DELETE FROM sys_locale WHERE key LIKE $1', [`menu.title.${seed8}%`])
    await api.pgDataSource.query('DELETE FROM sys_deleted WHERE content->>\'name\' LIKE $1', [`${namePrefix}%`])
    await api.pgDataSource.query('DELETE FROM sys_deleted WHERE content->>\'key\' LIKE $1', [`menu.title.${seed8}%`])
    await api.cleanupFixedCacheKeys(zhMessageCacheKey, WalnutAdminConstAppCacheKeys.SYS_LANG_ID_LIST)
  })

  afterAll(async () => {
    if (api !== undefined && fixture !== null) {
      await cleanupMenuRows()
      await api.pgDataSource.query('DELETE FROM sys_locale WHERE key LIKE $1', [`menu.title.${seed8}%`])
      await api.pgDataSource.query('DELETE FROM sys_deleted WHERE content->>\'name\' LIKE $1', [`${namePrefix}%`])
      if (localeLangId !== '') {
        await api.pgDataSource.query('DELETE FROM sys_lang WHERE id = $1', [localeLangId])
      }
      await api.pgDataSource.query('DELETE FROM sys_user WHERE id = $1', [fixture.userId])
      await api.pgDataSource.query('DELETE FROM sys_role WHERE id = $1', [fixture.roleId])
      await api.pgDataSource.query('DELETE FROM sys_device WHERE device_id = $1', [api.deviceId])
      await api.cleanupFixedCacheKeys(zhMessageCacheKey, WalnutAdminConstAppCacheKeys.SYS_LANG_ID_LIST)
      await api.cleanupWalnutCacheKeys(seed8, api.deviceId, fixture.userId)
    }
    await app.close()
  })

  it('create 带 meta → 19 列拍平落库；read 出参组装回 meta 对象（往返一致 + 缺省键回填）', async () => {
    const created = await createMenu('R1', {
      meta: {
        order: 7,
        show: false,
        cache: true,
        permission: `${namePrefix}:read`,
        ternal: 'external',
        url: 'https://example.com/menu-spec',
      },
    })
    expect(created.id).toMatch(UUID_RE)

    const readRes = await api.root('GET', api.apiPath(`/system/menu/${created.id}`))
    expectOk(readRes, 'menu read')
    const row = bodyOf<MenuRow>(readRes).data

    expect(row.pid).toBeNull()
    expect(row.name).toBe(`${namePrefix}-R1`)
    expect(row.title).toBe(`menu.title.${seed8}.R1`)
    expect(row.meta?.order).toBe(7)
    expect(row.meta?.show).toBe(false)
    expect(row.meta?.cache).toBe(true)
    expect(row.meta?.permission).toBe(`${namePrefix}:read`)
    expect(row.meta?.ternal).toBe('external')
    expect(row.meta?.url).toBe('https://example.com/menu-spec')
    // 未给的键回填 schema 默认值（与 Mongo 子文档默认值语义对齐）
    expect(row.meta?.status).toBe(true)
    expect(row.meta?.affix).toBe(false)
    expect(row.meta?.transition).toBe('fade')
    expect(row.meta?.menuActiveSameTab).toBe(false)
    expect(row.meta?.position).toBe(false)
    expect(row.meta?.leaveTip).toBe(false)
    expect(row.meta?.maskUrl).toBe(false)
    expect(row.meta?.hijackRefresh).toBe(false)
  })

  it('pid 自引用：子菜单挂父 pid → tree 建出父子层级（fullTree 只回首根 children、treeWithoutTypeElement 含根）', async () => {
    const parent = await createMenu('T1', { type: 'catalog', meta: { order: -100 } })
    const child = await createMenu('T2', { pid: parent.id, meta: { order: 1 } })

    const treeRes = await api.root('GET', api.apiPath('/system/menu/tree'))
    expectOk(treeRes, 'menu tree')
    const tree = bodyOf<TreeResponse>(treeRes).data

    // 本 spec 的根是当前 order 最小的根节点 → fullTree = 它的 children，只含子节点
    expect(findNode(tree.fullTree, `${namePrefix}-T1`)).toBeNull()
    const childNode = findNode(tree.fullTree, `${namePrefix}-T2`)
    expect(childNode).not.toBeNull()
    expect(childNode?.id).toBe(child.id)
    expect(childNode?.meta?.order).toBe(1)

    // treeWithoutTypeElement 走完整根数组：根与子都在
    const parentNode = findNode(tree.treeWithoutTypeElement, `${namePrefix}-T1`)
    expect(parentNode?.id).toBe(parent.id)
    expect(findNode(tree.treeWithoutTypeElement, `${namePrefix}-T2`)).not.toBeNull()

    // menuActiveNamesOptions 收 type=menu 的 name/title
    const option = tree.menuActiveNamesOptions.find(i => i.name === `${namePrefix}-T2`)
    expect(option?.title).toBe(`menu.title.${seed8}.T2`)
  })

  it('update 给 meta → 19 列整体替换（缺省键回默认值）；不给 meta → meta 列原样不动；F3：仅权限相关列变化才清权限缓存', async () => {
    const created = await createMenu('U1', { meta: { order: 5, show: false, cache: true } })

    // F3（2026-10-28）：菜单写路径不再无条件全清 AUTH:PERMISSIONS:* —— create 不清，
    // update 仅在 permission / status 真变化时清。预置哨兵键验证三种 update 形态。
    const cacheService = app.get(AppTechCacheService)
    const sentinelKey = `${WalnutAdminConstAppCacheKeys.AUTH_PERMISSIONS}:sentinel-${seed8}:device-sentinel`
    await cacheService.set(sentinelKey, ['system:menu:list'], { t: WalnutAdminConstAppCacheType.AUTH, ttl: 600 })
    expect(await api.hasWalnutCacheKey(sentinelKey)).toBe(true)

    // create 不失效（新菜单未挂角色，既有权限串不变）
    const createdForSentinel = await createMenu('U2')
    expect(await api.hasWalnutCacheKey(sentinelKey)).toBe(true)
    await api.root('DELETE', api.apiPath(`/system/menu/${createdForSentinel.id}`))
    expect(await api.hasWalnutCacheKey(sentinelKey)).toBe(false)

    // 重建哨兵后跑 update 三态
    await cacheService.set(sentinelKey, ['system:menu:list'], { t: WalnutAdminConstAppCacheType.AUTH, ttl: 600 })

    // 只给 order：show/cache 被整体替换回默认值（对齐 Mongo meta 子文档整体替换）；
    // permission/status 未变 → 权限缓存保留
    const updateRes = await api.root('PUT', api.apiPath(`/system/menu/${created.id}`), {
      title: `menu.title.${seed8}.U1-b`,
      meta: { order: 6 },
    })
    expectOk(updateRes, 'menu update with meta')
    let row = bodyOf<MenuRow>(updateRes).data
    expect(row.title).toBe(`menu.title.${seed8}.U1-b`)
    expect(row.meta?.order).toBe(6)
    expect(row.meta?.show).toBe(true)
    expect(row.meta?.cache).toBe(false)
    expect(await api.hasWalnutCacheKey(sentinelKey)).toBe(true)

    // 不给 meta：只有顶层字段变，meta 列保持上一轮的值 → 仍不失效
    const update2 = await api.root('PUT', api.apiPath(`/system/menu/${created.id}`), {
      title: `menu.title.${seed8}.U1-c`,
      icon: 'mdi:updated',
    })
    expectOk(update2, 'menu update without meta')
    row = bodyOf<MenuRow>(update2).data
    expect(row.icon).toBe('mdi:updated')
    expect(row.meta?.order).toBe(6)
    expect(row.meta?.show).toBe(true)
    expect(await api.hasWalnutCacheKey(sentinelKey)).toBe(true)

    // permission 真变化 → 全量清（哨兵消失）
    const update3 = await api.root('PUT', api.apiPath(`/system/menu/${created.id}`), {
      meta: { order: 6, permission: `system:menu:probe-${seed8}` },
    })
    expectOk(update3, 'menu update with permission change')
    expect(bodyOf<MenuRow>(update3).data.meta?.permission).toBe(`system:menu:probe-${seed8}`)
    expect(await api.hasWalnutCacheKey(sentinelKey)).toBe(false)
  })

  it('list → 按 name 过滤 + 出参组装 meta', async () => {
    await createMenu('L1', { meta: { order: 3 } })

    const listRes = await api.root('POST', api.apiPath('/system/menu/list'), {
      query: { name: `${namePrefix}-L1` },
      sort: [{ field: 'createdAt', order: 'ascend', priority: 1 }],
      page: { page: 1, pageSize: 10 },
    })
    expectOk(listRes, 'menu list')
    const list = bodyOf<{ data: MenuRow[], total: number }>(listRes).data
    expect(list.total).toBe(1)
    expect(list.data[0].meta?.order).toBe(3)
    expect(list.data[0].meta?.ternal).toBe('none')
  })

  it('delete _cascade=0（默认）→ 菜单软删，同 title 的 locale 行幸存', async () => {
    const created = await createMenu('C0')
    const createLocaleRes = await api.root('POST', api.apiPath('/system/locale'), {
      key: localeKeyOf(`menu.title.${seed8}.C0`),
      [localeLangId]: 'v-cascade-0',
    })
    expectOk(createLocaleRes, 'locale create for cascade=0')

    const deleteRes = await api.root('DELETE', api.apiPath(`/system/menu/${created.id}`))
    expectOk(deleteRes, 'menu delete cascade=0')

    const leftMenu: Array<{ c: number }> = await api.pgDataSource.query(
      'SELECT count(*)::int AS c FROM sys_menu WHERE id = $1',
      [created.id],
    )
    expect(leftMenu[0].c).toBe(0)

    const leftLocale: Array<{ c: number }> = await api.pgDataSource.query(
      'SELECT count(*)::int AS c FROM sys_locale WHERE key = $1',
      [localeKeyOf(`menu.title.${seed8}.C0`)],
    )
    expect(leftLocale[0].c).toBe(1)

    // 只有 menu 的快照行
    const snapshots: Array<{ model_name: string }> = await api.pgDataSource.query(
      'SELECT model_name FROM sys_deleted WHERE deleted_id = $1',
      [created.id],
    )
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0].model_name).toBe(WalnutModelName.SYS_MENU)
  })

  it('delete _cascade=1 → 菜单软删 + 同 title 的 locale 行级联软删', async () => {
    const created = await createMenu('C1')
    const createLocaleRes = await api.root('POST', api.apiPath('/system/locale'), {
      key: localeKeyOf(`menu.title.${seed8}.C1`),
      [localeLangId]: 'v-cascade-1',
    })
    expectOk(createLocaleRes, 'locale create for cascade=1')

    const deleteRes = await api.root('DELETE', api.apiPath(`/system/menu/${created.id}?_cascade=1`))
    expectOk(deleteRes, 'menu delete cascade=1')

    const leftLocale: Array<{ c: number }> = await api.pgDataSource.query(
      'SELECT count(*)::int AS c FROM sys_locale WHERE key = $1',
      [localeKeyOf(`menu.title.${seed8}.C1`)],
    )
    expect(leftLocale[0].c).toBe(0)

    // menu + locale 两腿各有一行快照（同 title 快照按 content.key 补判）
    const localeSnapshots: Array<{ c: number }> = await api.pgDataSource.query(
      'SELECT count(*)::int AS c FROM sys_deleted WHERE content->>\'key\' = $1',
      [localeKeyOf(`menu.title.${seed8}.C1`)],
    )
    expect(localeSnapshots[0].c).toBe(1)
  })

  it('校验失败 → 40099（pid 非 uuid / 非法 type 枚举 / 未知字段）', async () => {
    const badPid = await api.root('POST', api.apiPath('/system/menu'), menuPayload('V1', { pid: 'not-a-uuid' }))
    expect(bodyOf(badPid).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)

    const badType = await api.root('POST', api.apiPath('/system/menu'), menuPayload('V2', { type: 'folder' }))
    expect(bodyOf(badType).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)

    const unknownField = await api.root('POST', api.apiPath('/system/menu'), {
      ...menuPayload('V3'),
      notAField: 'boom',
    })
    expect(bodyOf(unknownField).code).toBe(WalnutAdminConstAppResponseCode.BAD_REQUEST_DATA_ERROR)
  })

  it('read 不存在的 uuid → 40401', async () => {
    const readRes = await api.root('GET', api.apiPath(`/system/menu/${randomUUID()}`))
    expect(bodyOf(readRes).code).toBe(WalnutAdminConstAppResponseCode.NOT_FOUND_DATA_NOT_FOUND)
  })
})
