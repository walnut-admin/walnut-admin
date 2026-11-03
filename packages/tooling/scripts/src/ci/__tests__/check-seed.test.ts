/**
 * `check-seed.ts`（`pnpm lint:seed`）的用例。
 *
 * 一半是**反例**：这份数据的失效方式全是静默的（私钥进仓、未裁剪账号被发布、引用坏了导致侧边栏空掉
 * 而不报错、真源被写回 Extended JSON）—— 每条判据都得证明它**真的会红**，否则门禁只是安慰剂。
 * 另一半是**对真实仓库跑一遍**（本仓当前干净），那一条会在将来数据漂移时先红。
 *
 * 夹具用**行形态**（`{ id, … }` + junction 独立文件）—— 那正是现在的真源形态。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { collectFindings, FORBIDDEN_COLLECTIONS, REQUIRED_COLLECTIONS, REQUIRED_JUNCTION_COLLECTIONS, seedInputsTouched } from '../check-seed.ts'

const SEED_DIR = 'apps/server/db/seed'
const TS = '2020-11-24T13:54:44.222Z'
const ROLE_ID = 'd6e8ca57-1faf-56d7-b090-9ff0c0b78ce6'
const MENU_ID = '001b1262-ac50-5fbf-8bf0-cca2a87c8353'
const USER_ID = '404d0cbd-1328-58e5-a5a7-e9f5de7c0895'
const LANG_ID = '0e5a2b4c-9d8e-4f3a-b2c1-6d5e4f3a2b1c'
const GHOST_ID = '55555555-5555-5555-8555-555555555555'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true })
})

/** 造一个临时仓库根，把给定的表写成行形态文件（值直接给 JS 值，内部按 JSON 落盘） */
function makeRepo(collections: Record<string, unknown>, extra: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'walnut-seed-gate-'))
  roots.push(root)
  const dir = join(root, SEED_DIR)
  mkdirSync(dir, { recursive: true })
  for (const [name, rows] of Object.entries(collections))
    writeFileSync(join(dir, `${name}.json`), `${JSON.stringify(rows, null, 2)}\n`)
  for (const [name, content] of Object.entries(extra))
    writeFileSync(join(dir, name), content)
  return root
}

/** 一行合法业务行（id + 两个时间戳 + 业务列） */
function row(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, created_at: TS, updated_at: TS, ...extra }
}

/** 一份"最小合法"的行形态数据集：满足必需表、引用自洽、已裁剪 */
function validCollections(): Record<string, unknown> {
  return {
    app_setting: [
      row('11111111-1111-5111-8111-111111111111', { setting_name: '默认角色', setting_key: 'app.default.role', setting_value: ROLE_ID, setting_type: 'functional' }),
      // P2-15：永久黑名单的写回锚点，必须显式存在（check-seed 机械核对）
      row('22222222-2222-5222-8222-222222222222', { setting_name: '黑名单', setting_key: 'app.global.ipBlackList', setting_value: '[]', setting_type: 'functional' }),
    ],
    sys_dict_data: [],
    sys_dict_type: [],
    sys_lang: [row(LANG_ID, { lang: 'zh_CN', sort_order: 2, status: true })],
    sys_locale: [row('33333333-3333-5333-8333-333333333333', { lang_id: LANG_ID, key: 'app.base.yes', value: 'Yes' })],
    // 顶层菜单的 pid 是 null（真实数据就是这么表达的）
    sys_menu: [row(MENU_ID, { pid: null, type: 'catalog', title: '首页' })],
    sys_role: [row(ROLE_ID, { role_name: 'visitor', sort_order: 2, status: true, data_scope: 1 })],
    sys_role_menu: [{ role_id: ROLE_ID, menu_id: MENU_ID }],
    sys_user: [row(USER_ID, { user_name: 'visitor', avatar: null, status: true, role_mode: 'switchable', current_role_id: ROLE_ID })],
    sys_user_role: [{ user_id: USER_ID, role_id: ROLE_ID }],
  }
}

const details = (root: string): string => collectFindings(root).map(f => `${f.file} ${f.detail}`).join('\n')

describe('collectFindings —— 正对照与真实仓库', () => {
  it('最小合法数据集零问题', () => {
    expect(collectFindings(makeRepo(validCollections()))).toEqual([])
  })

  it('本仓当前干净（这条会在数据漂移时先红）', () => {
    const root = fileURLToPath(new URL('../../../../../../', import.meta.url))
    expect(collectFindings(root).map(f => `${f.file} ${f.detail}`)).toEqual([])
  })
})

