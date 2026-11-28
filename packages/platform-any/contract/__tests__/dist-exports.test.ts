/**
 * CJS 产物形状门禁（tsdown 接管打包之后新增）。
 *
 * 守两件**打包器特有的**静默失败：
 * ① `default` 导出变形 —— CJS 里 `export { default as foo }` 不会 unwrap，消费者拿到的是
 *    `{ default: foo }`；本仓公共模块禁止 default 导出（`src/index.ts` 的 barrel 也只做具名再导出）。
 * ② barrel 漏跑 —— `scripts/build-barrel.ts` 覆盖 `dist/index.cjs`；它没跑时 index 只剩
 *    tsdown 自己 bundle 的那一份，键集会变。
 *
 * 读的是**真实产物**。前置条件由 `test` 脚本保证（`pnpm run build && vitest run`）：
 * turbo 的 `test` 只有 `dependsOn: ["^build"]`（只建依赖包、不建自己），CI 里 `turbo run test`
 * 之前也没有 build 步骤 —— 直接把「没构建」判红会在干净检出上让 CI 必红，所以改成脚本自带前置。
 */
import { existsSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const require_ = createRequire(import.meta.url)
const distDir = join(import.meta.dirname, '..', 'dist')

/**
 * 纯类型模块：`src` 里只有 `interface` / `type`，CJS 产物只有 `__esModule` 标记、没有运行时键。
 * 这张名单同时被下面的「空产物名单必须恰好等于它」钉住 —— 新增一个空模块会立刻变红，
 * 不让它静默混进「允许为空」的豁免里。
 */
const TYPE_ONLY_MODULES = ['response', 'token'] as const

describe('dist 产物形状（CJS）', () => {
  it('dist 存在（前置条件：build 已跑）', () => {
    expect(existsSync(distDir), 'dist 不存在：先跑 pnpm --filter @walnut/contract build').toBe(true)
  })

  it('每个 dist/*.cjs 都有具名导出，且不含 default（禁止 default 导出的契约）', () => {
    const files = readdirSync(distDir).filter((f) => f.endsWith('.cjs'))
    expect(files.length, 'dist 里没有任何 .cjs 产物').toBeGreaterThan(0)

    for (const file of files) {
      const mod = require_(join(distDir, file)) as Record<string, unknown>
      // 纯类型模块例外（名单与依据见下方那条用例）
      if (
        !TYPE_ONLY_MODULES.includes(
          file.slice(0, -'.cjs'.length) as (typeof TYPE_ONLY_MODULES)[number],
        )
      )
        expect(Object.keys(mod).length, `${file} 没有任何导出`).toBeGreaterThan(0)
      expect(
        Object.hasOwn(mod, 'default'),
        `${file} 出现了 default 导出（tsdown 的 export { default as x } 不会 unwrap）`,
      ).toBe(false)
    }
  })

  it('空产物名单恰好是纯类型模块（新增空模块必须显式登记）', () => {
    const files = readdirSync(distDir).filter((f) => f.endsWith('.cjs'))
    const empty = files
      .filter((file) => Object.keys(require_(join(distDir, file)) as object).length === 0)
      .map((file) => file.slice(0, -'.cjs'.length))
      .sort()
    expect(empty).toEqual([...TYPE_ONLY_MODULES].sort())
  })

  it('index.cjs 的键集 = 所有子模块键集的并集（barrel 语义，键不允许变形）', () => {
    const files = readdirSync(distDir).filter((f) => f.endsWith('.cjs') && f !== 'index.cjs')
    const indexKeys = Object.keys(require_(join(distDir, 'index.cjs')) as object).sort()

    const union = new Set<string>()
    for (const file of files) {
      for (const key of Object.keys(require_(join(distDir, file)) as object)) union.add(key)
    }

    expect(indexKeys).toEqual([...union].sort())
  })
})
