/**
 * 本地 CI（`src/ci/local-ci.ts`）的机械审计。
 *
 * 集中到一张表之后，新的失败模式是**表里写错**与**四态被折叠**，两者都不会当场报错：
 * 前者让某一步静默消失（脚本名打错 / 旗标丢了），后者让「没验过」被读成「验过了」。
 * 所以这里重点不是「跑得对」（那要 8~12 分钟、还得有库和浏览器，属于验收步骤），
 * 而是：**表本身站得住**、**参数解析不吞错**、**跳过与失败分得开**、**`.data` 的指纹判据真的有效**。
 */
import { mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ChildRunError } from '../../lib/child-run.ts'
import { PreconditionError, SKIPPED_EXIT_CODE, SkippedError, ViolationError } from '../../lib/errors.ts'
import { REPO_ROOT } from '../../lib/repo-root.ts'
import {
  failureToError,
  formatSnapshot,
  LOCAL_CI_STEPS,
  matchCronJobs,
  parseSelectionArgs,
  sameSnapshot,
  selectSteps,
  skippedHint,
  snapshotFile,
  stepStatusOf,
  WORKER_POLL_TIMEOUT_ENV,
  WORKER_POLL_TIMEOUT_MS,
  workerPollTimeoutMs,
} from '../local-ci.ts'

const rootManifest = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as {
  scripts?: Record<string, string>
}
const rootScripts = new Set(Object.keys(rootManifest.scripts ?? {}))

/** `argv[0]` 是 pnpm 自己的子命令（不是根脚本名）时的合法例外 —— 口径同 prepush.test.ts */
const PNPM_SUBCOMMANDS = new Set(['exec', 'change'])

describe('本地 CI 步骤表（LOCAL_CI_STEPS）—— 表本身', () => {
  it('id 无重复、都非空、且是 kebab（`--only=` / `--skip=` 要能原样写进命令行）', () => {
    const ids = LOCAL_CI_STEPS.map(step => step.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) {
      expect(id, 'id 不能为空').not.toBe('')
      expect(id, `${id} 不是 kebab 形态（拼错一个 id 会让单步调试跑到别的步骤上）`).toMatch(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)
    }
  })

  it('每个 pnpm 步骤的 argv 都能落到**真实存在**的根脚本 / pnpm 子命令上', () => {
    // 这条守卫就是「表里打错一个脚本名」的拦网：那种错会让整步静默消失
    const bad: string[] = []
    for (const step of LOCAL_CI_STEPS) {
      if (!('argv' in step))
        continue
      const head = step.argv[0]
      if (head === undefined) {
        bad.push(`${step.id}: argv 为空`)
        continue
      }
      if (PNPM_SUBCOMMANDS.has(head)) {
        if (step.argv.length < 2)
          bad.push(`${step.id}: pnpm 子命令不该只有一段`)
        continue
      }
      if (!rootScripts.has(head))
        bad.push(`${step.id}: 根 package.json 里没有脚本 ${head}`)
    }
    expect(bad).toEqual([])
  })

  it('每一步都有 why（空的就是「凭什么」缺失，失败时没东西可回放）', () => {
    for (const step of LOCAL_CI_STEPS) {
      expect(step.why.length, `${step.id} 的 why 太短，等于没写`).toBeGreaterThan(30)
      expect(step.label.length, `${step.id} 的 label 太短`).toBeGreaterThan(4)
    }
  })

  it('build-admin 必须带 --force（摘掉它 = 这一步退化成缓存回放，整个 ci:local 的理由就没了）', () => {
    const step = LOCAL_CI_STEPS.find(item => item.id === 'build-admin')
    expect(step, 'build-admin 这一步不见了 —— 那是 ci.yml:274-283 记着的真实事故').toBeTruthy()
    expect(step && 'argv' in step ? step.argv : []).toContain('--force')
  })

  it('worker-smoke 是**自定义**步骤（它不是任何 pnpm 脚本，别改成 argv 蒙过去）', () => {
    const step = LOCAL_CI_STEPS.find(item => item.id === 'worker-smoke')
    expect(step, 'worker-smoke 这一步不见了').toBeTruthy()
    expect(step && 'run' in step).toBe(true)
  })

  it('actionlint 经根脚本 lint:workflows 走（复用它现成的四态语义，别在这里另写探测）', () => {
    const step = LOCAL_CI_STEPS.find(item => item.id === 'actionlint')
    expect(step).toBeTruthy()
    expect(step && 'argv' in step ? step.argv[0] : null).toBe('lint:workflows')
  })

  it('依赖顺序：构建在冒烟之前、admin 构建在产物去密之前', () => {
    const at = (id: string): number => LOCAL_CI_STEPS.findIndex(step => step.id === id)
    expect(at('build-server')).toBeLessThan(at('worker-smoke'))
    expect(at('build-admin')).toBeLessThan(at('smoke-dist'))
    expect(at('smoke-dist')).toBeLessThan(at('lint-dist'))
    // 表里存在这几步（防止 at() 全返回 -1 时上面的断言变成空转）
    for (const id of ['build-server', 'build-admin', 'smoke-dist', 'lint-dist', 'worker-smoke'])
      expect(at(id), `${id} 不在表里`).toBeGreaterThanOrEqual(0)
  })
})

