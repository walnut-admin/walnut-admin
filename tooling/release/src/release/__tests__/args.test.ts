/**
 * `parseReleaseArgs` 的参数表契约：形式等价、值校验、入口互斥。
 *
 * 这些用例钉的是 args.ts 注释里的判据 —— 参数解析是 `main()` 的第一个动作，
 * 任何错用都必须在**动仓库之前**以 exit 2 结束。
 */

import type { ReleaseArgs } from '../args.ts'
import { describe, expect, it } from 'vitest'
import { CONSUME_ATTEMPTS_DEFAULT, parseReleaseArgs, skipGatesLabel } from '../args.ts'

/** 解析成功并取回 args；失败即用例失败（把失败文案带进报错，便于定位） */
function ok(argv: string[]): ReleaseArgs {
  const parsed = parseReleaseArgs(argv)
  if (!parsed.ok)
    throw new Error(`期望解析成功，实际失败：${parsed.message}（argv: ${argv.join(' ')}）`)
  return parsed.args
}

/** 解析失败并取回文案；成功即用例失败 */
function fail(argv: string[]): string {
  const parsed = parseReleaseArgs(argv)
  if (parsed.ok)
    throw new Error(`期望解析失败，实际成功（argv: ${argv.join(' ')}）`)
  return parsed.message
}

describe('parseReleaseArgs —— 形式约定', () => {
  it('`--flag value` 与 `--flag=value` 共用一条代码路径（结果逐字段相同）', () => {
    expect(ok(['--bump', 'minor'])).toEqual(ok(['--bump=minor']))
    expect(ok(['--token', 'ghp_12345678'])).toEqual(ok(['--token=ghp_12345678']))
    expect(ok(['--consume-attempts', '7'])).toEqual(ok(['--consume-attempts=7']))
    expect(ok(['--bump=minor']).bump).toBe('minor')
    expect(ok(['--token=ghp_12345678']).token).toBe('ghp_12345678')
    expect(ok(['--consume-attempts=7']).consumeAttempts).toBe(7)
  })

  it('缺省值：bump=null / skipGates=null / consumeAttempts=默认 / 布尔全 false', () => {
    expect(CONSUME_ATTEMPTS_DEFAULT).toBe(4)
    expect(ok([])).toEqual({
      help: false,
      yes: false,
      json: false,
      status: false,
      plan: false,
      intentOnly: false,
      dryRun: false,
      allowDirty: false,
      requireGithubMeta: false,
      skipGates: null,
      bump: null,
      token: null,
      consumeAttempts: CONSUME_ATTEMPTS_DEFAULT,
    })
  })

  it('布尔 flag 与短别名', () => {
    expect(ok(['--yes']).yes).toBe(true)
    expect(ok(['-y']).yes).toBe(true)
    expect(ok(['--help']).help).toBe(true)
    expect(ok(['-h']).help).toBe(true)
    expect(ok(['--json']).json).toBe(true)
    expect(ok(['--allow-dirty']).allowDirty).toBe(true)
    expect(ok(['--require-github-meta']).requireGithubMeta).toBe(true)
    expect(ok(['--intent-only']).intentOnly).toBe(true)
    expect(ok(['--status']).status).toBe(true)
    expect(ok(['--plan']).plan).toBe(true)
    expect(ok(['--dry-run']).dryRun).toBe(true)
  })
})

describe('parseReleaseArgs —— 值 flag 的校验', () => {
  it('--bump 只认 major | minor | patch（`none` 不是命令行档位）', () => {
    expect(ok(['--bump', 'major']).bump).toBe('major')
    expect(ok(['--bump', 'minor']).bump).toBe('minor')
    expect(ok(['--bump', 'patch']).bump).toBe('patch')
    for (const value of ['none', 'huge', 'Minor', '1']) {
      const message = fail(['--bump', value])
      expect(message, `--bump ${value} 应当被拒绝`).toContain('--bump 只能是 major | minor | patch')
      expect(message).toContain(`收到 '${value}'`)
    }
    expect(fail(['--bump', ''])).toContain(`收到 ''`)
  })

  it('--bump 缺值（行尾 / 后面跟着另一个 flag）都报「需要给值」', () => {
    expect(fail(['--bump'])).toContain('--bump 需要给值')
    expect(fail(['--bump', '--yes'])).toContain('--bump 需要给值')
  })

  it('--token 长度 < 8 被拒（trim 之后算长度），合法值落库时已 trim', () => {
    expect(fail(['--token', 'short'])).toContain('--token 看起来不是一个令牌')
    expect(fail(['--token', '        '])).toContain('--token 看起来不是一个令牌')
    expect(ok(['--token', 'ghp_1234']).token).toBe('ghp_1234')
    expect(ok(['--token', '  ghp_1234  ']).token).toBe('ghp_1234')
  })

  it('--consume-attempts 只能是 1..20 的整数', () => {
    expect(ok(['--consume-attempts', '1']).consumeAttempts).toBe(1)
    expect(ok(['--consume-attempts', '20']).consumeAttempts).toBe(20)
    for (const value of ['0', '21', '-1', '3.5', 'abc', '1e2']) {
      const message = fail(['--consume-attempts', value])
      expect(message, `--consume-attempts ${value} 应当被拒绝`).toContain('--consume-attempts 只能是 1..20 的整数')
    }
  })

  it('未知 flag 与位置参数都被拒绝', () => {
    expect(fail(['--nope'])).toContain('未知参数')
    expect(fail(['--nope=1'])).toContain('未知参数')
    expect(fail(['some-package'])).toContain('不接受位置参数')
    expect(fail(['--bump', 'patch', 'extra'])).toContain('不接受位置参数')
  })

  it('同一个值 flag 给了两个不同值 → 拒绝；重复给同一个值 → 接受', () => {
    expect(fail(['--bump', 'patch', '--bump', 'minor'])).toContain('--bump 给了两次且值不同')
    expect(fail(['--bump=patch', '--bump=minor'])).toContain('给了两次且值不同')
    expect(ok(['--bump', 'patch', '--bump=patch']).bump).toBe('patch')
  })
})