describe('collectFindings —— 反例（每条判据都要能红）', () => {
  it('缺必需集合', () => {
    const collections = validCollections()
    delete collections.sys_locale
    const found = collectFindings(makeRepo(collections))
    expect(found.some(f => f.detail.includes('缺少必需集合 sys_locale'))).toBe(true)
    expect(REQUIRED_COLLECTIONS).toContain('sys_locale')
  })

  it('缺 junction 文件（权限会空掉且不报错）', () => {
    const collections = validCollections()
    delete collections.sys_user_role
    const found = collectFindings(makeRepo(collections))
    expect(found.some(f => f.detail.includes('缺少必需 junction 文件 sys_user_role.json'))).toBe(true)
    expect(REQUIRED_JUNCTION_COLLECTIONS).toContain('sys_user_role')
  })

  it('混进刻意不进仓的集合（app_key / shared_area / credential 表）', () => {
    for (const name of FORBIDDEN_COLLECTIONS) {
      const found = collectFindings(makeRepo({ ...validCollections(), [name]: [{ id: 'x' }] }))
      expect(found.some(f => f.file.endsWith(`${name}.json`)), name).toBe(true)
    }
  })

  it('凭据形状的字段名（行形态 key_b64 / 文档形态 keyB64 都要拦）', () => {
    for (const key of ['keyB64', 'key_b64', 'value_hash']) {
      const root = makeRepo({
        ...validCollections(),
        app_setting: [{ id: '11111111-1111-5111-8111-111111111111', [key]: 'AAAA', setting_key: 'app.default.role', setting_value: ROLE_ID, setting_type: 'functional', created_at: TS, updated_at: TS }],
      })
      expect(details(root), key).toContain(`凭据形状的字段 \`${key}\``)
    }
  })

  it('真源被写回 Extended JSON（$oid / $date）', () => {
    const root = makeRepo(validCollections(), {
      'sys_lang.json': JSON.stringify([{ _id: { $oid: '5fc8e3cd0144eb274c1c9780' }, createdAt: { $date: TS } }]),
    })
    expect(details(root)).toContain('出现 Extended JSON 包装')
  })

  it('sys_user 未裁剪：混进非演示账号', () => {
    const collections = validCollections()
    collections.sys_user = [
      row(USER_ID, { user_name: 'visitor', avatar: null, current_role_id: ROLE_ID }),
      row('44444444-4444-5444-8444-444444444444', { user_name: 'someone-real', avatar: 'https://cdn.example.com/a.png', current_role_id: ROLE_ID }),
    ]
    expect(details(makeRepo(collections))).toContain('内容未按 policy.ts 裁剪')
  })

  it('sys_user 未裁剪：头像外链没置空', () => {
    const collections = validCollections()
    collections.sys_user = [row(USER_ID, { user_name: 'visitor', avatar: 'https://cdn.example.com/a.png', current_role_id: ROLE_ID })]
    expect(details(makeRepo(collections))).toContain('未按 policy.ts 裁剪')
  })

  it('引用完整性：授权行指向不存在的用户/菜单', () => {
    const ghostUser = validCollections()
    ghostUser.sys_user_role = [{ user_id: '44444444-4444-5444-8444-444444444444', role_id: ROLE_ID }]
    expect(details(makeRepo(ghostUser))).toContain('授权行指向不存在的用户')

    const ghostMenu = validCollections()
    ghostMenu.sys_role_menu = [{ role_id: ROLE_ID, menu_id: GHOST_ID }]
    expect(details(makeRepo(ghostMenu))).toContain('指向不存在的菜单')
  })

  it('引用完整性：默认角色不存在（新用户会落到空角色）', () => {
    const collections = validCollections()
    collections.app_setting = [row('11111111-1111-5111-8111-111111111111', { setting_key: 'app.default.role', setting_value: GHOST_ID })]
    expect(details(makeRepo(collections))).toContain('app.default.role 指向不存在的角色')
  })

  it('引用完整性：locale 的 lang_id / dict_data 的 type_id 悬空', () => {
    const locale = validCollections()
    locale.sys_locale = [row('33333333-3333-5333-8333-333333333333', { lang_id: GHOST_ID, key: 'k' })]
    expect(details(makeRepo(locale))).toContain('lang_id 指向不存在的语言')

    const dict = validCollections()
    dict.sys_dict_data = [row('66666666-6666-5666-8666-666666666666', { type_id: GHOST_ID, label: 'l', value: 'v' })]
    expect(details(makeRepo(dict))).toContain('type_id 指向不存在的字典类型')
  })

  it('p2-15：缺少 app.global.ipBlackList 显式默认行（黑名单写腿静默 no-op）', () => {
    const collections = validCollections()
    collections.app_setting = [row('11111111-1111-5111-8111-111111111111', { setting_key: 'app.default.role', setting_value: ROLE_ID })]
    expect(details(makeRepo(collections))).toContain('缺少显式默认行 app.global.ipBlackList')
  })

  it('p2-15：app.global.ipBlackList 的 value 不是合法 JSON 字符串数组', () => {
    const invalidJson = validCollections()
    invalidJson.app_setting = [
      row('11111111-1111-5111-8111-111111111111', { setting_key: 'app.default.role', setting_value: ROLE_ID }),
      row('22222222-2222-5222-8222-222222222222', { setting_key: 'app.global.ipBlackList', setting_value: 'not-json' }),
    ]
    expect(details(makeRepo(invalidJson))).toContain('app.global.ipBlackList 形态不对')

    const notArray = validCollections()
    notArray.app_setting = [
      row('11111111-1111-5111-8111-111111111111', { setting_key: 'app.default.role', setting_value: ROLE_ID }),
      row('22222222-2222-5222-8222-222222222222', { setting_key: 'app.global.ipBlackList', setting_value: '{"ip":"1.2.3.4"}' }),
    ]
    expect(details(makeRepo(notArray))).toContain('value 必须是 JSON 字符串数组')
  })

  it('引用完整性：菜单的 pid 指向不存在的菜单', () => {
    const collections = validCollections()
    collections.sys_menu = [row(MENU_ID, { pid: GHOST_ID, title: '首页' })]
    expect(details(makeRepo(collections))).toContain('pid 指向不存在的菜单')
  })

  it('行形态：id 不是 uuid / 列集不一致 / junction 带了 id', () => {
    const badId = validCollections()
    badId.sys_lang = [row('l1', { lang: 'zh_CN' })]
    expect(details(makeRepo(badId))).toContain('id 必须是 uuid')

    const ragged = validCollections()
    ragged.sys_locale = [
      row('33333333-3333-5333-8333-333333333333', { lang_id: LANG_ID, key: 'a', value: 'v' }),
      row('77777777-7777-5777-8777-777777777777', { lang_id: LANG_ID, key: 'b' }),
    ]
    expect(details(makeRepo(ragged))).toContain('列集与首行不一致')

    const junctionWithId = validCollections()
    junctionWithId.sys_user_role = [{ id: USER_ID, user_id: USER_ID, role_id: ROLE_ID }]
    expect(details(makeRepo(junctionWithId))).toContain('不该有 id 列')
  })

  it('解析失败（不是行数组）', () => {
    const root = makeRepo(validCollections(), { 'sys_lang.json': '{"oops":1}' })
    expect(details(root)).toContain('解析失败')
  })

  it('未脱敏的个人数据（与 \`db:export:pg --anonymize\` 同一套规则自检）', () => {
    const root = makeRepo({
      ...validCollections(),
      sys_device: [row('88888888-8888-5888-8888-888888888888', { device_id: 'fp_9f2c41ab77de5510', ip: '203.0.113.7' })],
    })
    const found = details(root)
    expect(found).toContain('未脱敏的个人数据：device_id=')
    expect(found).toContain('未脱敏的个人数据：ip=')
  })

  it('未登记的表文件（既不是业务集合也不是 junction）', () => {
    const root = makeRepo({ ...validCollections(), sys_whatever: [] })
    expect(details(root)).toContain('未登记的表文件')
  })

  it('体积预算：单文件超限（该考虑当发版资产发）', () => {
    // 1.1MB 的假数据 —— 只为越过 FILE_BUDGET_BYTES（1MB）
    const big = Array.from({ length: 4000 }, (_, i) => row(`77777777-7777-5777-8777-${String(i).padStart(12, '0')}`, { padding: 'a'.repeat(280) }))
    const root = makeRepo({ ...validCollections(), sys_locale: big })
    expect(details(root)).toContain('超过预算')
  })
})

