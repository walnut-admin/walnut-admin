import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * F-23（CQ-007）i18n 词条 drift 守卫 —— 「代码里抛出的 errMsg key 必须有词条」。
 *
 * 背景：异常只带 key，最终文案由 i18n 在**响应期**才解析。key 拼错或词条漏建不会让
 * tsc / lint / 单测变红，接口照样 200 + 业务码，用户却在界面上看到原始 key
 * `business.auth.emailAlreadyBound`（本次修复的现实例证：oauth 的 github/gitee 两处
 * 抛出点，zh_CN / en_US 都缺这条）。
 *
 * 扫描面 = 代码真源（`libs/**` + `apps/api/src/**` 的静态字符串字面量）↔
 * 词条真源（`apps/api/src/i18n/<locale>/business.json` 拍平成点路径 ——
 * nestjs-i18n 的 I18nJsonLoader 就是按文件名做命名空间、嵌套对象拍平成点路径）。
 *
 * 有意的设计约束：
 * - 只认**整串**字面量（`'business.a.b'`）：动态拼接（模板串里插变量的 key）不参与对账，
 *   这类 key 需要调用方自己保证，本守卫不猜；
 * - 两个语种**键集合必须相等**：只补一个语言等于让另一个语言的用户看原始 key；
 * - 扫描到 0 个 key 直接红（正则写坏 / 目录迁移时守卫必须失效报警，而不是静默通过）。
 */

const SCAN_ROOTS = ['libs', 'apps/api/src'] as const
const SKIP_DIRS = new Set(['node_modules', 'dist', 'dist-stage'])
const LOCALES = ['zh_CN', 'en_US'] as const

const KEY_PATTERN = /['"`]business\.(\w+(?:\.\w+)*)['"`]/g

function walkTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) {
      continue
    }

    const target = join(dir, entry.name)

    if (entry.isDirectory()) {
      walkTsFiles(target, out)
      continue
    }

    if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
      out.push(target)
    }
  }

  return out
}

/** 代码侧引用到的 key（去掉 `business.` 命名空间前缀，与 JSON 文件内的层级对齐） */
function collectReferencedKeys(): Map<string, string[]> {
  const references = new Map<string, string[]>()

  for (const scanRoot of SCAN_ROOTS) {
    for (const file of walkTsFiles(resolve(process.cwd(), scanRoot))) {
      const text = readFileSync(file, 'utf8')
      for (const match of text.matchAll(KEY_PATTERN)) {
        const key = match[1]
        const files = references.get(key) ?? []
        files.push(relative(process.cwd(), file))
        references.set(key, files)
      }
    }
  }

  return references
}

/** locale 词条文件拍平成「点路径 → 值」 */
function flattenLocale(locale: typeof LOCALES[number]): Map<string, string> {
  const filePath = resolve(process.cwd(), 'apps/api/src/i18n', locale, 'business.json')
  const parsed = JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>
  const flat = new Map<string, string>()

  const visit = (node: Record<string, unknown>, prefix: string) => {
    for (const [key, value] of Object.entries(node)) {
      const path = prefix === '' ? key : `${prefix}.${key}`
      if (typeof value === 'string') {
        flat.set(path, value)
        continue
      }
      if (value !== null && typeof value === 'object') {
        visit(value as Record<string, unknown>, path)
        continue
      }
      // 非字符串叶子（数字/布尔/null/数组）不是可用词条 —— 让对账在这一步就看见
      flat.set(path, '')
    }
  }

  visit(parsed, '')
  return flat
}

describe('i18n 词条 drift 守卫（代码里的 business.* key ↔ zh_CN / en_US 词条，F-23）', () => {
  const referenced = collectReferencedKeys()
  const locales = new Map(LOCALES.map(locale => [locale, flattenLocale(locale)] as const))

  it('扫描面非空（正则/目录改坏时本守卫必须失效报警）', () => {
    expect(referenced.size).toBeGreaterThan(0)
  })

  it('覆盖本次修复的抛出点：oauth 的 business.auth.emailAlreadyBound 必须落在扫描结果内', () => {
    const files = referenced.get('auth.emailAlreadyBound') ?? []

    expect(files.some(file => file.endsWith('github.service.ts'))).toBe(true)
    expect(files.some(file => file.endsWith('gitee.service.ts'))).toBe(true)
  })

  it('每个被引用的 key 在两个语种都有非空词条', () => {
    const missing: string[] = []

    for (const [key, files] of [...referenced.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      for (const [locale, entries] of locales) {
        const value = entries.get(key)
        if (value === undefined || value === '') {
          missing.push(`${locale}: business.${key}（引用处：${[...new Set(files)].join(', ')}）`)
        }
      }
    }

    expect(missing, '缺少词条的 errMsg key（补 `apps/api/src/i18n/<locale>/business.json`）').toEqual([])
  })

  it('两个语种的键集合相等（只补一个语言 = 另一个语言的用户看到原始 key）', () => {
    const [first, second] = LOCALES
    const firstKeys = [...locales.get(first)!.keys()].sort()
    const secondKeys = [...locales.get(second)!.keys()].sort()

    expect(firstKeys).toEqual(secondKeys)
  })
})
