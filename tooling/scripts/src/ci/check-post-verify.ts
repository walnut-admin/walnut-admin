/**
 * `deploy/post-verify.test.sh` 的自动入口：把部署后验证脚本的行为测试接成门禁。
 *
 * 防的失败：`deploy/post-verify.sh` 是**部署之后**唯一证明「服务真的在工作」的那一步
 * （容器状态与重启次数、镜像 tag、后端日志、5xx、端到端、安全响应头、`/health` 挡板）。
 * 它自己也是脚本 —— 改判据时写错一行，最直接的后果是**该失败的分支不再失败**，
 * 而这件事只有部署那一刻才会暴露：镜像已经上线，验证却报通过。
 * `deploy/post-verify.test.sh` 用假的 `docker` / `curl` 逐条覆盖那些失败分支，
 * 但它此前没有任何自动入口，只能手工 `bash`。
 *
 * 接线口径：
 * - 先探测 bash（照 `check-workflow-shell.ts` 的先例）。找不到 bash ⇒ `SkippedError`
 *   （退出码 3，**跳过不等于通过**）；CI 的 ubuntu runner 自带 bash，所以那里一定是真跑。
 * - 用 `runSync`（argv 直传、不经 shell）在**仓库根**跑测试脚本 —— 脚本按自身位置解析
 *   `post-verify.sh` 的路径，cwd 只影响它创建临时目录的位置。
 * - 「退出码 + 输出」到结论的映射是纯函数 {@link interpretRunResult}，可以脱离子进程单测；
 *   退出码 0 记通过（结论行带出脚本末尾的「通过 N，失败 M」），非 0 记违规（带出输出尾部），
 *   脚本没跑起来记前置条件未满足。
 *
 * 本机实测（2026-11-23，Windows + Git Bash）：直接 `bash deploy/post-verify.test.sh` 时 15 条
 * 用例全部通过、约 90 秒；经本门禁（Node 再起 MSYS bash）约 3 分钟 —— 差别来自 Windows 上
 * 每个假 `docker` / `curl` 子进程的启动开销。CI 的 ubuntu runner 上没有这层开销。
 *
 * ## 所以它有一条「适用范围」
 *
 * 每次推送都花 3 分钟去测一个**这次根本没改**的部署脚本，是纯成本：推送前门禁的定位是
 * 「静态门禁，快」，而这套测试只在它测的东西变了的时候才有新信息。所以本地先看改动面
 * （相对上游，见 {@link judgeApplicability}）：没改相关文件就打一行「不适用」正常返回；
 * 改了、或判不出改动面、或在 CI 上，照常真跑。这是「不适用」而不是「跳过」——
 * 后者是「该验而没验」（退出码 3），前者是「这一段没有要验的东西」。
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

import { runSync } from '../lib/child-run.ts'
import { PreconditionError, SkippedError, ViolationError } from '../lib/errors.ts'
import { changedFilesSinceUpstream, upstreamRef } from '../lib/git.ts'
import { err, line, out } from '../lib/log.ts'
import { REPO_ROOT } from '../lib/repo-root.ts'
import { findBash } from './check-workflow-shell.ts'

/** 被接线的行为测试脚本（相对仓库根；脚本自己解析同目录的 `post-verify.sh`） */
export const POST_VERIFY_TEST_SCRIPT = 'deploy/post-verify.test.sh'

/**
 * 会改变这套行为测试结论的路径前缀（相对仓库根）。**不在这个清单里的改动不需要重跑它**：
 * 测试用假的 `docker` / `curl`，只读这两个脚本和入口 nginx 的安全头配置。
 * 清单里带上本文件自己：改了门禁就得让门禁跑一遍。
 */
export const RELEVANT_PATH_PREFIXES: readonly string[] = [
  'deploy/post-verify.sh',
  'deploy/post-verify.test.sh',
  'deploy/nginx/',
  'tooling/scripts/src/ci/check-post-verify.ts',
]

