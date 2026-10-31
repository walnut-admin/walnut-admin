import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * lib 注册一致性 drift 守卫 —— 防「目录在、注册漏」。
 *
 * 背景：`apps/server` 是 Nest CLI 内部 monorepo（ADR 0007），每个内部 lib 要在**多处配置里
 * 各登记一次**，且这些注册点互不联动 —— 漏一处不会让 `tsc` 报错，只会在**构建或运行期**炸
 * （SWC 的 `filenames` 漏了 → 产物里没有这个 lib，`@walnut-server/*` 运行时解析失败；
 * nest-cli `projects` 漏了 → `nest build <lib>` 无 project 可用（本仓无根 nest-cli.json，
 * 实测是静默 no-op）。历史上
 * `@walnut-server/context` 就漏了 nest-cli projects 注册（归档的 lib-extraction 计划交叉
 * 记录第 3 条），靠人肉记忆补不全，所以机械拦：
 *
 * 磁盘真源：`libs/<name>`（必须含 `src/index.ts` + `tsconfig.lib.json`）。
 * 注册面（全部必须与磁盘集合相等）：
 * ① `tsconfig.json` → `compilerOptions.paths` 的 `@walnut-server/<name>`（含 `/*` 变体）；
 * ② `infra/nest/{dev,prod,stage}.json` → `compilerOptions.builder.options.filenames` 的
 *    `libs/<name>/src`，以及 `projects` 里每个 lib 的标准形状（application 项目 —— api /
 *    cli / worker 这些组合入口 —— 不参与本守卫）；
 * ③ `infra/swc/{dev,prod,stage}.swcrc` → `jsc.paths` 的 `@walnut-server/<name>`（值指向
 *    `libs/<name>/src`）；
 * ④ `apps/api/tsconfig.app.json` → `include` 的 `../../libs/<name>/src` 全量 glob 条目（app
 *    构建的 TS 程序要看见每个 lib；build:libs 脚本因 no-op 已删除，不再作为注册面）；
 * ⑤ `eslint.config.ts` → `INFRA_LIBS` / `TECH_LIBS` / `DOMAIN_LIBS` / `TOP_LIBS` 四个分层名单
 *    （守的是入边方向：新增 lib 必须归入一个分层，否则 lint 的 fail-closed 配置会拦它的出边，
 *    但「有人把 lib 建在磁盘上却没进任何一层」这种反向遗漏只有本守卫能查）。
 *
 * 纯 fs + 静态文本，零依赖装载。新增 lib 的动作就是「建目录 + 五处登记」，漏任何一处本文件红。
 */

// ─── 配置形状（只声明本文件真正读到的字段）────────────────────────────────────────

interface ITsconfigJson {
  compilerOptions: {
    paths: Record<string, string[]>
  }
}

interface INestCliJson {
  compilerOptions: {
    builder: {
      options: {
        filenames: string[]
      }
    }
  }
  projects: Record<string, {
    type: string
    root: string
    sourceRoot: string
    entryFile: string
    compilerOptions: { tsConfigPath: string }
  }>
}

interface ISwcrcJson {
  jsc: {
    paths: Record<string, string[]>
  }
}

// ─── 读取与解析工具 ───────────────────────────────────────────────────────────────

/** vitest 从 apps/server 起（`test.root: './'`），与 dto-entity.drift.spec 的 cwd 口径一致 */
function readServerFile(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8')
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(readServerFile(relativePath)) as T
}

