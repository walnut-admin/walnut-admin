/**
 * `clean:all` 的清理面：目标展开与删除。用例在临时目录里造一棵假的仓库树，不碰真实仓库。
 */

import fs from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanAll, listCleanAllTargets } from '../clean-all.ts'

/** 本文件造出来的临时目录，每个用例结束后整棵删掉 */
const made: string[] = []

function makeRoot(): string {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'walnut-clean-all-'))
  made.push(dir)
  return dir
}

/** 造一个文件（连同它的目录） */
function touch(root: string, rel: string): void {
  const abs = path.join(root, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, 'x')
}

afterEach(() => {
  for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('listCleanAllTargets', () => {
  it('覆盖 apps/*、packages/<组>/*、tooling/* 三个分组，顺序与 workspace 声明一致，外加镜像 staging 与仓库根', () => {
    const root = makeRoot()
    for (const rel of [
      'apps/admin/a.ts',
      'apps/server/a.ts',
      'packages/platform-any/contract/a.ts',
      'packages/platform-web/client/a.ts',
      'tooling/scripts/a.ts',
      'tooling/release/a.ts',
    ])
      touch(root, rel)

    expect(listCleanAllTargets(root)).toEqual([
      'apps/admin/node_modules',
      'apps/server/node_modules',
      'packages/platform-any/contract/node_modules',
      'packages/platform-web/client/node_modules',
      'tooling/release/node_modules',
      'tooling/scripts/node_modules',
      'build/node_modules',
      'node_modules',
    ])
  })

  it('仓库根排在最后：它是一切依赖的来源，中途失败时留下的现场更好判断', () => {
    const root = makeRoot()
    touch(root, 'apps/admin/a.ts')
    const targets = listCleanAllTargets(root)
    expect(targets.at(-1)).toBe('node_modules')
  })

  it('不往更深处找：包目录下的子目录、顶层其它目录都不算', () => {
    const root = makeRoot()
    touch(root, 'apps/admin/src/nested/a.ts')
    touch(root, 'docs/a.ts')
    touch(root, 'deploy/a.ts')
    touch(root, 'packages/platform-any/contract/src/a.ts')

    // 包目录自己算（apps/admin、packages/platform-any/contract）；它们下面的 src、src/nested 不算，
    // 顶层的 docs、deploy 也不算
    expect(listCleanAllTargets(root)).toEqual([
      'apps/admin/node_modules',
      'packages/platform-any/contract/node_modules',
      'build/node_modules',
      'node_modules',
    ])
  })

  it('目录不存在时不报错，仍给出稳定的清单（存在与否由 cleanAll 负责跳过）', () => {
    const root = makeRoot()
    expect(listCleanAllTargets(root)).toEqual(['build/node_modules', 'node_modules'])
  })
})

describe('cleanAll', () => {
  it('删掉全部 node_modules，源码原样保留', () => {
    const root = makeRoot()
    touch(root, 'apps/admin/src/main.ts')
    touch(root, 'apps/admin/node_modules/.pnpm/dep/index.js')
    touch(root, 'packages/platform-any/contract/src/index.ts')
    touch(root, 'packages/platform-any/contract/node_modules/dep/index.js')
    touch(root, 'tooling/scripts/src/a.ts')
    touch(root, 'build/node_modules/dep/index.js')
    touch(root, 'node_modules/.pnpm/dep/index.js')

    const result = cleanAll(root)

    expect(result.failed).toEqual([])
    expect(result.removed).toEqual([
      'apps/admin/node_modules',
      'packages/platform-any/contract/node_modules',
      'build/node_modules',
      'node_modules',
    ])
    expect(fs.existsSync(path.join(root, 'apps/admin/node_modules'))).toBe(false)
    expect(fs.existsSync(path.join(root, 'packages/platform-any/contract/node_modules'))).toBe(
      false,
    )
    expect(fs.existsSync(path.join(root, 'build/node_modules'))).toBe(false)
    expect(fs.existsSync(path.join(root, 'node_modules'))).toBe(false)
    // 源码与包目录本身都还在
    expect(fs.existsSync(path.join(root, 'apps/admin/src/main.ts'))).toBe(true)
    expect(fs.existsSync(path.join(root, 'packages/platform-any/contract/src/index.ts'))).toBe(true)
    expect(fs.existsSync(path.join(root, 'tooling/scripts/src/a.ts'))).toBe(true)
  })

  it('重复跑安全：第二次什么都不存在，什么也不报', () => {
    const root = makeRoot()
    touch(root, 'node_modules/dep/index.js')

    cleanAll(root)
    const again = cleanAll(root)

    expect(again).toEqual({ removed: [], failed: [] })
  })

  it('删不掉的逐个记进 failed 并带上原因，其余目标照删', () => {
    const root = makeRoot()
    touch(root, 'apps/admin/node_modules/dep/index.js')
    touch(root, 'apps/server/node_modules/dep/index.js')
    touch(root, 'node_modules/dep/index.js')

    const result = cleanAll(root, listCleanAllTargets(root), (abs) => {
      if (abs.endsWith(`${path.sep}apps${path.sep}server${path.sep}node_modules`))
        throw new Error('EBUSY: resource busy or locked')
      fs.rmSync(abs, { recursive: true, force: true })
    })

    expect(result.removed).toEqual(['apps/admin/node_modules', 'node_modules'])
    expect(result.failed).toEqual([
      { dir: 'apps/server/node_modules', error: 'EBUSY: resource busy or locked' },
    ])
    expect(fs.existsSync(path.join(root, 'apps/server/node_modules/dep/index.js'))).toBe(true)
  })
})
