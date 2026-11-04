import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { checkAssets, REQUIRED_ASSETS } from '../../../../../../infra/scripts/verify-build-assets'

// 构建后资产断言的逻辑单测（脚本本体在 infra/scripts/，cli 入口 main() 不在此测）。
// 钉三条：全就位 → 空数组；缺一个 → 只报缺的那个；REQUIRED_ASSETS 必须含 favicon 与
// demo.png（deploy compose 的 healthcheck 探的就是 demo.png 路由的资产）。

let root: string

beforeAll(() => {
  root = join(tmpdir(), `verify-assets-spec-${process.pid}`)
  mkdirSync(root, { recursive: true })
  for (const asset of REQUIRED_ASSETS) {
    mkdirSync(join(root, asset, '..'), { recursive: true })
    writeFileSync(join(root, asset), 'x')
  }
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('verify-build-assets', () => {
  it('全部就位 → 空数组', () => {
    expect(checkAssets(root)).toEqual([])
  })

  it('缺一个 → 只报缺的那个（不误报其余）', () => {
    rmSync(join(root, 'apps/api/src/public/favicon.ico'))
    expect(checkAssets(root)).toEqual(['apps/api/src/public/favicon.ico'])
  })

  it('根目录不存在 → 全量缺失', () => {
    expect(checkAssets(join(root, '__nope__'))).toEqual([...REQUIRED_ASSETS])
  })

  it('清单必须覆盖 healthcheck 依赖的静态资产（demo.png / favicon.ico）', () => {
    expect(REQUIRED_ASSETS).toContain('apps/api/src/public/images/demo.png')
    expect(REQUIRED_ASSETS).toContain('apps/api/src/public/favicon.ico')
  })
})
