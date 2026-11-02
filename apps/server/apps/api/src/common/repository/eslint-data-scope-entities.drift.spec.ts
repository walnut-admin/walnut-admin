import type { EntityTarget, ObjectLiteral } from 'typeorm'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { WALNUT_DATA_SCOPE_ENTITIES } from './data-scope'

/**
 * ESLint 实体清单对账守卫（apps/docs/src/zh-CN/content/plans/data-scope-remediation-plan.md §3.2 / 批 5 L3b）。
 *
 * 两份清单的分工：
 * - `WALNUT_DATA_SCOPE_ENTITIES`（common/repository/data-scope.ts）= 运行时注册表，**真源**；
 * - `packages/tooling/eslint-config/nest.ts` 的 `walnut/data-scope/direct-repository` 规则
 *   = 静态拦截面（`getRepository(已注册实体)` 必须经基类），实体名正则是注册表的**文本拷贝**。
 *
 * 本 spec 读 nest.ts 文本、解析正则里的实体名集合，断言它与注册表的实体类名集合恒等。
 * 单向对账（文本级，不跨包 import）的理由：nest.ts 在另一个包且由 jiti 加载，跨包 import
 * 会打破 apps/server 自包含 tsconfig 的边界（ADR 0012）；注册表加实体忘同步正则时，
 * 本 spec 变红即可把「静默绕过 scope」挡在 review 前。
 */

const RULE_NAME = 'walnut/data-scope/direct-repository'

/**
 * 从 nest.ts 文本里提取 direct-repository 规则的实体名清单。
 *
 * 只认规则块内的 `arguments.0.name=/^(A|B|C)$/` 形态（注册表 → 正则的拷贝点）。
 * 找不到规则名或正则 → 返回空数组（守卫按「清单为空 = 失败」处理，绝不静默通过）。
 * 抽成纯函数是为了自测：注入篡改后的文本，验证对账本身会红（不改真 nest.ts）。
 */
function extractDirectRepositoryEntityNames(source: string): string[] {
  const ruleIndex = source.indexOf(RULE_NAME)
  if (ruleIndex < 0) {
    return []
  }

  const match = /arguments\.0\.name=\/\^\(([^)]*)\)\$\//.exec(source.slice(ruleIndex))
  if (match === null) {
    return []
  }

  return match[1]
    .split('|')
    .map(name => name.trim())
    .filter(name => name !== '')
}

/** 实体类名（EntityTarget 在注册表里恒为实体类；string / EntitySchema 只兜底报错信息） */
function entityClassName(target: EntityTarget<ObjectLiteral>): string {
  return typeof target === 'function' ? target.name : String(target)
}

interface IEntityListDiff {
  /** 注册表有、nest.ts 正则没有 —— 静态守卫漏拦（新实体可绕过 scope 直连） */
  missing: string[]
  /** nest.ts 正则里有、注册表没有 —— 残留名字（实体已删/改名，规则成摆设） */
  extra: string[]
}

function diffEntityLists(parsed: string[], registered: string[]): IEntityListDiff {
  const parsedSet = new Set(parsed)
  const registeredSet = new Set(registered)

  return {
    missing: registered.filter(name => !parsedSet.has(name)).sort(),
    extra: parsed.filter(name => !registeredSet.has(name)).sort(),
  }
}

/**
 * 仓库根：从本 spec 所在目录向上找 `pnpm-workspace.yaml`。
 *
 * 为什么不用 `import.meta.url`：server 的 tsconfig 是 `module=commonjs`（ADR 0012），
 * `import.meta` 过不了 `tsc --noEmit`（同款取舍见 dto-entity.drift.spec.ts 的注释）。
 * `__dirname` 在 vitest 的 SSR transform 与编译后的 CJS 里都可用，且从它向上找根
 * 与 cwd 无关 —— 比 `process.cwd()` 更能扛住「在别的目录跑测试」。
 */
function findRepoRoot(start: string): string {
  let dir = start
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      return dir
    }
    const parent = dirname(dir)
    if (parent === dir) {
      throw new Error(`找不到仓库根（从 ${start} 向上没有 pnpm-workspace.yaml）`)
    }
    dir = parent
  }
}