/** 适用范围的两态 */
export type Applicability =
  | { kind: 'run'; reason: string }
  | { kind: 'not-applicable'; upstream: string; changedCount: number }

/**
 * 这一段适不适用（纯函数，不碰 git）。
 *
 * 三个「照常真跑」的方向，任何一个判不准都倒向真跑：
 * - CI 上每次都真跑（那边没有这层进程开销，也不该靠改动面去省）；
 * - 判不出改动面（没有上游、或 git 读不到）⇒ 真跑：不知道有没有改就按改了处理；
 * - 改了相关文件 ⇒ 真跑。
 * 只有「拿得到上游、算得出改动面、且里面没有相关文件」才是不适用。
 */
export function judgeApplicability(input: {
  isCi: boolean
  upstream: string | null
  changed: readonly string[] | null
}): Applicability {
  if (input.isCi) return { kind: 'run', reason: 'CI 上每次都真跑' }
  if (input.upstream === null || input.changed === null)
    return { kind: 'run', reason: '判不出改动面（没有上游或 git 读不到）' }
  const touched = input.changed.some((file) =>
    RELEVANT_PATH_PREFIXES.some((prefix) => file.startsWith(prefix)),
  )
  if (touched) return { kind: 'run', reason: '相对上游改了相关文件' }
  return { kind: 'not-applicable', upstream: input.upstream, changedCount: input.changed.length }
}

/** 违规时带出的输出尾行数：够看到失败的用例名与它回放的那段日志 */
export const TAIL_LINES = 20

/** 脚本末尾打印的计数行：`通过 15，失败 0`（中文逗号；同时认半角逗号） */
const TALLY_RE = /通过\s*(\d+)\s*[，,]\s*失败\s*(\d+)/g

/** 脚本末尾的用例计数 */
export interface PostVerifyTally {
  passed: number
  failed: number
}

/** 一次测试脚本的执行结果（`code === null` = 脚本压根没跑起来） */
export interface PostVerifyRunResult {
  /** 子进程退出码；`null` = 没跑起来（测试脚本不存在 / bash 起不来） */
  code: number | null
  /** stdout 与 stderr 合并后的原文 */
  output: string
}

/** 门禁结论（三态；通过 / 违规 / 前置条件未满足） */
export type PostVerifyVerdict =
  | { kind: 'passed'; tally: PostVerifyTally | null }
  | { kind: 'violation'; tally: PostVerifyTally | null; tail: string }
  | { kind: 'precondition'; detail: string }

/**
 * 解析脚本末尾的「通过 N，失败 M」。
 *
 * 取**最后一个**匹配：脚本失败时会把某个用例的日志回放出来，若将来那段日志里恰好出现
 * 同形状的文字，取最后一个仍是脚本自己的汇总行。解析不到返回 `null`（不猜数字）。
 */
export function parseTally(output: string): PostVerifyTally | null {
  const matches = [...output.matchAll(TALLY_RE)]
  const last = matches.at(-1)
  if (last === undefined) return null
  return { passed: Number(last[1]), failed: Number(last[2]) }
}

/** 输出尾部（去掉空行；`maxLines <= 0` 时原样全留） */
export function tailOf(output: string, maxLines: number = TAIL_LINES): string {
  const lines = output
    .split('\n')
    .map((text) => text.replace(/\r$/, ''))
    .filter((text) => text.trim() !== '')
  const tail = maxLines > 0 ? lines.slice(-maxLines) : lines
  return tail.join('\n')
}

/**
 * 「退出码 + 输出」到结论的映射（纯函数，不碰 IO）。
 *
 * 判据刻意只有三条：
 * - `code === null` ⇒ 前置条件未满足（没有可判定的结果，先修环境）；
 * - `code === 0` ⇒ 通过（计数行只是结论行的一部分，解析不到也不改判定 —— 退出码才是契约）；
 * - 其余 ⇒ 违规（用例真的有失败，改 `post-verify.sh` 或它的用例）。
 */
