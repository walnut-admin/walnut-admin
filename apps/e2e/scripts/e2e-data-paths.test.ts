/**
 * `scripts/e2e-data-paths.ts` 的单一真源契约：`data-key`（基线漂移）与 `affected-plan`
 * （重新封板 + 全量）消费同一组路径，语义差异只在消费端表达。
 *
 * 这里钉住**匹配边界**：目录项写成前缀会误伤 `seed-extra`，文件项写成前缀会误伤
 * `seed-pg.ts.bak` —— 前者让无关改动触发重封板，后者让真正的数据改动漏判。
 */
import { describe, expect, it } from 'vitest'
import { DATA_PATHS, E2E_DATA_PATHS, isE2eDataPath } from './e2e-data-paths.ts'

describe('e2e-data-paths 的路径清单', () => {
  it('路径唯一，且都是仓库相对 POSIX 路径', () => {
    const paths = E2E_DATA_PATHS.map((entry) => entry.path)
    expect(new Set(paths).size).toBe(paths.length)
    for (const path of paths) {
      expect(path).not.toContain('\\')
      expect(path.startsWith('/')).toBe(false)
    }
  })

  it('导出的 DATA_PATHS 是同一组路径（顺序一致，git 调用直接消费）', () => {
    expect(DATA_PATHS).toEqual(E2E_DATA_PATHS.map((entry) => entry.path))
  })

  it('目录项按「等于它或在其下」命中', () => {
    expect(isE2eDataPath('apps/server/db/seed')).toBe(true)
    expect(isE2eDataPath('apps/server/db/seed/sys_menu.json')).toBe(true)
    expect(isE2eDataPath('apps/server/apps/api/migrations/0002-new.ts')).toBe(true)
  })

  it('目录边界：不误伤同前缀的兄弟目录', () => {
    expect(isE2eDataPath('apps/server/db/seed-extra/x.json')).toBe(false)
    expect(isE2eDataPath('apps/server/apps/api/migrations-old/0001.ts')).toBe(false)
  })

  it('文件项逐字相等（不误伤同前缀 / 后缀的其它文件）', () => {
    expect(isE2eDataPath('apps/e2e/scripts/prepare-db.ts')).toBe(true)
    expect(isE2eDataPath('apps/e2e/scripts/prepare-db.ts.bak')).toBe(false)
    expect(isE2eDataPath('tooling/scripts/src/db/seed.ts')).toBe(true)
    expect(isE2eDataPath('tooling/scripts/src/db/seed-extra.ts')).toBe(false)
  })

  it('数据面之外（文档 / 前端 / 测试宿主 / 运行时重置）不命中', () => {
    for (const path of [
      'README.md',
      'apps/admin/src/main.ts',
      'apps/e2e/tests/smoke/home.spec.ts',
      'apps/e2e/scripts/runtime-reset.ts',
    ]) {
      expect(isE2eDataPath(path), path).toBe(false)
    }
  })
})
