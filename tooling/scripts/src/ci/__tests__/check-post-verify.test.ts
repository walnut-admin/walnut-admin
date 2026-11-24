/**
 * `check-post-verify.ts` 的用例。
 *
 * 被测对象把「一次子进程结果」翻译成门禁结论，所以用例只喂 `{ code, output }`：
 * 三种判定各一条，外加解析边界（计数行不在末尾 / 根本没有 / 输出被截短）。
 * 真跑 `deploy/post-verify.test.sh` 的那一面**刻意不放进单测**：本机实测直接跑约 90 秒、
 * 经门禁（Node 再起 MSYS bash）约 185 秒，那是门禁与 CI 该付的成本，不是单测的；
 * 真跑由 `pnpm walnut lint:post-verify` 覆盖。适用范围（改了相关文件才真跑）是另一个纯函数，
 * 用例覆盖它三个「真跑」的方向与唯一一个「不适用」的方向。
 */
import { describe, expect, it } from 'vitest'
import { interpretRunResult, judgeApplicability, parseTally, tailOf } from '../check-post-verify.ts'

describe('judgeApplicability —— 什么时候需要真跑', () => {
  const base = { isCi: false, upstream: 'origin/main' }

  it('在 CI 上每次都真跑，不看改动面', () => {
    const verdict = judgeApplicability({ isCi: true, upstream: null, changed: null })
    expect(verdict.kind).toBe('run')
  })

  it('判不出改动面（没有上游 / git 读不到）⇒ 真跑：不知道有没有改就按改了处理', () => {
    expect(judgeApplicability({ ...base, upstream: null, changed: null }).kind).toBe('run')
    expect(judgeApplicability({ ...base, changed: null }).kind).toBe('run')
  })

  it('改了相关文件 ⇒ 真跑（两个脚本、入口 nginx 配置、门禁自身各验一条）', () => {
    for (const file of [
      'deploy/post-verify.sh',
      'deploy/post-verify.test.sh',
      'deploy/nginx/conf.d/api.conf',
      'tooling/scripts/src/ci/check-post-verify.ts',
    ]) {
      expect(judgeApplicability({ ...base, changed: ['README.md', file] }).kind, file).toBe('run')
    }
  })

  it('只改了无关文件 ⇒ 不适用，并带上上游名与改动文件数（结论行要说清依据）', () => {
    const verdict = judgeApplicability({ ...base, changed: ['README.md', 'apps/admin/src/main.ts'] })
    expect(verdict).toEqual({ kind: 'not-applicable', upstream: 'origin/main', changedCount: 2 })
  })

  it('同前缀的无关文件（如 `deploy/post-verify.sh.bak`）按「可能相关」处理 —— 多跑一次，不漏跑', () => {
    // 清单是前缀匹配：宁可被 `.bak` 这类同前缀文件触发一次真跑，也不为了精确匹配把清单写成
    // 一堆特判（那正是「清单漏一个就永远不跑」的温床）
    const verdict = judgeApplicability({ ...base, changed: ['deploy/post-verify.sh.bak'] })
    expect(verdict.kind).toBe('run')
  })
})

/** 与脚本真实输出同形（变量部分是临时目录路径，判定不依赖它） */
const OK_OUTPUT = `== post-verify.sh 行为测试 ==
全部正常 → PASS              exit=0
容器未运行 → 失败            exit=1

通过 15，失败 0
`

const FAIL_OUTPUT = `== post-verify.sh 行为测试 ==
全部正常 → PASS              exit=0
只缺 Referrer-Policy → 失败  exit=0（期望 1）
   | [t] #2 就绪=1 容器='' tag='' 前端=200 API=200 健康探针=404 缺失安全头='www.example.com: Referrer-Policy'

通过 14，失败 1
`

