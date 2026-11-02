import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { REPO_ROOT } from '../../lib/repo-root.ts'
import {
  applyScaffold,
  assertLibName,
  DRIFT_SPEC,
  insertAppInclude,
  insertLayerList,
  insertLayerLiteral,
  insertMatrixRow,
  insertNestFilenames,
  insertNestProject,
  insertSwcPaths,
  insertTsconfigPaths,
  planScaffold,
  renderTsconfigLib,
  SERVER_ESLINT,
  SERVER_TSCONFIG,
} from '../lib-registration.ts'
/** 真实注册面清单（与 planScaffold 内部读的是同一批文件） */
const REGISTRATION_FILES = [
  SERVER_TSCONFIG,
  'apps/server/infra/nest/dev.json',
  'apps/server/infra/nest/prod.json',
  'apps/server/infra/nest/stage.json',
  'apps/server/infra/swc/dev.swcrc',
  'apps/server/infra/swc/prod.swcrc',
  'apps/server/infra/swc/stage.swcrc',
  'apps/server/apps/api/tsconfig.app.json',
  'apps/server/apps/cli/tsconfig.app.json',
  'apps/server/apps/worker/tsconfig.app.json',
  SERVER_ESLINT,
  DRIFT_SPEC,
]
const lineCount = (text: string): number => text.split('\n').length
describe('lib 名形态', () => {
  it('接受小写 kebab，拒绝其它写法', () => {
    for (const good of ['scope-resolver', 'cache', 'a1-b2'])
      expect(() => assertLibName(good), `${good} 应该被接受`).not.toThrow()
    for (const bad of ['Scope', 'scope resolver', 'scope_resolver', '-scope', 'scope-', ''])
      expect(() => assertLibName(bad), `${bad} 应该被拒绝`).toThrow()
  })
})
describe('文本变换（每个都必须幂等）', () => {
  it('① tsconfig paths：两个键 + 保持 JSON 合法', () => {
    const fixture = [
      '{',
      '  "paths": {',
      '      "@walnut-server/token": [',
      '        "./libs/token/src"',
      '      ],',
      '      "@walnut-server/token/*": [',
      '        "./libs/token/src/*"',
      '      ]',
      '  }',
      '}',
      '',
    ].join('\n')
    const once = insertTsconfigPaths(fixture, 'probe')
    expect(lineCount(once) - lineCount(fixture)).toBe(6)
    expect(JSON.parse(once).paths['@walnut-server/probe']).toEqual(['./libs/probe/src'])
    expect(JSON.parse(once).paths['@walnut-server/probe/*']).toEqual(['./libs/probe/src/*'])
    expect(insertTsconfigPaths(once, 'probe')).toBe(once)
  })
  it('④ swcrc：单行条目，且不是最后一个时补尾逗号', () => {
    const fixture = [
      '{',
      '  "paths": {',
      '      "@walnut-server/token": ["libs/token/src"],',
      '      "@walnut-server/token/*": ["libs/token/src/*"]',
      '  },',
      '  "module": {}',
      '}',
      '',
    ].join('\n')
    const once = insertSwcPaths(fixture, 'probe')
    expect(lineCount(once) - lineCount(fixture)).toBe(2)
    expect(JSON.parse(once).paths['@walnut-server/probe/*']).toEqual(['libs/probe/src/*'])
    expect(insertSwcPaths(once, 'probe')).toBe(once)
  })
  it('② nest filenames：只动 filenames，不碰 projects 里同形的 sourceRoot', () => {
    const fixture = [
      '{',
      '  "compilerOptions": {',
      '    "builder": {',
      '      "options": {',
      '        "filenames": [',
      '          "apps/api/src",',
      '          "libs/token/src",',
      '          "apps/cli/src"',
      '        ]',
      '      }',
      '    }',
      '  },',
      '  "projects": {',
      '    "token": {',
      '      "sourceRoot": "libs/token/src"',
      '    }',
      '  }',
      '}',
      '',
    ].join('\n')
    const once = insertNestFilenames(fixture, 'probe')
    const parsed = JSON.parse(once)
    expect(parsed.compilerOptions.builder.options.filenames).toEqual([
      'apps/api/src',
      'libs/token/src',
      'libs/probe/src',
      'apps/cli/src',
    ])
    expect(parsed.projects.token.sourceRoot).toBe('libs/token/src')
    expect(insertNestFilenames(once, 'probe')).toBe(once)
  })
  it('③ nest projects：8 行 library 块，插在最后一个 library 之后（不动 application）', () => {
    const fixture = [
      '{',
      '  "projects": {',
      '    "api": {',
      '      "type": "application",',
      '      "root": "apps/api"',
      '    },',
      '    "token": {',
      '      "type": "library",',
      '      "root": "libs/token",',
      '      "compilerOptions": {',
      '        "tsConfigPath": "libs/token/tsconfig.lib.json"',
      '      }',
      '    },',
      '    "worker": {',
      '      "type": "application",',
      '      "root": "apps/worker"',
      '    }',
      '  }',
      '}',
      '',
    ].join('\n')
    const once = insertNestProject(fixture, 'probe')
    const parsed = JSON.parse(once)
    expect(Object.keys(parsed.projects)).toEqual(['api', 'token', 'probe', 'worker'])
    expect(parsed.projects.probe).toEqual({
      type: 'library',
      root: 'libs/probe',
      entryFile: 'index',
      sourceRoot: 'libs/probe/src',
      compilerOptions: { tsConfigPath: 'libs/probe/tsconfig.lib.json' },
    })
    expect(insertNestProject(once, 'probe')).toBe(once)
  })
  it('⑤ app include：插进 include 数组末尾', () => {
    const fixture = [
      '{',
      '  "include": [',
      '    "src/**/*",',
      '    "../../libs/token/src/**/*"',
      '  ]',
      '}',
      '',
    ].join('\n')
    const once = insertAppInclude(fixture, 'probe')
    expect(JSON.parse(once).include).toEqual(['src/**/*', '../../libs/token/src/**/*', '../../libs/probe/src/**/*'])
    expect(insertAppInclude(once, 'probe')).toBe(once)
  })
  it('⑥ eslint 名单：仍在同一行（drift 守卫按单行正则读）', () => {
    const fixture = 'const INFRA_LIBS = [\'config\', \'utils\'] as const\n'
    const once = insertLayerList(fixture, 'INFRA_LIBS', 'probe')
    expect(once).toBe('const INFRA_LIBS = [\'config\', \'utils\', \'probe\'] as const\n')
    expect(lineCount(once)).toBe(lineCount(fixture))
    expect(insertLayerList(once, 'INFRA_LIBS', 'probe')).toBe(once)
  })
  it('⑥b 单成员层的 layer(...) 字面量数组', () => {
    const fixture = 'layer(\'guards\', [\'guards\'], [\'app-domain\'], \'guards 装配层\')\n'
    const once = insertLayerLiteral(fixture, 'guards', 'probe')
    expect(once).toBe('layer(\'guards\', [\'guards\', \'probe\'], [\'app-domain\'], \'guards 装配层\')\n')
    expect(insertLayerLiteral(once, 'guards', 'probe')).toBe(once)
  })
  it('⑦ drift spec 的 LAYER_MATRIX 行仍是单行、且可被解析', () => {
    const fixture = '  { name: \'tech-base\', libs: [\'als\', \'ip\'] },\n'
    const once = insertMatrixRow(fixture, 'tech-base', 'probe')
    expect(once).toBe('  { name: \'tech-base\', libs: [\'als\', \'ip\', \'probe\'] },\n')
    expect(insertMatrixRow(once, 'tech-base', 'probe')).toBe(once)
  })
})
describe('planScaffold 在真实文件上：幂等 + 增量可解释', () => {
  const worker = (): { root: string, cleanup: () => void } => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'walnut-scaffold-'))
    for (const relative of REGISTRATION_FILES) {
      const target = path.join(root, relative)
      mkdirSync(path.dirname(target), { recursive: true })
      copyFileSync(path.join(REPO_ROOT, relative), target)
    }
    return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) }
  }
  it('第一次 10 个面全改（净增 42 行），第二次零改动', () => {
    const { root, cleanup } = worker()
    try {
      const first = planScaffold(root, 'probe-lib', 'tech-base')
      const pending = first.filter(file => file.before !== file.after)
      // 12 个既有注册面 + 2 个新文件（tsconfig.lib.json / src/index.ts）
      expect(pending.map(file => file.path)).toHaveLength(14)
      const changed = applyScaffold(root, first)
      expect(changed).toHaveLength(14)
      const netLines = first
        .filter(file => file.before !== null)
        .reduce((sum, file) => sum + lineCount(file.after) - lineCount(file.before as string), 0)
      // 6（paths）+ 3×10（nest filenames 1 + projects 块 9）+ 3×2（swcrc）+ 3×1（app include）
      // + 0（eslint 名单 / drift 矩阵都是改同一行 ⇒ 净增 0）
      // 注：R1 的复核表把 nest projects 记成 8 行、app include 记成 1 个文件，实测是 9 行 / 3 个文件。
      expect(netLines).toBe(45)
      const second = planScaffold(root, 'probe-lib', 'tech-base')
      expect(second.filter(file => file.before !== file.after)).toEqual([])
    }
    finally {
      cleanup()
    }
  })
  it('两个新文件与既有 34 个 lib 的形状一致（6 行 tsconfig.lib.json）', () => {
    expect(renderTsconfigLib('probe-lib').split('\n').filter(line => line !== '')).toHaveLength(6)
    const reference = readFileSync(path.join(REPO_ROOT, 'apps/server/libs/scope-resolver/tsconfig.lib.json'), 'utf8')
    expect(renderTsconfigLib('scope-resolver')).toBe(reference)
  })
})
