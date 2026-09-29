/**
 * 手写 `.d.ts` 检查的**纯逻辑**用例。
 *
 * 这条门禁的判据只有一条容易写错的地方：**「谁的错」按路径判** —— 关掉 `skipLibCheck` 会连依赖的
 * `.d.ts` 一起查（实测 15 条错误全来自 `node_modules`，我们修不了），所以过滤必须同时挡住
 * 「仓库外」与「`node_modules` 里」两种路径。用例的重点就在这里。
 */

import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { isOwnFile, ownFindings, toDiagLike } from '../check-handwritten-dts.ts'

const ROOT = '/repo'

describe('isOwnFile —— 「谁的错」按路径判', () => {
  it('仓库内的文件算我们的（含 apps / packages 两侧）', () => {
    expect(isOwnFile('/repo/apps/admin/types/window.d.ts', ROOT)).toBe(true)
    expect(isOwnFile('/repo/packages/platform-any/types/src/storage.d.ts', ROOT)).toBe(true)
  })

  it('node_modules 里的不算 —— 包括 pnpm 的真实落点 `node_modules/.pnpm/**`', () => {
    expect(isOwnFile('/repo/node_modules/vue/dist/vue.d.ts', ROOT)).toBe(false)
    expect(isOwnFile('/repo/node_modules/.pnpm/@vueuse+core@14.3.0/node_modules/@vueuse/core/dist/index.d.ts', ROOT)).toBe(false)
    // workspace symlink 解析出来的真实路径也在 .pnpm 下，必须一起挡住
    expect(isOwnFile('/repo/packages/platform-any/types/node_modules/.pnpm/x/y.d.ts', ROOT)).toBe(false)
  })

  it('仓库外的路径不算（`..` 开头）', () => {
    expect(isOwnFile('/elsewhere/x.d.ts', ROOT)).toBe(false)
    expect(isOwnFile('/repo/../outside.d.ts', ROOT)).toBe(false)
  })

  it('拿不到文件名的诊断不算（`noImplicitAny` 之类的全局诊断可能没有 file）', () => {
    expect(isOwnFile(undefined, ROOT)).toBe(false)
  })

  it('windows 反斜杠路径同样判得对', () => {
    expect(isOwnFile('C:\\repo\\apps\\admin\\types\\a.d.ts', 'C:\\repo')).toBe(true)
    expect(isOwnFile('C:\\repo\\node_modules\\vue\\a.d.ts', 'C:\\repo')).toBe(false)
  })
})

describe('ownFindings —— 只留我们自己的诊断', () => {
  it('依赖的诊断整条丢掉，我们的原样留下（行号与消息都不动）', () => {
    const got = ownFindings([
      { file: '/repo/node_modules/.pnpm/vue-i18n/x/vue-i18n.d.ts', line: 12, message: '依赖自己的问题' },
      { file: '/repo/apps/admin/types/window.d.ts', line: 25, message: 'TS1038: A declare modifier…' },
      { file: undefined, line: 0, message: '全局诊断' },
      { file: '/repo/packages/platform-any/types/src/storage.d.ts', line: 3, message: 'TS2430: …' },
    ], ROOT)
    expect(got).toEqual([
      { file: '/repo/apps/admin/types/window.d.ts', line: 25, message: 'TS1038: A declare modifier…' },
      { file: '/repo/packages/platform-any/types/src/storage.d.ts', line: 3, message: 'TS2430: …' },
    ])
  })

  it('普通 .ts 文件上的诊断也不算（门禁只管 .d.ts）', () => {
    expect(ownFindings([
      { file: '/repo/apps/admin/src/components/Vendor/ECharts/on-demand.ts', line: 28, message: 'echarts 双身份' },
      { file: '/repo/apps/admin/types/window.d.ts', line: 1, message: '我们的' },
    ], ROOT)).toEqual([{ file: '/repo/apps/admin/types/window.d.ts', line: 1, message: '我们的' }])
  })

  it('全是依赖问题时返回空 —— 门禁不许因为「改不了的错」变红', () => {
    expect(ownFindings([
      { file: '/repo/node_modules/naive-ui/lib/x.d.ts', line: 1, message: 'a' },
      { file: '/repo/node_modules/naive-ui/lib/y.d.ts', line: 2, message: 'b' },
    ], ROOT)).toEqual([])
  })
})

describe('toDiagLike —— 位置换算成 1-based 行号', () => {
  it('拿得到 file/start 时就换算行号', () => {
    const code = 'const a = 1\nconst b = (2'
    const sf = ts.createSourceFile('x.d.ts', code, ts.ScriptTarget.Latest, false)
    const diag: ts.Diagnostic = {
      file: sf,
      start: code.indexOf('(2') + 1,
      length: 0,
      messageText: 'boom',
      category: ts.DiagnosticCategory.Error,
      code: 1,
    }
    expect(toDiagLike(diag)).toEqual({ file: 'x.d.ts', line: 2, message: 'boom' })
  })

  it('没有 file/start 的全局诊断（行号记 0），文件名为 undefined', () => {
    const diag: ts.Diagnostic = {
      file: undefined,
      start: undefined,
      length: undefined,
      messageText: 'global',
      category: ts.DiagnosticCategory.Error,
      code: 2,
    }
    expect(toDiagLike(diag)).toEqual({ file: undefined, line: 0, message: 'global' })
  })
})