describe('参数解析：未知 id / 未知旗标必须报错，不许静默忽略', () => {
  it('只给 --only 时按表里的顺序挑，且不受命令行顺序影响', () => {
    const picked = selectSteps(LOCAL_CI_STEPS, ['--only=actionlint,build-server'])
    expect(picked.map(step => step.id)).toEqual(
      LOCAL_CI_STEPS.map(step => step.id).filter(id => id === 'build-server' || id === 'actionlint'),
    )
  })

  it('--skip 从全表里摘掉指定步骤', () => {
    const kept = selectSteps(LOCAL_CI_STEPS, ['--skip=worker-smoke'])
    expect(kept.map(step => step.id)).not.toContain('worker-smoke')
    expect(kept.length).toBe(LOCAL_CI_STEPS.length - 1)
  })

  it('--only 与 --skip 可以一起给（先挑后摘）', () => {
    const kept = selectSteps(LOCAL_CI_STEPS, ['--only=build-server,build-admin', '--skip=build-admin'])
    expect(kept.map(step => step.id)).toEqual(['build-server'])
  })

  it('未知 id 抛 PreconditionError（退出码 2），并把真实 id 全列出来', () => {
    expect(() => selectSteps(LOCAL_CI_STEPS, ['--only=buidl-server'])).toThrow(PreconditionError)
    try {
      selectSteps(LOCAL_CI_STEPS, ['--skip=nope'])
    }
    catch (error) {
      // 报错必须带上真实清单：否则拼错的人只能去翻代码（而「静默忽略」是更糟的另一极）
      expect((error as Error).message).toContain('build-server')
    }
  })

  it('不认识的旗标 / 缺等号 / 空 id 一律报错', () => {
    expect(() => parseSelectionArgs(['--only'])).toThrow(PreconditionError)
    expect(() => parseSelectionArgs(['--only='])).toThrow(PreconditionError)
    expect(() => parseSelectionArgs(['--only', 'a'])).toThrow(PreconditionError)
    expect(() => parseSelectionArgs(['--nope=1'])).toThrow(PreconditionError)
    expect(() => parseSelectionArgs(['build-server'])).toThrow(PreconditionError)
  })

  it('摘光了就报错（「一步都没跑」不许伪装成通过）', () => {
    expect(() => selectSteps(LOCAL_CI_STEPS, [`--skip=${LOCAL_CI_STEPS.map(step => step.id).join(',')}`]))
      .toThrow(PreconditionError)
  })

  it('不传参数时跑整张表', () => {
    expect(selectSteps(LOCAL_CI_STEPS, []).map(step => step.id))
      .toEqual(LOCAL_CI_STEPS.map(step => step.id))
  })

  it('解析确实生效（防止正则 / split 写错后所有用例空转）', () => {
    expect(parseSelectionArgs(['--only=a,b', '--skip=c'])).toEqual({ only: ['a', 'b'], skip: ['c'] })
    expect(parseSelectionArgs([])).toEqual({ only: null, skip: [] })
  })
})

describe('matchCronJobs —— 只认 cron jobs: N 这一个形态', () => {
  it('真的 worker 日志形态里能取到 N（带 Nest logger 前缀与任务名清单）', () => {
    const log = '[Nest] 1234  - 2026/11/05 14:27:49     LOG [WorkerBootstrap] '
      + 'worker process started (no HTTP listener); cron jobs: 3 [cleanup, rotate, sync]'
    expect(matchCronJobs(log)).toBe(3)
  })

  it('cron jobs: 0 取到的是 0 —— 调用方据此判红（不是「没匹配到」）', () => {
    expect(matchCronJobs('... cron jobs: 0')).toBe(0)
  })

  it('没有这一行时是 null（与 0 必须分得开：前者是没跑到，后者是挂上了 0 个）', () => {
    expect(matchCronJobs('[Nest] LOG [WorkerBootstrap] worker process started')).toBeNull()
    expect(matchCronJobs('')).toBeNull()
  })

  it('出现多次时取最后一次', () => {
    expect(matchCronJobs('cron jobs: 5 ... cron jobs: 0')).toBe(0)
  })

  it('两位数不会被截成一位', () => {
    expect(matchCronJobs('cron jobs: 12')).toBe(12)
  })
})

