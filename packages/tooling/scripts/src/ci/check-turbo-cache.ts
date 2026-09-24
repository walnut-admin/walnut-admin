// Turborepo 缓存边界门禁。
//
// **为什么需要它**：`turbo.json` 里写错一个 glob、漏一个产物目录、少挂一条依赖边，
// 症状全都是**静默的** —— turbo 照样 `FULL TURBO` + exit 0，只是跑了不该跑的（浪费）
// 或者没跑该跑的（**门禁回放假绿**）。2026-09-23 就实测到后者：
// `pnpm build:stage` 在缓存命中时打印 "1 successful / FULL TURBO / exit 0"，
// 而 `apps/admin/dist-staging` **一个文件都没有** —— `outputs` 里漏了它。
//
// 这道门禁**不改任何文件**（不做「改一个文件看 hash 变不变」的变异实验 —— 那是
// 一次性调研用的手段，见 `turbo-cache-boundary.md`），只做静态断言：
// 拿 `turbo run --dry=json` 的**解析结果**（turbo 自己的真源，不是我们对配置的二次解读）
// 去核对一组不变量。判据偏「宁可漏报不可误报」：每条断言都必须能机械判定，
// 不确定的一律不查（一个开始误报的门禁等于没有门禁）。
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { parseConfigFileTextToJson, parseJsonConfigFileContent, readConfigFile, sys } from 'typescript'

import { PreconditionError, ViolationError } from '../lib/errors.ts'
import { err, line, lineErr, out } from '../lib/log.ts'
import { getPnpmBin } from '../lib/pnpm-launcher.ts'
import { REPO_ROOT } from '../lib/repo-root.ts'

/** 需要 dry-run 解析的任务名（都是会被缓存、且缓存边界出过问题的那些） */
const PROBE_TASKS = ['build', 'build:stage', 'transit', 'types:check', 'lint', 'lint:root', 'test'] as const

export interface Finding {
  /** 不变量编号，报错时好定位 */
  rule: string
  detail: string
}

interface TurboTask {
  taskId: string
  task: string
  package: string
  directory: string
  hash: string
  inputs?: Record<string, string>
  outputs?: string[] | null
  /** 这张图里本 task 直接依赖的上游 task（`^build` / `transit` 展开后的结果） */
  dependencies?: string[]
  hashOfExternalDependencies?: string
  resolvedTaskDefinition: {
    dependsOn?: string[]
    inputs?: string[]
    outputs?: string[]
  }
}

export interface TurboDry {
  tasks: TurboTask[]
  packages: string[]
  globalCacheInputs: { files: Record<string, string> }
}

