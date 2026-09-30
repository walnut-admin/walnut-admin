/**
 * 把 CI workflow 里**必须成立的两条约束**钉住（它们都来自实测事故，而且都属于"改回去也不报错"的那种）。
 *
 * 用测试而不是新门禁：测试本来就跑在 `pnpm test`（prepush 与 CI 都跑）里 ⇒ 零额外接线，
 * 而这两条要守的都是"某个 workflow 文件里的一行字" ⇒ 测试是最省的正确工具。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { REPO_ROOT } from '../../lib/repo-root.ts'

const ci = readFileSync(join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8')

describe('ci.yml —— 构建产物必须由**无缓存**的那次来担保', () => {
  it('build admin 带 `--force`（忽略 turbo 缓存）', () => {
    // 事故：v0.1.4 发版死在 Build admin（dts 被读到半写内容），而同一提交的 CI 因为命中 turbo
    // 缓存没真构建 ⇒ 绿。CI 必须自己真构建一次，否则这类 bug 只能在发版时暴露。
    const step = ci.split('\n').find(line => line.includes('turbo run build --filter=@walnut/admin'))
    expect(step, 'ci.yml 里应当有构建 admin 的那一步').toBeDefined()
    expect(step).toContain('--force')
  })

  it('构建之后仍然跑产物冒烟（不要为了省时间把它挪走/删掉）', () => {
    // 事故（V13）：构建绿 ≠ 跑得起来 —— 产物一执行就抛错、页面停在 splash，而 tsc/lint/build 全绿。
    const buildIndex = ci.indexOf('turbo run build --filter=@walnut/admin')
    const smokeIndex = ci.indexOf('pnpm smoke:dist')
    expect(smokeIndex).toBeGreaterThan(buildIndex)
  })
})