/**
 * 「什么时候必须手动跑 `pnpm db:seed:verify`」的判据（`seedInputsTouched`）。
 *
 * 为什么这条判据值得用例：**没有任何自动门禁在跑双库对拍**，所以「该跑而没跑」这件事
 * 只能靠这条提示。判据若漏报，提示就不响；若误报，提示会变成噪音（一个开始误报的门禁
 * 等于没有门禁）—— 两个方向都得钉住。
 */
describe('seedInputsTouched —— seed 输入面的判据', () => {
  it('seed 数据目录里的任何文件都算（含新加的表）', () => {
    expect(seedInputsTouched([
      'apps/server/db/seed/sys_user.json',
      'apps/server/db/seed/sys_brand_new_table.json',
    ])).toEqual([
      'apps/server/db/seed/sys_user.json',
      'apps/server/db/seed/sys_brand_new_table.json',
    ])
  })

  it('三个 TS 输入面都算（reshape / policy / seed-pg：改它们等于改「导出的什么」）', () => {
    const inputs = [
      'packages/tooling/scripts/src/db/seed-reshape.ts',
      'packages/tooling/scripts/src/db/policy.ts',
      'packages/tooling/scripts/src/db/seed-pg.ts',
    ]
    expect(seedInputsTouched(inputs)).toEqual(inputs)
  })

  it('无关路径不命中（相邻文件 / 前缀相似的目录都不许误报）', () => {
    expect(seedInputsTouched([
      'apps/server/db/seed-pg-notes.md', // 只是前几个字符与 seed/ 相同
      'packages/tooling/scripts/src/db/seed-verify.ts', // 对拍脚本本身：改它不改变数据集
      'packages/tooling/scripts/src/db/policy.spec.ts',
      'packages/tooling/scripts/src/ci/check-seed.ts',
      'apps/admin/src/main.ts',
    ])).toEqual([])
  })

  it('空 diff ⇒ 空结果（提示不响），且不改动入参', () => {
    const input = ['apps/server/db/seed/sys_menu.json', 'apps/admin/src/main.ts'] as const
    expect(seedInputsTouched([])).toEqual([])
    expect(seedInputsTouched(input)).toEqual(['apps/server/db/seed/sys_menu.json'])
    expect(input.length).toBe(2)
  })
})