describe('snapshotFile / sameSnapshot —— .data 判据的三个指纹', () => {
  const dir = mkdtempSync(join(tmpdir(), 'walnut-local-ci-'))
  const file = join(dir, 'tokensList.json')

  it('同一个文件没被动过时三个指纹逐位相同', () => {
    writeFileSync(file, '{"deadbeef:0123456789abcdef":1}', 'utf8')
    utimesSync(file, new Date('2020-01-01T00:00:00Z'), new Date('2020-01-01T00:00:00Z'))
    const before = snapshotFile(file)
    const after = snapshotFile(file)
    expect(sameSnapshot(before, after)).toBe(true)
    // 不写死种子内容的字节数（那是会腐烂的计数）：判据是「指纹描述里带的是真实 size」
    expect(before.size).toBeGreaterThan(10)
    expect(before.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(formatSnapshot(before)).toContain(`size=${before.size}`)
  })

  it('内容变了（cap.js 的 cleanup() 把过期项删掉写回）三个值全变', () => {
    writeFileSync(file, '{}', 'utf8')
    const before = snapshotFile(file)
    writeFileSync(file, '{"x:1":1}', 'utf8')
    const after = snapshotFile(file)
    expect(sameSnapshot(before, after)).toBe(false)
    expect(after.sha256).not.toBe(before.sha256)
    expect(after.size).not.toBe(before.size)
  })

  it('内容一样但被 touch 过 ⇒ mtime 变，照样判红（「写了但写回同一份」也是触碰）', () => {
    writeFileSync(file, '{"deadbeef:0123456789abcdef":1}', 'utf8')
    const before = snapshotFile(file)
    utimesSync(file, new Date('2021-06-01T00:00:00Z'), new Date('2021-06-01T00:00:00Z'))
    const after = snapshotFile(file)
    expect(after.sha256).toBe(before.sha256)
    expect(after.size).toBe(before.size)
    expect(sameSnapshot(before, after), 'mtime 变了却没判红 —— CAP cleanup 的 touch 会被放过').toBe(false)
  })

  it('清理临时目录', () => {
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('轮询上限：依据实测下界留 >=2 倍余量，且可被环境变量覆盖', () => {
  /** 完整跑实测的下界（页缓存被前几步构建冲掉之后）：63.3s。写在这里是为了让「2 倍」可机械核对 */
  const MEASURED_LOWER_BOUND_MS = 63_300

  it('缺省上限 >= 2 倍实测下界（90s 那种 1.4x 余量在冷缓存机器上就是随机红）', () => {
    expect(WORKER_POLL_TIMEOUT_MS).toBeGreaterThanOrEqual(2 * MEASURED_LOWER_BOUND_MS)
    expect(workerPollTimeoutMs({})).toBe(WORKER_POLL_TIMEOUT_MS)
  })

  it('环境变量能按这台机器调（毫秒）', () => {
    expect(workerPollTimeoutMs({ [WORKER_POLL_TIMEOUT_ENV]: '240000' })).toBe(240_000)
  })

  it('非法 / 非正数一律当没给：轮询没有上限就等于永久挂着', () => {
    for (const value of ['', 'abc', '0', '-5']) {
      expect(workerPollTimeoutMs({ [WORKER_POLL_TIMEOUT_ENV]: value }), `${value} 不该被当成上限`).toBe(WORKER_POLL_TIMEOUT_MS)
    }
  })
})

describe('跳过时的提示：不许让人以为是自己跑挂了', () => {
  it('汇总行下面紧跟一行装法指引（指向文档，不在这里抄命令）', () => {
    const lines = skippedHint('未验证的段：actionlint（本机环境缺失）').split('\n')
    expect(lines[0]).toBe('未验证的段：actionlint（本机环境缺失）')
    expect(lines[1]).toContain('actionlint')
    expect(lines[1]).toContain('本地复刻 CI')
  })
})

describe('四态不折叠', () => {
  it('跳过：SkippedError 与子进程退出码 3 都算跳过（不是通过）', () => {
    expect(stepStatusOf(new SkippedError('没装 actionlint'))).toBe('skipped')
    expect(stepStatusOf(new ChildRunError('synthetic', SKIPPED_EXIT_CODE))).toBe('skipped')
  })

  it('其余一律算失败（含 2 / 超时的 2 / 裸 Error）', () => {
    expect(stepStatusOf(new ViolationError('构建失败'))).toBe('failed')
    expect(stepStatusOf(new PreconditionError('没有产物'))).toBe('failed')
    expect(stepStatusOf(new ChildRunError('synthetic', 1))).toBe('failed')
    expect(stepStatusOf(new ChildRunError('timeout', 2))).toBe('failed')
    expect(stepStatusOf(new Error('boom'))).toBe('failed')
  })

  it('失败的四态码要保住：2 是「先修环境」，1 是「改代码」', () => {
    expect(failureToError(new PreconditionError('没有产物'))).toBeInstanceOf(PreconditionError)
    expect(failureToError(new ViolationError('红了'))).toBeInstanceOf(ViolationError)
    // 子进程的 exitCode 要**翻译**：2 = 前置条件（如 smoke:dist 没有 dist），其余 = 违规
    expect(failureToError(new ChildRunError('synthetic', 2))).toBeInstanceOf(PreconditionError)
    expect(failureToError(new ChildRunError('synthetic', 1))).toBeInstanceOf(ViolationError)
    expect(failureToError('裸字符串')).toBeInstanceOf(ViolationError)
  })
})