/** 磁盘真源：libs/ 下每个含 src/index.ts 的目录名（排序后作对账基准） */
function readActualLibNames(): string[] {
  const libsRoot = resolve(process.cwd(), 'libs')
  return readdirSync(libsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .filter(name => existsSync(resolve(libsRoot, name, 'src', 'index.ts')))
    .sort()
}

/** `@walnut-server/<name>` 键集合（剥掉命名空间前缀与 `/*` 子路径变体，排序后比较） */
function aliasLibNames(paths: Record<string, string[]>): string[] {
  return [...new Set(
    Object.keys(paths)
      .filter(key => key.startsWith('@walnut-server/'))
      .map(key => key.replace(/^@walnut-server\//, '').replace(/\/\*$/, '')),
  )].sort()
}

const NEST_CLI_CONFIGS = ['infra/nest/dev.json', 'infra/nest/prod.json', 'infra/nest/stage.json'] as const
const SWCRC_CONFIGS = ['infra/swc/dev.swcrc', 'infra/swc/prod.swcrc', 'infra/swc/stage.swcrc'] as const

// ─── 用例 ────────────────────────────────────────────────────────────────────────

describe('lib 注册一致性 drift 守卫（libs 目录 ↔ 五处注册面，纯 fs，零装载）', () => {
  const actualLibs = readActualLibNames()

  it('磁盘真源非空（libs/ 目录没了或全部漏建 index.ts 时，本守卫必须失效报警而不是静默通过）', () => {
    expect(actualLibs.length).toBeGreaterThan(0)
  })

  it('每个 lib 都有 tsconfig.lib.json（nest-cli projects 的 tsConfigPath 指向它）', () => {
    const missing = actualLibs.filter(name => !existsSync(resolve(process.cwd(), 'libs', name, 'tsconfig.lib.json')))
    expect(missing, '缺 tsconfig.lib.json 的 lib').toEqual([])
  })

  it('① tsconfig.json paths ≡ 磁盘 libs', () => {
    const tsconfig = readJson<ITsconfigJson>('tsconfig.json')
    expect(aliasLibNames(tsconfig.compilerOptions.paths)).toEqual(actualLibs)
  })

  it('② 三份 nest-cli json 的 filenames ≡ 磁盘 libs，且 projects 登记形状标准', () => {
    const problems: string[] = []

    for (const configPath of NEST_CLI_CONFIGS) {
      const config = readJson<INestCliJson>(configPath)

      const filenames = config.compilerOptions.builder.options.filenames
        .map(entry => /^libs\/([\w-]+)\/src$/.exec(entry)?.[1])
        .filter((name): name is string => name !== undefined)
        .sort()
      if (JSON.stringify(filenames) !== JSON.stringify(actualLibs)) {
        problems.push(`${configPath} filenames [${filenames.join(', ')}] ≠ 磁盘 [${actualLibs.join(', ')}]`)
      }

      // application（api / cli / worker 组合入口）不参与 lib 对账，但必须存在且形状标准 ——
      // 整段被删时门禁要红（批 10 评审补）
      const projectNames = Object.entries(config.projects)
        .filter(([, project]) => project.type !== 'application')
        .map(([name]) => name)
        .sort()
      if (JSON.stringify(projectNames) !== JSON.stringify(actualLibs)) {
        problems.push(`${configPath} projects（除 application）[${projectNames.join(', ')}] ≠ 磁盘 [${actualLibs.join(', ')}]`)
      }

      for (const [name, project] of Object.entries(config.projects)) {
        if (project.type === 'application') {
          // 组合入口（api / cli / worker）必须存在且 root 正确 —— 整段被删时门禁要红（批 10 评审补）
          if (!['api', 'cli', 'worker'].includes(name)) {
            problems.push(`${configPath} 出现未知 application project：${name}`)
          }
          if (project.root !== `apps/${name}` || project.sourceRoot !== `apps/${name}/src`) {
            problems.push(`${configPath} projects.${name} 的 root/sourceRoot 应为 apps/${name}（/src）`)
          }
          continue
        }
        if (project.type !== 'library') {
          problems.push(`${configPath} projects.${name}.type 应为 library，实际 ${project.type}`)
        }
        if (project.root !== `libs/${name}` || project.sourceRoot !== `libs/${name}/src`) {
          problems.push(`${configPath} projects.${name} 的 root/sourceRoot 应为 libs/${name}（/src）`)
        }
        if (project.entryFile !== 'index') {
          problems.push(`${configPath} projects.${name}.entryFile 应为 index（要求 src/index.ts 存在）`)
        }
        if (project.compilerOptions.tsConfigPath !== `libs/${name}/tsconfig.lib.json`) {
          problems.push(`${configPath} projects.${name}.tsConfigPath 应为 libs/${name}/tsconfig.lib.json`)
        }
      }
    }

    expect(problems).toEqual([])
  })

  it('③ 三份 swcrc 的 paths ≡ 磁盘 libs，且值指向对应 libs/<name>/src', () => {
    const problems: string[] = []

    for (const swcrcPath of SWCRC_CONFIGS) {
      const swcrc = readJson<ISwcrcJson>(swcrcPath)

      if (JSON.stringify(aliasLibNames(swcrc.jsc.paths)) !== JSON.stringify(actualLibs)) {
        problems.push(`${swcrcPath} paths ≠ 磁盘 libs`)
      }

      for (const name of actualLibs) {
        const targets = swcrc.jsc.paths[`@walnut-server/${name}`]
        const normalized = (targets ?? []).map(target => target.replace(/^\.\//, ''))
        if (JSON.stringify(normalized) !== JSON.stringify([`libs/${name}/src`])) {
          problems.push(`${swcrcPath} 的 @walnut-server/${name} 应指向 libs/${name}/src，实际 [${(targets ?? []).join(', ')}]`)
        }
      }
    }

    expect(problems).toEqual([])
  })

  it('④ apps/api/tsconfig.app.json include ≡ 磁盘 libs（app 构建的 TS 程序要看见每个 lib）', () => {
    const appTsconfig = readJson<{ include: string[] }>('apps/api/tsconfig.app.json')
    const libIncludes = appTsconfig.include
      .map(entry => /^\.\.\/\.\.\/libs\/([\w-]+)\/src\/\*\*\/\*$/.exec(entry)?.[1])
      .filter((name): name is string => name !== undefined)
      .sort()
    expect(libIncludes).toEqual(actualLibs)
  })

  it('⑤ eslint.config.ts 的四个分层名单并集 ≡ 磁盘 libs，且无重复', () => {
    const configText = readServerFile('eslint.config.ts')
    const layerLists = ['INFRA_LIBS', 'TECH_LIBS', 'DOMAIN_LIBS', 'TOP_LIBS'] as const

    const collected: string[] = []
    for (const listName of layerLists) {
      // 名单必须是**单行字面量数组**：跨行或改成计算式会让本守卫读不到，直接 fail 而不是静默跳过。
      const match = new RegExp(`const ${listName} = \\[([^\\]]*)\\]`).exec(configText)
      if (!match) {
        expect.fail(`eslint.config.ts 里找不到 ${listName} 的单行字面量数组（改名或改成跨行/计算式都会让本守卫失效）`)
      }
      const names = [...match[1].matchAll(/'([\w-]+)'/g)].map(literal => literal[1])
      expect(names.length, `${listName} 不能为空`).toBeGreaterThan(0)
      collected.push(...names)
    }

    const duplicates = collected.filter((name, index) => collected.indexOf(name) !== index)
    expect(duplicates, '同一 lib 被登记进多个分层（或同一层里重复）').toEqual([])
    expect([...new Set(collected)].sort(), 'eslint 分层名单并集').toEqual(actualLibs)
  })
})
