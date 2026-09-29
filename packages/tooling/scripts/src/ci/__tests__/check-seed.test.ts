/**
 * `check-seed.ts` 的用例。
 *
 * 一半是**反例**：这份数据的失效方式全是静默的（私钥进仓、未裁剪账号被发布、引用坏了导致侧边栏空掉
 * 而不报错）—— 每条判据都得证明它**真的会红**，否则门禁只是安慰剂。
 * 另一半是**对真实仓库跑一遍**（本仓当前干净），那一条会在将来数据漂移时先红。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { collectFindings, FORBIDDEN_COLLECTIONS, REQUIRED_COLLECTIONS } from '../check-seed.ts'

const SEED_DIR = 'apps/server/db/seed'
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true })
})

/** 造一个临时仓库根，把给定的集合写成文件（值直接给 JS 值，内部按 JSON 落盘） */
function makeRepo(collections: Record<string, unknown>, extra: Record<string, string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'walnut-seed-gate-'))
  roots.push(root)
  const dir = join(root, SEED_DIR)
  mkdirSync(dir, { recursive: true })
  for (const [name, docs] of Object.entries(collections))
    writeFileSync(join(dir, `${name}.json`), `${JSON.stringify(docs, null, 2)}\n`)
  for (const [name, content] of Object.entries(extra))
    writeFileSync(join(dir, name), content)
  return root
}

/** 一份"最小合法"的数据集：满足必需集合、引用自洽、已裁剪 */
function validCollections(): Record<string, unknown> {
  const roleId = 'role-visitor'
  const menuId = 'menu-home'
  return {
    app_setting: [{ _id: 's1', settingKey: 'app.default.role', settingValue: roleId }],
    sys_dict_data: [],
    sys_dict_type: [],
    sys_lang: [{ _id: 'l1', lang: 'zh_CN', status: 'true', order: '2' }],
    sys_locale: [{ _id: 'lo1', key: 'app.base.yes', value: 'Yes' }],
    // 顶层菜单**不写 pid**（真实数据就是这么表达的；写 `'0'` 会被判成悬空引用）
    sys_menu: [{ _id: menuId, title: '首页' }],
    sys_role: [{ _id: roleId, roleName: 'visitor', menus: [menuId] }],
    sys_user: [{ _id: 'u1', userName: 'visitor', avatar: null, roles: [roleId], currentRole: { _id: roleId } }],
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

  it('混进刻意不进仓的集合（app_key / shared_area / credential 表）', () => {
    for (const name of FORBIDDEN_COLLECTIONS) {
      const found = collectFindings(makeRepo({ ...validCollections(), [name]: [{ _id: 'x' }] }))
      expect(found.some(f => f.file.endsWith(`${name}.json`)), name).toBe(true)
    }
  })

  it('凭据形状的字段名（keyB64 / privateKeyPem / totpSecretCiphertext …）', () => {
    const root = makeRepo({ ...validCollections(), app_setting: [{ _id: 's1', keyB64: 'AAAA', settingKey: 'app.default.role', settingValue: 'role-visitor' }] })
    expect(details(root)).toContain('凭据形状的字段 `keyB64`')
  })

  it('sys_user 未裁剪：混进非演示账号', () => {
    const collections = validCollections()
    collections.sys_user = [
      { _id: 'u1', userName: 'visitor', avatar: null, roles: ['role-visitor'] },
      { _id: 'u2', userName: 'someone-real', avatar: 'https://cdn.example.com/a.png', roles: ['role-visitor'] },
    ]
    expect(details(makeRepo(collections))).toContain('内容未按 policy.ts 裁剪')
  })

  it('sys_user 未裁剪：头像外链没置空', () => {
    const collections = validCollections()
    collections.sys_user = [{ _id: 'u1', userName: 'visitor', avatar: 'https://cdn.example.com/a.png', roles: ['role-visitor'] }]
    expect(details(makeRepo(collections))).toContain('未按 policy.ts 裁剪')
  })

  it('引用完整性：用户指向不存在的角色', () => {
    const collections = validCollections()
    collections.sys_user = [{ _id: 'u1', userName: 'visitor', avatar: null, roles: ['role-ghost'] }]
    expect(details(makeRepo(collections))).toContain('指向不存在的角色 role-ghost')
  })

  it('引用完整性：角色指向不存在的菜单', () => {
    const collections = validCollections()
    collections.sys_role = [{ _id: 'role-visitor', roleName: 'visitor', menus: ['menu-ghost'] }]
    expect(details(makeRepo(collections))).toContain('指向不存在的菜单 menu-ghost')
  })

  it('引用完整性：默认角色不存在（新用户会落到空角色）', () => {
    const collections = validCollections()
    collections.app_setting = [{ _id: 's1', settingKey: 'app.default.role', settingValue: 'role-ghost' }]
    expect(details(makeRepo(collections))).toContain('app.default.role 指向不存在的角色')
  })

  it('引用完整性：菜单的 pid 指向不存在的菜单', () => {
    const collections = validCollections()
    collections.sys_menu = [{ _id: 'menu-home', title: '首页', pid: 'menu-ghost' }]
    expect(details(makeRepo(collections))).toContain('pid 指向不存在的菜单')
  })

  it('解析失败（不是文档数组）', () => {
    const root = makeRepo(validCollections(), { 'sys_lang.json': '{"oops":1}' })
    expect(details(root)).toContain('解析失败')
  })

  it('体积预算：单文件超限（该考虑当发版资产发）', () => {
    // 1.1MB 的假数据 —— 只为越过 FILE_BUDGET_BYTES（1MB）
    const big = Array.from({ length: 4000 }, (_, i) => ({ _id: `x${i}`, padding: 'a'.repeat(280) }))
    const root = makeRepo({ ...validCollections(), sys_locale: big })
    expect(details(root)).toContain('超过预算')
  })
})