const NEST_TS_PATH = join(findRepoRoot(__dirname), 'packages/tooling/eslint-config/nest.ts')

const ACTION_HINT = '加实体要同步 nest.ts 的 walnut/data-scope/direct-repository 正则，或从 WALNUT_DATA_SCOPE_ENTITIES 删'

describe('eslint direct-repository 实体清单 ↔ 注册表', () => {
  it('nest.ts 定位正确（路径解析失效时本守卫必须是红的，而不是空断言通过）', () => {
    expect(existsSync(NEST_TS_PATH), `未找到 ${NEST_TS_PATH}（本 spec 的仓库根定位失效）`).toBe(true)
  })

  it('正则里的实体名集合 ≡ WALNUT_DATA_SCOPE_ENTITIES 的实体类名集合', () => {
    const source = readFileSync(NEST_TS_PATH, 'utf8')
    const parsed = extractDirectRepositoryEntityNames(source)
    const registered = WALNUT_DATA_SCOPE_ENTITIES.map(config => entityClassName(config.entity))

    // 解析失败（规则改名/正则形态变化）时 parsed 为空 —— 与注册表非空必然不等，不会静默通过
    expect(parsed, `未从 nest.ts 解析到实体名清单。${ACTION_HINT}`).not.toEqual([])
    expect(diffEntityLists(parsed, registered), `ESLint 实体清单与数据权限注册表漂移。${ACTION_HINT}`)
      .toEqual({ missing: [], extra: [] })
  })
})

describe('对账守卫自测（注入篡改文本，不改真 nest.ts）', () => {
  // 与 nest.ts 同形的 selector 片段：只承载解析函数依赖的 arguments.0.name 正则
  const syntheticSource = (names: string): string =>
    `name: '${RULE_NAME}',\n rules: { 'no-restricted-syntax': ['error', { selector: 'CallExpression[arguments.0.name=/^(${names})$/]' }] }`

  const registered = WALNUT_DATA_SCOPE_ENTITIES.map(config => entityClassName(config.entity))

  it('从注入文本解析出实体名集合', () => {
    expect(extractDirectRepositoryEntityNames(syntheticSource('SysUserEntity|AppDemoEntity')))
      .toEqual(['SysUserEntity', 'AppDemoEntity'])
  })

  it('真 nest.ts 里删掉一个实体名 → 对账报 missing（守卫本身会红）', () => {
    const source = readFileSync(NEST_TS_PATH, 'utf8')
    const victim = extractDirectRepositoryEntityNames(source)[0]
    // 只在规则名之后的那一段里删（实体名在规则块的注释里也出现过一次，全文首个
    // replace 会删到注释、正则原样保留）；删不到时 parsed 不变，下面的
    // not.toContain 会立刻暴露篡改未生效
    const ruleIndex = source.indexOf(RULE_NAME)
    const tampered = source.slice(0, ruleIndex) + source.slice(ruleIndex).replace(victim, '')
    const parsed = extractDirectRepositoryEntityNames(tampered)

    expect(parsed).not.toContain(victim)
    expect(diffEntityLists(parsed, registered)).toEqual({
      missing: [victim],
      extra: [],
    })
  })

  it('注入一个注册表没有的实体名 → 对账报 extra', () => {
    const parsed = extractDirectRepositoryEntityNames(syntheticSource('SysUserEntity|FakeGhostEntity'))

    expect(diffEntityLists(parsed, ['SysUserEntity'])).toEqual({
      missing: [],
      extra: ['FakeGhostEntity'],
    })
  })

  it('规则名缺失 / 正则形态变化 → 解析为空（守卫按失败处理，不静默放行）', () => {
    expect(extractDirectRepositoryEntityNames('const rules = {}')).toEqual([])
    expect(extractDirectRepositoryEntityNames(
      syntheticSource('SysUserEntity').replace('arguments.0.name=', 'arguments.1.name='),
    )).toEqual([])
  })
})
