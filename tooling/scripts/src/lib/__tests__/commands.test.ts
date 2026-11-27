/**
 * 命令表（`src/lib/commands.ts`）的机械审计。
 *
 * 集中到一张表之后，新的失败模式是**表里写错**（id 打错、bin 名拼错、某条命令同时住在两处）——
 * 这类错不会当场报错，只会让某条命令「不存在」或「指向一个不存在的 bin」，正是本仓最忌讳的
 * 静默失效。所以这里断言的是：id 唯一且形态合法、根脚本只剩保留的那几条、bin 都真的声明过、
 * 按名解析的方向没写反。
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { COMMANDS, KEPT_ROOT_SCRIPTS, resolveCommandArgv } from '../commands.ts'
import { REPO_ROOT } from '../repo-root.ts'

function readJson(rel: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path.join(REPO_ROOT, rel), 'utf8')) as Record<string, unknown>
}

const rootScripts = new Set(
  Object.keys((readJson('package.json').scripts ?? {}) as Record<string, string>),
)

/** 两个工具包声明的 bin（命令表里 `exec walnut-*` 必须落到其中之一） */
const declaredBins = new Set([
  ...Object.keys((readJson('tooling/scripts/package.json').bin ?? {}) as Record<string, string>),
  ...Object.keys((readJson('tooling/release/package.json').bin ?? {}) as Record<string, string>),
])

/** 小写 kebab，`:` 分段，无空段（与根脚本形态门禁同一口径） */
const ID_SHAPE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?::[a-z][a-z0-9]*(?:-[a-z0-9]+)*)*$/

const GROUPS = new Set(['开发', '构建', '门禁', '依赖', '数据库', '环境', '发版与镜像', '工具'])

function argvOf(command: (typeof COMMANDS)[number]): readonly string[] | null {
  return 'argv' in command ? command.argv : null
}