export function interpretRunResult(result: PostVerifyRunResult): PostVerifyVerdict {
  if (result.code === null) {
    return {
      kind: 'precondition',
      detail: `${POST_VERIFY_TEST_SCRIPT} 没跑起来（找不到文件或 bash 起不来）。输出尾部：\n${tailOf(result.output) || '（无输出）'}`,
    }
  }
  const tally = parseTally(result.output)
  if (result.code === 0) return { kind: 'passed', tally }
  return { kind: 'violation', tally, tail: tailOf(result.output) }
}

/** 违规结论行（计数行解析得到时带上通过 / 失败的条数） */
function violationMessage(
  verdict: Extract<PostVerifyVerdict, { kind: 'violation' }>,
  code: number | null,
): string {
  if (verdict.tally !== null)
    return `${POST_VERIFY_TEST_SCRIPT} 有 ${verdict.tally.failed} 条用例失败（通过 ${verdict.tally.passed}）`
  return `${POST_VERIFY_TEST_SCRIPT} 以退出码 ${code ?? '未知'} 结束（没解析出「通过 N，失败 M」计数行）`
}

/** 门禁主体 */
export function main(): void {
  // 先看适用范围（纯 git 查询，毫秒级）：不适用就不必去找 bash、更不必起那几分钟的子进程
  const applicability = judgeApplicability({
    isCi: Boolean(process.env.CI),
    upstream: upstreamRef(),
    changed: changedFilesSinceUpstream(),
  })
  if (applicability.kind === 'not-applicable') {
    out(
      `${POST_VERIFY_TEST_SCRIPT}：相对上游 ${applicability.upstream} 没有改动相关文件（` +
        `共 ${applicability.changedCount} 个改动文件），本段不适用。改了 deploy/post-verify.sh、` +
        '它的行为测试或入口 nginx 配置时才需要重跑；CI 上每次都真跑。',
    )
    return
  }
  out(`适用：${applicability.reason}`)

  const bash = findBash()
  if (bash === null) {
    throw new SkippedError(
      `没找到 bash：${POST_VERIFY_TEST_SCRIPT} 本机**未验证**（跳过不等于通过）。` +
        '设 BASH_PATH 指向 bash 即可启用；CI 的 ubuntu runner 自带 /bin/bash。',
    )
  }

  const script = join(REPO_ROOT, POST_VERIFY_TEST_SCRIPT)
  let run: PostVerifyRunResult
  if (existsSync(script)) {
    const result = runSync(bash, [POST_VERIFY_TEST_SCRIPT], { cwd: REPO_ROOT })
    run = { code: result.code, output: `${result.stdout}${result.stderr}` }
  } else {
    // 只在这里表达「没跑起来」：runSync 把 spawn 失败压成退出码 1，分不出「脚本报错」与
    // 「脚本不存在」，而那两种的下一步动作不同（修代码 vs 修路径）。
    run = { code: null, output: `找不到测试脚本：${script}` }
  }

  const verdict = interpretRunResult(run)

  if (verdict.kind === 'precondition') throw new PreconditionError(verdict.detail)

  if (verdict.kind === 'violation') {
    err('输出尾部（完整输出请手工跑一遍）：')
    err(verdict.tail)
    throw new ViolationError(violationMessage(verdict, run.code))
  }

  line(
    'ok',
    verdict.tally === null
      ? `${POST_VERIFY_TEST_SCRIPT}：退出码 0，但没解析出「通过 N，失败 M」计数行（脚本输出格式变了？）`
      : `${POST_VERIFY_TEST_SCRIPT}：通过 ${verdict.tally.passed}，失败 ${verdict.tally.failed}（部署后验证脚本的各条失败分支）`,
  )
  out(
    '  提醒：这一段只证明 post-verify.sh 的判据还会红；「头真的发出去了」仍由它在每次部署后核实。',
  )
}