/** 跑一次 turbo 的干跑，拿解析后的真源 */
export function loadTurboDry(cwd = REPO_ROOT): TurboDry {
  // ⚠️ **这里曾经是 `execFileSync('cmd', ['/c', 'pnpm exec turbo … 2>nul'])`** ——
  // 那让整道门禁**只能在 Windows 上跑**：CI 的 runner 是 `ubuntu-latest`，那里没有 `cmd`，
  // `execFileSync` 直接 ENOENT ⇒ 这一段的结论是「在 CI 上从来没成立过」。
  // （2026-09-23 交叉对比时读出来的；当时这些提交还没推过，所以 CI 没红过 —— 一推就会红。）
  // 现在走 `getPnpmBin()`：它是本仓**唯一**被认可起 pnpm 的方式（Windows 上 `pnpm` 是
  // `pnpm.cmd`，`execFileSync('pnpm', …)` 会 ENOENT；而 `shell: true` 又会重解析 argv）。
  // 顺带把 `2>nul` 去掉：那本来就是 cmd 的语法，这里用 stdio 直接丢弃 stderr。
  const out = execFileSync(getPnpmBin(), ['exec', 'turbo', 'run', ...PROBE_TASKS, '--dry=json'], {
    cwd,
    maxBuffer: 1 << 30,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  const dry = JSON.parse(out) as TurboDry
  // ⚠️ 两个都必须处理，否则门禁会**静默变绿**：
  // ① turbo 把**自己的 cwd** 当成仓库根（它向上找 `turbo.json`，而在子目录里就能找到那个包自己的
  //    一份）—— 在 `packages/tooling/scripts` 下跑，`--dry=json` 只会报 1 个包 12 个 task，
  //    所有断言照样「全部成立」。这是本仓反复强调的「扫描面为空 ⇒ 假绿」的又一例。
  // ② 这种情形下它报的 `directory` 是**相对路径**，得按 cwd 还原成绝对路径再比。
  for (const t of dry.tasks) t.directory = path.resolve(cwd, t.directory)
  if ((dry.packages?.length ?? 0) < 2) {
    throw new Error(
      `turbo 只在 ${cwd} 下发现了 ${dry.packages?.length ?? 0} 个包 —— 它把当前目录当成了仓库根（要在仓库根跑）`,
    )
  }
  return dry
}

/** 每个 workspace 包的目录（相对仓库根，正斜杠）。**根任务**（`//#…`）不算包，要排掉。 */
export function packageDirs(dry: TurboDry, cwd = REPO_ROOT): string[] {
  const dirs = new Set<string>()
  for (const t of dry.tasks) {
    if (t.taskId.startsWith('//#'))
      continue
    dirs.add(norm(t.directory, cwd))
  }
  return [...dirs].sort()
}

function norm(p: string, cwd: string): string {
  const rel = path.relative(cwd, p).replace(/\\/g, '/')
  return rel === '' ? '.' : rel
}

/**
 * 读 `turbo.json`。**必须按 JSONC 读**：根 `turbo.json` 里有大量注释，
 * 那些注释是这套边界规则唯一的就地文档（`JSON.parse` 会直接炸）。
 * 用 TypeScript 自带的 JSONC 解析器 —— 与 `check-doc-ts` 同一个，不引入新依赖。
 */
export function readTurboJson(file: string): Record<string, unknown> {
  const { config, error } = parseConfigFileTextToJson(file, readFileSync(file, 'utf8'))
  if (error)
    throw new Error(`${file} 解析失败：${error.messageText}`)
  return config as Record<string, unknown>
}

/** glob → 是否至少命中一个真实文件（只支持本仓实际用到的形态：`*` 段与 `**` 段） */
export function globMatchesSomething(glob: string, cwd = REPO_ROOT): boolean {
  const abs = path.join(cwd, glob)
  if (existsSync(abs))
    return true
  // `a/*/b` / `a/**` 形态：逐段向下走
  const segs = glob.split('/')
  let frontier = [cwd]
  for (const seg of segs) {
    const next: string[] = []
    for (const dir of frontier) {
      if (!existsSync(dir))
        continue
      let entries: string[]
      try {
        entries = readdirSync(dir)
      }
      catch {
        continue
      }
      if (seg === '**') {
        next.push(dir)
        for (const e of entries) {
          const p = path.join(dir, e)
          try {
            if (readdirSync(p))
              next.push(p)
          }
          catch { /* 不是目录 */ }
        }
      }
      else if (seg.includes('*')) {
        const re = new RegExp(`^${seg.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}$`)
        for (const e of entries) {
          if (re.test(e))
            next.push(path.join(dir, e))
        }
      }
      else {
        next.push(path.join(dir, seg))
      }
    }
    frontier = next
    if (frontier.length === 0)
      return false
  }
  return frontier.some(p => existsSync(p))
}

/**
 * 从 `apps/<app>/env-local/.env.<mode>` 里读 `VITE_BUILD_OUT_DIR` 的真实取值。
 * 这是**产物目录的真源** —— admin 的 staging 产物叫 `dist-staging` 而不是 `dist`，
 * 光看 `turbo.json` 是看不出来的。目录不存在（CI 没解密过 env）就跳过，
 * 属「前置条件未满足」，不算失败。
 */
export function declaredOutDirs(envFile: string): string[] {
  if (!existsSync(envFile))
    return []
  const txt = readFileSync(envFile, 'utf8')
  const out: string[] = []
  for (const raw of txt.split('\n')) {
    // 手写解析而不是一条正则打到底：`\s*…\s*` 那种写法会被
    // `regexp/no-super-linear-backtracking` 判为可多项式回溯（同仓已有先例）。
    const line = raw.trim()
    if (!line.startsWith('VITE_BUILD_OUT_DIR'))
      continue
    const eq = line.indexOf('=')
    if (eq < 0)
      continue
    const value = line.slice(eq + 1).trim().replace(/^"|"$/g, '')
    if (value !== '')
      out.push(value)
  }
  return out
}

/** 把一个产物目录名转成 turbo outputs 里的 glob */
function outGlob(dir: string): string {
  return dir.endsWith('/') ? `${dir}**` : `${dir}/**`
}

/**
 * Nest CLI 的产物目录 —— **真源是 tsconfig 的 `outDir`，不是 `nest-cli` 里的
 * `compilerOptions.outDir`**。
 *
 * 2026-09-23 实测踩到过：在 `infra/nest/stage.json` 的顶层与项目级都写上
 * `compilerOptions.outDir: "dist-stage"`，Nest 的 SWC builder **完全忽略**它 ——
 * 编译产物照旧落 `dist/`（因为 `apps/server/tsconfig.json` 里写着 `outDir: "./dist"`），
 * 只有 `assets[].outDir` 生效。更糟的是 `deleteOutDir: true` 会先把 **prod 的 dist**
 * 删掉再写 —— 正是这条不变量要防的事。
 *
 * 所以这里顺着 `tsConfigPath` → `extends` 链把 `outDir` 解出来（用 TypeScript 自己的
 * 配置解析器，别手写 extends 链）。
 */
export function nestOutDir(appDir: string, env: 'prod' | 'stage' | 'dev'): string | null {
  const nestJson = path.join(appDir, 'infra/nest', `${env}.json`)
  if (!existsSync(nestJson))
    return null
  const cfg = readTurboJson(nestJson) as {
    compilerOptions?: { outDir?: string, tsConfigPath?: string }
    projects?: Record<string, { compilerOptions?: { outDir?: string, tsConfigPath?: string } }>
  }
  // nest-cli 自己的 outDir 若写了就尊重它（将来 Nest 支持了就自动跟上），否则看 tsconfig
  const nestCliOut = cfg.projects?.api?.compilerOptions?.outDir ?? cfg.compilerOptions?.outDir
  if (nestCliOut)
    return nestCliOut

  const tsConfigPath = cfg.projects?.api?.compilerOptions?.tsConfigPath ?? cfg.compilerOptions?.tsConfigPath
  if (!tsConfigPath)
    return null
  const abs = path.resolve(appDir, tsConfigPath)
  // ⚠️ 读文件的回调必须**显式 utf8**：直接传 `readFileSync` 会拿到 Buffer，
  // TypeScript 解析不出配置（实测：那样两个环境都解析成 null）。
  const { config, error } = readConfigFile(abs, p => readFileSync(p, 'utf8'))
  if (error || !config)
    return null
  const parsed = parseJsonConfigFileContent(config, sys, path.dirname(abs))
  const outDir = parsed.options.outDir
  if (!outDir)
    return null
  // 返回**包内相对**路径（`dist` / `dist-stage`）——`turbo.json` 的 `outputs` 就是包内相对的，
  // 两边必须同一口径才能比。
  return path.relative(appDir, outDir).replace(/\\/g, '/')
}

/**
 * 从 `ci.yml` 里挑出「**跑有产物的构建任务、却落在跨 run 缓存路径上**」的步骤。
 *
 * 背景（2026-09-24 实测）：`actions/cache` 的 `path` 是整个 `.turbo/cache` ⇒ 在「恢复缓存」
 * 那一步**之后**跑的 turbo 任务，产物会随 job 末尾的整份上传一起进缓存。第一版就是这么漏的：
 * `Docs build` 那步是 `turbo build --filter=@walnut/docs`（产物 4.6 MB），于是归档从几十 KB
 * 涨到 4.7 MB、第二次 9.8 MB，而且随每次 docs 改动继续长。
 *
 * 判据全部机械、不猜：① 文件里得有 `uses: actions/cache@…`；② 只看**同一个 job**（遇到下一个
 * 顶格两空格的 job 名就停 —— 缓存是 job 级的）；③ 命令解析后跑的确实是 `build*` 任务
 * （根脚本按 `package.json` 里的**值**判断是不是 turbo build，**不按名字猜**）；
 * ④ 命令里没有**真正生效**的 `--cache-dir=`。
 *
 * `kind` 两种：`missing` = 压根没给缓存目录；`passthrough` = 给了但写在 `--` 之后
 * —— 那种写法参数到不了 turbo（实测 VitePress 收到了它、缓存照旧写默认目录）。
 */
export function ciStepsWritingBuildProducts(
  ciYaml: string,
  scripts: Record<string, string>,
): Array<{ step: string, command: string, kind: 'missing' | 'passthrough' }> {
  const lines = ciYaml.split(/\r?\n/)
  const cacheAt = lines.findIndex(l => /^\s*uses:\s*actions\/cache@/.test(l))
  if (cacheAt === -1)
    return []

  const out: Array<{ step: string, command: string, kind: 'missing' | 'passthrough' }> = []
  let step = '(未命名步骤)'
  for (let i = cacheAt + 1; i < lines.length; i++) {
    const l = lines[i] ?? ''
    // 下一个 job 开始 ⇒ 缓存步骤管不到那里
    if (/^ {2}[a-z][\w-]*:\s*$/i.test(l))
      break
    const name = /^\s*-\s*name:\s*(\S.*)$/.exec(l)
    if (name?.[1] !== undefined) {
      step = name[1].trim()
      continue
    }
    const run = /^\s*run:\s*(\S.*)$/.exec(l)
    if (run?.[1] === undefined)
      continue
    const command = run[1].trim()
    if (!runsBuildProductTask(command, scripts))
      continue
    const flagAt = command.indexOf('--cache-dir=')
    const sepAt = command.indexOf(' -- ')
    if (flagAt !== -1 && (sepAt === -1 || flagAt < sepAt))
      continue
    out.push({ step, command, kind: flagAt === -1 ? 'missing' : 'passthrough' })
  }
  return out
}

/** 这条命令是不是在跑 `build` / `build:stage` / `build:docs` 这类**有产物**的 turbo 任务 */
function runsBuildProductTask(command: string, scripts: Record<string, string>): boolean {
  const tokens = command.split(/\s+/)
  if (tokens[0] !== 'pnpm')
    return false
  const i = tokens[1] === 'run' || tokens[1] === 'exec' ? 2 : 1
  const target = tokens[i]
  if (target === undefined)
    return false
  if (target === 'turbo') {
    const task = tokens[i + 1] === 'run' ? tokens[i + 2] : tokens[i + 1]
    return /^build(?::|$)/.test(task ?? '')
  }
  const value = scripts[target]
  return value !== undefined && /turbo\s+(?:run\s+)?build(?:\s|$)/.test(value)
}

export function collectFindings(dry: TurboDry, cwd = REPO_ROOT): Finding[] {
  const findings: Finding[] = []
  const taskOf = (id: string) => dry.tasks.find(t => t.taskId === id)

  // ① 每个 workspace 包都必须有可解析的 `turbo.json`（extends + tags）。
  //    漏一个 = 那个包**完全不受 boundaries 约束**，且是静默的。
  //
  // ①b tags 本身还有三条更细的（2026-09-23 交叉对比时补的，P1-17）—— 「非空」只挡住了
  //    「整个忘写」，挡不住「写了个不会匹配任何规则的 tag」（那同样是**静默豁免**）：
  //      · 形态：小写 kebab、字符串、无重复（`Platform_Web` 这种拼法能通过 JSON 校验，
  //        却匹配不上 boundaries 里那条 `platform-web` 的规则）；
  //      · 平台 tag 与目录组一致：`packages/platform-any/*` 的目录名**就是**那条 tag 的语义，
  //        写成 `platform-web` 会让规则套到错的一侧；
  //      · 反向断言：`boundaries.tags` 里每条规则的 key 都要有包真的声明它 ——
  //        没有的话那条规则**永远不会触发**（恒关的规则 = 没有规则，与 `lint:doc-budget`
  //        的「预算用不到一半也算失败」同一族）。
  const declaredTags = new Map<string, string[]>()
  for (const dir of packageDirs(dry, cwd)) {
    const f = path.join(cwd, dir, 'turbo.json')
    if (!existsSync(f)) {
      findings.push({ rule: 'package-turbo-json', detail: `${dir}/turbo.json 不存在 —— 该包不受 tags 边界约束` })
      continue
    }
    let cfg: { extends?: string[], tags?: string[] }
    try {
      cfg = readTurboJson(f) as { extends?: string[], tags?: string[] }
    }
    catch (e) {
      findings.push({ rule: 'package-turbo-json', detail: `${dir}/turbo.json 解析失败：${(e as Error).message}` })
      continue
    }
    if (JSON.stringify(cfg.extends) !== '["//"]')
      findings.push({ rule: 'package-turbo-json', detail: `${dir}/turbo.json 的 extends 必须是 ["//"]，实际 ${JSON.stringify(cfg.extends)}` })
    if (!Array.isArray(cfg.tags) || cfg.tags.length === 0) {
      findings.push({ rule: 'package-turbo-json', detail: `${dir}/turbo.json 没有 tags —— 该包在 boundaries 眼里没有角色` })
      continue
    }
    declaredTags.set(dir, cfg.tags)
    for (const tag of cfg.tags) {
      if (typeof tag !== 'string' || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(tag))
        findings.push({ rule: 'tag-shape', detail: `${dir}/turbo.json 的 tag \`${String(tag)}\` 不是小写 kebab-case —— 这种 tag 匹配不上 boundaries 里任何一条规则` })
    }
    if (new Set(cfg.tags).size !== cfg.tags.length)
      findings.push({ rule: 'tag-shape', detail: `${dir}/turbo.json 的 tags 有重复：${JSON.stringify(cfg.tags)}` })
  }

  // 平台 tag 与目录组一致（只查两个 `packages/platform-*` 组：那里**目录名就是 tag 的语义**，
  // 是布局给的判据，不是我们发明的约定。apps/* 的目录名与平台 tag 没有这种对应关系，故不查）。
  const PLATFORM_GROUPS = [
    { prefix: 'packages/platform-any/', tag: 'platform-any', forbidden: ['platform-web', 'platform-node'] },
    { prefix: 'packages/platform-web/', tag: 'platform-web', forbidden: ['platform-any', 'platform-node'] },
  ] as const
  for (const [dir, tags] of declaredTags) {
    for (const group of PLATFORM_GROUPS) {
      if (!dir.startsWith(group.prefix))
        continue
      if (!tags.includes(group.tag))
        findings.push({ rule: 'platform-tag-matches-dir', detail: `${dir} 在 ${group.prefix} 下，但 tags ${JSON.stringify(tags)} 里没有 \`${group.tag}\`` })
      for (const bad of group.forbidden) {
        if (tags.includes(bad))
          findings.push({ rule: 'platform-tag-matches-dir', detail: `${dir} 在 ${group.prefix} 下，却声明了 \`${bad}\` —— 那条 boundaries 规则会套到错的一侧` })
      }
    }
  }

  // ①c 反向断言：root `boundaries.tags` 的每个 key 都得有包在声明。
  {
    const boundaries = (readTurboJson(path.join(cwd, 'turbo.json')) as { boundaries?: { tags?: Record<string, unknown> } }).boundaries
    const allDeclared = new Set([...declaredTags.values()].flat())
    for (const tag of Object.keys(boundaries?.tags ?? {})) {
      if (!allDeclared.has(tag))
        findings.push({ rule: 'boundary-rule-has-subject', detail: `根 turbo.json 的 boundaries.tags.\`${tag}\` 没有任何包声明这个 tag —— 这条规则永远不会生效（恒关的规则 = 没有规则）` })
    }
  }

  // ② `globalDependencies` 的每一条都必须命中真实文件。
  //    写错一个字符（改名、挪目录）不会报错，只会**少一个全局失效源**。
  const rootPkg = readTurboJson(path.join(cwd, 'turbo.json')) as { globalDependencies?: string[], tasks?: Record<string, { dependsOn?: string[] }> }
  for (const g of rootPkg.globalDependencies ?? []) {
    if (!globMatchesSomething(g, cwd))
      findings.push({ rule: 'global-dependency-exists', detail: `globalDependencies 里的 \`${g}\` 匹配不到任何文件` })
  }

  // ③ 解过密的 app：`env-local/**` 必须进 build 的 inputs。
  //    它被 gitignore，`$TURBO_DEFAULT$` 看不见 —— 漏了就等于「改 .env 不重建」。
  for (const appDir of packageDirs(dry, cwd).filter(d => d.startsWith('apps/'))) {
    if (!existsSync(path.join(cwd, appDir, 'env-local')))
      continue
    for (const taskName of ['build', 'build:stage']) {
      const t = dry.tasks.find(x => x.task === taskName && norm(x.directory, cwd) === appDir)
      const inputs = t?.resolvedTaskDefinition.inputs ?? []
      if (!inputs.includes('env-local/**'))
        findings.push({ rule: 'env-local-in-inputs', detail: `${appDir} 有 env-local/ 但 ${taskName}.inputs 里没有 "env-local/**"` })
    }
  }

  // ④ 产物目录必须逐个进 outputs —— 这条就是 `dist-staging` 那个 bug 的守卫。
  //    判据取自 env 文件里的真实取值（VITE_BUILD_OUT_DIR），而不是我们手抄的目录名。
  const outDirCases = [
    { app: 'apps/admin', task: 'build', env: 'apps/admin/env-local/.env.production' },
    { app: 'apps/admin', task: 'build:stage', env: 'apps/admin/env-local/.env.stage' },
  ]
  for (const c of outDirCases) {
    const dirs = declaredOutDirs(path.join(cwd, c.env))
    if (dirs.length === 0)
      continue
    const t = dry.tasks.find(x => x.task === c.task && norm(x.directory, cwd) === c.app)
    const outputs = t?.resolvedTaskDefinition.outputs ?? []
    for (const d of dirs) {
      const want = outGlob(d)
      if (!outputs.includes(want))
        findings.push({ rule: 'outputs-cover-artifacts', detail: `${c.app} 的 ${c.task} 实际产物目录是 ${d}（${c.env}），但 outputs ${JSON.stringify(outputs)} 里没有 "${want}" —— 缓存命中时不会回放产物` })
    }
  }

  // ④b 同一个 app 的两条构建流程不能落进同一个产物目录。
  //     turbo 缓存命中时按 `outputs` 把产物**重放**回盘上 ⇒ 两边声明同一个目录时，
  //     后跑的那次（含缓存重放）决定盘上留的是哪一版，而且**不报错**。
  //     判据取自 nest 配置里的真实 outDir（server 侧），不是手抄的目录名。
  for (const appDir of packageDirs(dry, cwd).filter(d => d.startsWith('apps/'))) {
    const appAbs = path.join(cwd, appDir)
    const hasNest = existsSync(path.join(appAbs, 'infra/nest/prod.json'))
    if (!hasNest)
      continue
    const prod = nestOutDir(appAbs, 'prod')
    const stage = nestOutDir(appAbs, 'stage')
    // ⚠️ 解析不出来**不能当成「不适用」跳过** —— 2026-09-23 自己踩过：`appDir` 少取了一级
    // 目录，两个都解析成 null，于是这条检查静默跳过、门禁照样全绿。
    if (prod === null || stage === null) {
      findings.push({ rule: 'stage-outdir-separate', detail: `${appDir} 有 infra/nest/prod.json，但解析不出 ${prod === null ? 'prod' : 'stage'} 的产物目录（看 infra/nest/*.json 的 tsConfigPath → tsconfig 的 outDir）` })
      continue
    }
    if (prod === stage) {
      findings.push({ rule: 'stage-outdir-separate', detail: `${appDir} 的 prod 与 stage 构建都写 ${prod}/（infra/nest/{prod,stage}.json）—— 缓存重放会让两条流程互相覆盖产物` })
      continue
    }
    const t = dry.tasks.find(x => x.task === 'build:stage' && norm(x.directory, cwd) === appDir)
    const outputs = t?.resolvedTaskDefinition.outputs ?? []
    if (!outputs.includes(outGlob(stage)))
      findings.push({ rule: 'outputs-cover-artifacts', detail: `${appDir} 的 build:stage 产物目录是 ${stage}（infra/nest/stage.json），但 outputs ${JSON.stringify(outputs)} 里没有 "${outGlob(stage)}"` })
  }

  // ⑤ `types:check` 必须经 `transit` 拿到上游**源码**的哈希。
  //    本仓共享包的 exports 指 ./src/**，下游类型是从源码读的；断了这条边就是回放假绿。
  const tc = (rootPkg.tasks ?? {})
  if (!tc.transit) {
    findings.push({ rule: 'transit-exists', detail: '根 turbo.json 里没有 `transit` 任务 —— types:check 会看不到依赖包的源码变更' })
  }
  else {
    if (!(tc.transit.dependsOn ?? []).includes('^transit'))
      findings.push({ rule: 'transit-chains', detail: 'transit.dependsOn 里必须含 "^transit"，否则不会沿依赖图逐级上溯' })
    if (!(tc['types:check']?.dependsOn ?? []).includes('transit'))
      findings.push({ rule: 'transit-chains', detail: 'types:check.dependsOn 里必须含 "transit"' })
  }

  // ⑥ docs 的 build 必须把 .md 算进输入 —— 那同时也是死链门禁的输入。
  //    根 build 任务排除了 `!**/*.md`，docs 靠包级覆写补回来；覆写丢了 = 改文档不重建、静默跳过死链校验。
  const docsBuild = taskOf('@walnut/docs#build')
  if (docsBuild) {
    const mdCount = Object.keys(docsBuild.inputs ?? {}).filter(k => k.endsWith('.md')).length
    if (mdCount === 0)
      findings.push({ rule: 'docs-build-sees-markdown', detail: '@walnut/docs#build 的输入里一个 .md 都没有 —— 改文档不会重建，死链校验被跳过' })
  }

  // ⑧ `//#lint:root` 的 `inputs` 必须与根脚本里那几个 glob **双向一致**。
  //    这条是「根级文件也要能被缓存」的守卫，两个方向都会出事：
  //      · 写成 `$TURBO_ROOT$/**` 再逐条排除 ⇒ 运行期目录（`.turbo` / 各包 `dist` /
  //        `node_modules`）漏排一个，缓存就**永不命中**（每次 push 都真跑）；
  //      · 排过头（例如顺手排掉 `packages/**`）⇒ 根 eslint 配置 import 的东西不进缓存键，
  //        改完规则却回放旧结论 —— **门禁假绿**（参考仓实测踩过这个方向）。
  //    最稳的写法就是让 inputs 逐字等于脚本的 glob，这条断言把「最稳」变成强制的。
  {
    const rootPkgJson = readTurboJson(path.join(cwd, 'package.json')) as { scripts?: Record<string, string> }
    const script = rootPkgJson.scripts?.['lint:root']
    const task = (rootPkg.tasks ?? {})['//#lint:root'] as { inputs?: string[] } | undefined
    if (script === undefined || task === undefined) {
      findings.push({ rule: 'lint-root-inputs', detail: `根 \`lint:root\` 脚本或 \`//#lint:root\` 任务缺失（脚本：${script === undefined ? '无' : '有'}，任务：${task === undefined ? '无' : '有'}）` })
    }
    else {
      // 从脚本里挑出「看起来是 glob 的位置参数」：含 `*` 且不以 `-` 开头
      const globs = script.split(/\s+/).filter(t => t.includes('*') && !t.startsWith('-'))
      const inputs = new Set(task.inputs ?? [])
      for (const g of globs) {
        const want = `$TURBO_ROOT$/${g}`
        if (!inputs.has(want))
          findings.push({ rule: 'lint-root-inputs', detail: `根脚本 lint:root 里的 \`${g}\` 不在 //#lint:root 的 inputs 里（缺 \`${want}\`）—— 改这类文件不会重新 lint` })
      }
      for (const i of inputs) {
        if (!i.startsWith('$TURBO_ROOT$/'))
          continue
        const g = i.slice('$TURBO_ROOT$/'.length)
        if (!globs.includes(g))
          findings.push({ rule: 'lint-root-inputs', detail: `//#lint:root 的 inputs 里有 \`${i}\`，但根脚本并不检查它 —— 白担了「随运行变化 ⇒ 缓存永不命中」的风险` })
      }
    }
  }

  // ⑨ CI 那份跨 run 的缓存里**只许有元数据条目**（2026-09-24 实测踩到，见 §七）。
  //    缓存路径是整个 `.turbo/cache` ⇒ 恢复之后跑的 turbo 任务，产物会随 job 末尾的整份上传
  //    一起进缓存：`Docs build`（4.6 MB）把归档从几十 KB 顶到 4.7 MB、第二次 9.8 MB。
  //    判据见 `ciStepsWritingBuildProducts`（含「`--cache-dir` 写在 `--` 之后到不了 turbo」那条）。
  {
    const ciPath = path.join(cwd, '.github/workflows/ci.yml')
    const scripts = (readTurboJson(path.join(cwd, 'package.json')) as { scripts?: Record<string, string> }).scripts ?? {}
    if (existsSync(ciPath)) {
      for (const s of ciStepsWritingBuildProducts(readFileSync(ciPath, 'utf8'), scripts)) {
        findings.push(s.kind === 'passthrough'
          ? { rule: 'ci-cache-flag-reaches-turbo', detail: `ci.yml 的步骤「${s.step}」把 \`--cache-dir\` 写在 \`--\` 之后 ⇒ 它被 turbo 当成**透传给任务本身**的参数（实测：VitePress 收到它，缓存照旧写默认目录）。去掉那个 \`--\`：\`${s.command}\`` }
          : { rule: 'ci-cache-holds-only-metadata', detail: `ci.yml 的步骤「${s.step}」跑的是**有产物**的构建任务（\`${s.command}\`），却又落在跨 run 缓存的路径上 —— 产物会随整份 \`.turbo/cache\` 一起上传（实测把归档从几十 KB 顶到 4.7 MB）。给它自己的 \`--cache-dir\`，或把这一步挪到恢复缓存之前。` })
      }
    }
  }

  return findings
}

export function main(): void {
  let dry: TurboDry
  try {
    dry = loadTurboDry()
  }
  catch (e) {
    // 措辞刻意不写「配置有问题」：这里失败也可能是**根本起不来 turbo**（找不到 pnpm、cwd 不对）
    throw new PreconditionError(`拿不到 turbo 的解析结果（\`pnpm exec turbo run … --dry=json\` 没跑成）：${(e as Error).message}`)
  }
  const findings = collectFindings(dry)
  const tasks = dry.tasks.length

  if (findings.length === 0) {
    line('ok', `Turborepo 配置不变量：${tasks} 个 task、${packageDirs(dry).length} 个包，全部成立`)
    out('  （覆盖两类：缓存边界 —— 产物/outputs/env/依赖边；以及 tags —— 形态/平台一致/反向断言）')
    return
  }
  lineErr('violation', `Turborepo 配置有 ${findings.length} 处问题：\n`)
  for (const f of findings) err(`  [${f.rule}] ${f.detail}`)
  err('\n判据与手工复核方法见 apps/docs/src/zh-CN/content/monorepo/turbo-cache-boundary.md')
  throw new ViolationError(`Turbo 配置有 ${findings.length} 处问题（明细见上）`)
}