describe('命令表 —— 表本身', () => {
  it('id 唯一、非空、形态是小写 kebab + `:` 分段', () => {
    const ids = COMMANDS.map((command) => command.id)
    expect(new Set(ids).size, `id 有重复：${ids.join(', ')}`).toBe(ids.length)
    for (const id of ids) {
      expect(id, 'id 不能为空').not.toBe('')
      expect(id, `\`${id}\` 不是合法形态（写进命令行会解析不到）`).toMatch(ID_SHAPE)
    }
  })

  it('分组都在约定集合之内', () => {
    for (const command of COMMANDS)
      expect(
        GROUPS.has(command.group),
        `${command.id} 的分组「${command.group}」不在约定集合之内`,
      ).toBe(true)
  })

  it('每条都写了说明与「凭什么」（空的就是清单与失败回放都没东西可看）', () => {
    for (const command of COMMANDS) {
      expect(command.label.length, `${command.id} 的 label 太短`).toBeGreaterThan(4)
      expect(command.why.length, `${command.id} 的 why 太短，等于没写`).toBeGreaterThan(15)
    }
  })

  it('根 package.json 的每条脚本（除入口 walnut）都在表里', () => {
    const ids = new Set(COMMANDS.map((command) => command.id))
    const missing = [...rootScripts].filter((name) => name !== 'walnut' && !ids.has(name))
    expect(missing, `这些根脚本没有进命令表：${missing.join(', ')}`).toEqual([])
    expect(ids.has('walnut'), '入口自己不该是命令表的一项').toBe(false)
  })

  it('表里引用的每个 `walnut-*` bin 都已在两个工具包之一声明过', () => {
    const referenced = new Set<string>()
    for (const command of COMMANDS) {
      for (const token of argvOf(command) ?? []) {
        if (token.startsWith('walnut-')) referenced.add(token)
      }
    }
    expect(
      referenced.size,
      '一个 walnut-* bin 都没扫到 —— 解析退化，下面的断言会变成空转',
    ).toBeGreaterThan(5)
    const dangling = [...referenced].filter((name) => !declaredBins.has(name))
    expect(dangling, `命令表引用了未声明的 bin：${dangling.join(', ')}`).toEqual([])
  })

  it('argv 元素里不许出现 shell 连接子（runArgs 是 shell: false，连接子会被原样交给工具）', () => {
    const connectors = ['&&', '||', ';', '|']
    const bad: string[] = []
    for (const command of COMMANDS) {
      for (const token of argvOf(command) ?? []) {
        for (const connector of connectors) {
          if (token.includes(connector)) bad.push(`${command.id}: \`${token}\` 含 ${connector}`)
        }
      }
    }
    expect(bad).toEqual([])
  })

  it('保留的根脚本在表里、且 argv 是 run 加 id 的两段（仍然由根脚本执行）', () => {
    for (const id of KEPT_ROOT_SCRIPTS) {
      const command = COMMANDS.find((item) => item.id === id)
      expect(command, `保留的根脚本 \`${id}\` 不在命令表里`).toBeTruthy()
      expect(
        argvOf(command!),
        `\`${id}\` 的 argv 应该是 ['run', '${id}']，避免命令在两处各写一遍`,
      ).toEqual(['run', id])
      expect(rootScripts.has(id), `保留的根脚本 \`${id}\` 实际不在根 package.json 里`).toBe(true)
    }
  })

  it('ci:local 是 argv 形态（经 walnut-ci-local bin 执行，参数由 bin 转发给 local-ci 的 main）', () => {
    const command = COMMANDS.find((item) => item.id === 'ci:local')
    expect(command, 'ci:local 不见了').toBeTruthy()
    expect(
      argvOf(command!),
      'ci:local 应当经 bin 执行 —— 自定义形态会让命令表与 local-ci 互为运行期依赖',
    ).toEqual(['exec', 'walnut-ci-local'])
  })

  it('自己给各部分定了预算的命令，入口层不再套全局上限（两层上限 = 把合法的慢判成卡死）', () => {
    // prepush / ci:local：段表与步骤表里每一段各有预算，顺序跑时合法耗时加起来远超入口缺省的 15 分钟；
    // images:*：同一份 Dockerfile 的构建实测 15m49s ~ 77m53s（依据在 docker-bake.hcl 头注释）。
    // 入口缺省值（15 分钟）对单步命令是对的，别为了这几条去改缺省 —— 改这里的那条命令。
    for (const id of ['prepush', 'ci:local', 'images:build', 'images:push']) {
      const command = COMMANDS.find((item) => item.id === id)
      expect(command, `${id} 不在表里`).toBeTruthy()
      expect(command!.budgetMs, `${id} 的入口级预算必须是「不设上限」（0）`).toBe(0)
    }
  })

  it('clean:all 是自定义执行项（在入口进程里直接删，不经 rimraf）', () => {
    const command = COMMANDS.find((item) => item.id === 'clean:all')
    expect(command, 'clean:all 不见了').toBeTruthy()
    expect(
      command && 'run' in command,
      'clean:all 必须是自定义项（rimraf 在 Windows 上做不到以 0 收场）',
    ).toBe(true)
    expect(argvOf(command!)).toBeNull()
  })

  it('扫描面非空（防止表被清空后上面几条全部空转）', () => {
    expect(COMMANDS.length).toBeGreaterThan(20)
  })

  it('根 package.json 的 scripts 恰好是保留的那几条（其余全部住命令表）', () => {
    // 判据写成集合相等：多了会红（有人又把一条命令抄回根），少了也红（外部按名字调用的契约断了）。
    // 成员由 KEPT_ROOT_SCRIPTS + 入口自己决定 —— 不在这里再抄一份数量（那会腐烂）。
    expect(new Set(rootScripts)).toEqual(new Set(['walnut', ...KEPT_ROOT_SCRIPTS]))
  })

  it('表里写成 `run <id>` 的命令，其 id 必须是真实存在的根脚本', () => {
    const bad: string[] = []
    for (const command of COMMANDS) {
      const argv = argvOf(command)
      if (argv?.[0] !== 'run') continue
      const target = argv[1]
      if (target === undefined || !rootScripts.has(target))
        bad.push(`${command.id}: argv 是 run ${target ?? '(空)'}，但根脚本里没有它`)
      if (target !== command.id)
        bad.push(
          `${command.id}: argv 的 run 目标 \`${target}\` 与 id 不一致（命令会在两处各写一遍）`,
        )
    }
    expect(bad).toEqual([])
    expect(
      COMMANDS.filter((command) => argvOf(command)?.[0] === 'run').length,
      '一条 run 形态都没有 —— 解析退化？',
    ).toBeGreaterThan(5)
  })

  it('没有任何一个 argv 形态的 id 还是根脚本（除了那几条 run 形态的）', () => {
    // 这是「表是唯一真源」的方向断言：一条命令只能有一个家 —— 要么住表里经 argv 执行，
    // 要么是保留的根脚本（表里写成 run <id>）。两处并存迟早漂移。
    const bad = COMMANDS.filter((command) => argvOf(command)?.[0] !== 'run')
      .filter((command) => rootScripts.has(command.id))
      .map((command) => command.id)
    expect(bad, `这些 id 既在表里以 argv 执行、又还是根脚本：${bad.join(', ')}`).toEqual([])
  })
})