describe('parseTally —— 脚本末尾的「通过 N，失败 M」', () => {
  it('解析出通过 / 失败条数', () => {
    expect(parseTally(OK_OUTPUT)).toEqual({ passed: 15, failed: 0 })
    expect(parseTally(FAIL_OUTPUT)).toEqual({ passed: 14, failed: 1 })
  })

  it('半角逗号也认（脚本改成 `printf \'通过 %d, 失败 %d\'` 时不至于解析退化）', () => {
    expect(parseTally('通过 3, 失败 2')).toEqual({ passed: 3, failed: 2 })
  })

  it('没有计数行返回 null（不猜数字）', () => {
    expect(parseTally('== 什么都没跑 ==\n')).toBeNull()
    expect(parseTally('')).toBeNull()
  })

  it('取最后一个匹配（失败回放的日志里出现同形状文字时不带偏）', () => {
    expect(parseTally('通过 99，失败 0\n回放：通过 1，失败 2\n通过 15，失败 0'))
      .toEqual({ passed: 15, failed: 0 })
  })
})

describe('tailOf —— 违规时带出的输出尾部', () => {
  it('只留最后 N 行，且去掉 CR 与空行', () => {
    const output = Array.from({ length: 30 }, (_, i) => `line-${i + 1}`).join('\r\n')
    const tail = tailOf(output, 3)
    expect(tail).toBe('line-28\nline-29\nline-30')
    expect(tail).not.toContain('line-1\n')
  })

  it('实际输出比上限短时原样全留', () => {
    expect(tailOf('a\n\nb\n', 10)).toBe('a\nb')
  })

  it('空输出返回空串（调用方自己决定怎么措辞）', () => {
    expect(tailOf('')).toBe('')
  })
})

describe('interpretRunResult —— 退出码到结论', () => {
  it('退出码 0 ⇒ 通过，并带出计数行', () => {
    expect(interpretRunResult({ code: 0, output: OK_OUTPUT }))
      .toEqual({ kind: 'passed', tally: { passed: 15, failed: 0 } })
  })

  it('退出码 0 但计数行解析不到 ⇒ 仍是通过（退出码才是契约），tally 为 null', () => {
    expect(interpretRunResult({ code: 0, output: 'done\n' }))
      .toEqual({ kind: 'passed', tally: null })
  })

  it('非 0 且输出里有失败计数 ⇒ 违规，带计数与输出尾部', () => {
    // 输出要足够长，尾部才有东西可裁（否则「保守地不带开头」这条断言等于没写）
    const longOutput = `HEADER\n${'某条用例的日志\n'.repeat(30)}${FAIL_OUTPUT}`
    const verdict = interpretRunResult({ code: 1, output: longOutput })
    expect(verdict.kind).toBe('violation')
    if (verdict.kind !== 'violation')
      return
    expect(verdict.tally).toEqual({ passed: 14, failed: 1 })
    expect(verdict.tail).toContain('只缺 Referrer-Policy')
    expect(verdict.tail).toContain('通过 14，失败 1')
    // 尾部是**尾部**：最开头那行不该出现
    expect(verdict.tail).not.toContain('HEADER')
  })

  it('非 0 但没有计数行 ⇒ 违规，tally 为 null，尾部照带', () => {
    const verdict = interpretRunResult({ code: 2, output: 'bash: deploy/post-verify.test.sh: line 9: unexpected EOF\n' })
    expect(verdict.kind).toBe('violation')
    if (verdict.kind !== 'violation')
      return
    expect(verdict.tally).toBeNull()
    expect(verdict.tail).toContain('unexpected EOF')
  })

  it('脚本没跑起来（code 为 null）⇒ 前置条件未满足，而不是违规', () => {
    const verdict = interpretRunResult({ code: null, output: '找不到测试脚本：deploy/post-verify.test.sh' })
    expect(verdict.kind).toBe('precondition')
    if (verdict.kind !== 'precondition')
      return
    expect(verdict.detail).toContain('没跑起来')
    expect(verdict.detail).toContain('找不到测试脚本')
  })
})