describe('parseReleaseArgs —— --skip-gates（唯一允许裸用的 flag）', () => {
  it('裸 --skip-gates ⇒ all', () => {
    expect(ok(['--skip-gates']).skipGates).toBe('all')
  })

  it('--skip-gates=a,b ⇒ [a, b]（去空白、丢空项）', () => {
    expect(ok(['--skip-gates=lint,test']).skipGates).toEqual(['lint', 'test'])
    expect(ok(['--skip-gates=lint, test']).skipGates).toEqual(['lint', 'test'])
    expect(ok(['--skip-gates=lint,,test,']).skipGates).toEqual(['lint', 'test'])
  })

  it('空的 --skip-gates= 被拒绝', () => {
    expect(fail(['--skip-gates='])).toContain('--skip-gates= 后面要跟门禁 id')
    expect(fail(['--skip-gates=,,'])).toContain('--skip-gates= 后面要跟至少一个门禁 id')
  })

  it('skipGatesLabel 复述三种形状', () => {
    expect(skipGatesLabel(null)).toBe('')
    expect(skipGatesLabel('all')).toBe('已跳过发版前门禁与全量电池（--skip-gates）')
    expect(skipGatesLabel(['lint', 'test'])).toBe('已跳过发版前门禁项：lint / test（--skip-gates=…）')
  })
})

describe('parseReleaseArgs —— 入口点互斥矩阵', () => {
  const ENTRIES = ['--help', '--status', '--plan', '--intent-only']

  it('四个入口两两组合一律拒绝', () => {
    // `--status` + `--plan` 有专用文案（下一条用例单测），这里只断言「被拒」
    const specialPair = new Set(['--plan|--status', '--status|--plan'])
    for (const first of ENTRIES) {
      for (const second of ENTRIES) {
        if (first === second)
          continue
        const message = fail([first, second])
        expect(message, `${first} + ${second} 应当被拒绝`).toMatch(
          specialPair.has(`${first}|${second}`) ? /同一个只读面的两种措辞/ : /这些入口一次只能用一个/,
        )
      }
    }
  })

  it('--status 与 --plan 一起给：报专用文案（两者是同一只读面的两种措辞）', () => {
    // 这条判定刻意排在通用互斥判定**之前** —— 否则它会被拦成「这些入口一次只能用一个」，
    // 行为对但文案没用（用户多半是拿不准用哪个，而不是想同时跑两个入口）。
    const message = fail(['--status', '--plan'])
    expect(message).toContain('--status 与 --plan 是同一个只读面的两种措辞')
  })

  it('只读入口不许带 --skip-gates（--help 例外）', () => {
    for (const entry of ['--status', '--plan', '--intent-only']) {
      expect(fail([entry, '--skip-gates'])).toContain('--skip-gates 只对真正的发版有意义')
      expect(fail([entry, '--skip-gates=lint'])).toContain('--skip-gates 只对真正的发版有意义')
    }
    // `--help` 里有这条 flag 的说明，不该被它拦下
    expect(ok(['--help', '--skip-gates']).help).toBe(true)
  })

  it('--dry-run 不能和只读面一起给', () => {
    expect(fail(['--status', '--dry-run'])).toContain('--dry-run 是「演练发版」')
    expect(fail(['--plan', '--dry-run'])).toContain('--dry-run 是「演练发版」')
    expect(ok(['--dry-run']).dryRun).toBe(true)
    expect(ok(['--dry-run', '--yes', '--bump', 'patch'])).toMatchObject({ dryRun: true, yes: true, bump: 'patch' })
  })
})