describe('resolveCommandArgv —— 按名解析', () => {
  it('首词是命令表 id ⇒ 换成该命令真正要跑的 argv', () => {
    expect(resolveCommandArgv(['lint:adr'])).toEqual(['exec', 'walnut-check-adr'])
    expect(resolveCommandArgv(['boundaries'])).toEqual(['exec', 'turbo', 'boundaries'])
  })

  it('原 argv 的其余部分跟在展开结果后面（参数不许在解析时丢掉）', () => {
    expect(resolveCommandArgv(['lint:adr', '--fix'])).toEqual(['exec', 'walnut-check-adr', '--fix'])
  })

  it('pnpm 子命令原样返回（三张表的 argv 靠这条保持现状）', () => {
    expect(resolveCommandArgv(['exec', 'turbo', 'run', 'lint'])).toEqual([
      'exec',
      'turbo',
      'run',
      'lint',
    ])
    expect(resolveCommandArgv(['change', 'check'])).toEqual(['change', 'check'])
  })

  it('保留的根脚本名原样返回', () => {
    expect(resolveCommandArgv(['prepush'])).toEqual(['prepush'])
    expect(resolveCommandArgv(['release'])).toEqual(['release'])
    expect(resolveCommandArgv(['lint', '--force'])).toEqual(['lint', '--force'])
  })

  it('自定义命令没有可展开的 argv ⇒ 原样返回', () => {
    expect(resolveCommandArgv(['clean:all', '--dry-run'])).toEqual(['clean:all', '--dry-run'])
  })

  it('ci:local 解析到 walnut-ci-local（参数跟在后面，不会被解析吞掉）', () => {
    expect(resolveCommandArgv(['ci:local', '--only=actionlint'])).toEqual([
      'exec',
      'walnut-ci-local',
      '--only=actionlint',
    ])
  })

  it('未知首词与空 argv 原样返回（解析器不是校验器）', () => {
    expect(resolveCommandArgv(['nope'])).toEqual(['nope'])
    expect(resolveCommandArgv([])).toEqual([])
  })

  it('解析结果真的是 root 脚本 / pnpm 子命令（对每条命令逐一验，不是抽样）', () => {
    for (const command of COMMANDS) {
      const resolved = resolveCommandArgv([command.id])
      expect(resolved.length, `${command.id} 解析出空 argv`).toBeGreaterThan(0)
      if ('run' in command) {
        expect(resolved, `${command.id} 是自定义项，解析后应保持首词`).toEqual([command.id])
        continue
      }
      const [head, second] = resolved
      if (head === 'exec') {
        expect(resolved.length, `${command.id}: exec 后面没有命令`).toBeGreaterThan(1)
      } else if (head === '-C') {
        expect(second, `${command.id}: -C 后面没有目录`).toBeTruthy()
      } else {
        expect(rootScripts.has(head!), `${command.id} 展开后的首词 \`${head}\` 不是根脚本`).toBe(
          true,
        )
      }
    }
  })
})
