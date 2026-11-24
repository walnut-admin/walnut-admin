/**
 * 把 CI workflow 里**必须成立的约束**钉住（它们都来自实测事故，而且都属于「改回去也不报错」的那种）。
 *
 * 用测试而不是新门禁：测试本来就跑在 `pnpm test`（prepush 与 CI 都跑）里 ⇒ 零额外接线，
 * 而这里守的都是「某个 workflow 文件里的一行字」⇒ 测试是最省的正确工具。
 *
 * ## 构建类步骤只有一份逻辑（2026-11-24）
 *
 * 构建类步骤的逻辑住在 `ci/local-ci.ts` 的 `LOCAL_CI_STEPS` 里。`ci.yml` 的 build / openapi job
 * 要么跑同一条命令（镜像），要么经入口调用它（worker 冒烟）。两边各写一份的代价实测过：
 * worker 冒烟曾在 workflow 里是一段内联 bash，与 TS 实现是两套逻辑（轮询上限一处 40s、一处 180s）。
 * 下面的用例把 workflow 里的命令行与步骤表钉在一起 —— 只改一边就会红。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveCommandArgv } from '../../lib/commands.ts'
import { REPO_ROOT } from '../../lib/repo-root.ts'
import { LOCAL_CI_STEPS } from '../local-ci.ts'

const ci = readFileSync(join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8')

type Step = (typeof LOCAL_CI_STEPS)[number]

interface WorkflowStep {
  name: string
  /** 这一步 `- name:` 之后、下一步之前的所有行（含注释与空行） */
  lines: string[]
}

/** 按步骤名切开 workflow：只认「缩进 + `- name:`」这一种写法，够本文件用 */
function stepsOf(workflow: string): WorkflowStep[] {
  const steps: WorkflowStep[] = []
  for (const line of workflow.split('\n')) {
    const match = /^\s*- name: (.+)$/.exec(line)
    if (match) {
      steps.push({ name: match[1]!.trim(), lines: [] })
      continue
    }
    steps.at(-1)?.lines.push(line)
  }
  return steps
}

function stepNamed(name: string): WorkflowStep {
  const step = stepsOf(ci).find(item => item.name === name)
  expect(step, `ci.yml 里应当有「${name}」这一步`).toBeDefined()
  return step!
}

/** 单行 `run:` 的命令：去掉前导 `pnpm`，拆成词（内联脚本在这里直接判红） */
function runTokens(step: WorkflowStep): string[] {
  const runLine = step.lines.find(line => /^\s+run: (?! \|)/.test(line))
  expect(runLine, `「${step.name}」应当是单行 run，不内联脚本`).toBeDefined()
  const command = runLine!.replace(/^\s+run: /, '').trim()
  expect(command.startsWith('pnpm '), `「${step.name}」应当经 pnpm 跑`).toBe(true)
  return command.slice('pnpm '.length).split(/\s+/)
}

/** workflow 里一条 `run:` **真正执行**的 argv：入口形态（`walnut …`）按命令表展开，其余原样 */
function executedArgv(step: WorkflowStep): string[] {
  const tokens = runTokens(step)
  return tokens[0] === 'walnut' ? resolveCommandArgv(tokens.slice(1)) : tokens
}

function stepInTable(id: string): Step {
  const step = LOCAL_CI_STEPS.find(item => item.id === id)
  expect(step, `步骤表里应当有 ${id}`).toBeDefined()
  return step!
}

function argvOf(step: Step): readonly string[] {
  if (!('argv' in step))
    throw new Error(`${step.id} 不是 argv 形态的步骤`)
  return resolveCommandArgv(step.argv)
}

function runsInServerDir(step: WorkflowStep): boolean {
  return step.lines.some(line => /^\s+working-directory: apps\/server\s*$/.test(line))
}

describe('ci.yml —— 构建产物必须由**无缓存**的那次来担保', () => {
  it('build admin 带 `--force`（忽略 turbo 缓存）', () => {
    // 事故：v0.1.4 发版死在 Build admin（dts 被读到半写内容），而同一提交的 CI 因为命中 turbo
    // 缓存没真构建 ⇒ 绿。CI 必须自己真构建一次，否则这类 bug 只能在发版时暴露。
    const step = ci.split('\n').find(line => line.includes('turbo run build --filter=@walnut/admin'))
    expect(step, 'ci.yml 里应当有构建 admin 的那一步').toBeDefined()
    expect(step).toContain('--force')
  })

  it('构建之后仍然跑产物冒烟（不要为了省时间把它挪走/删掉）', () => {
    // 事故（V13）：构建绿 ≠ 跑得起来 —— 产物一执行就抛错、页面停在 splash，而 tsc/lint/build 全绿。
    const buildIndex = ci.indexOf('turbo run build --filter=@walnut/admin')
    const smokeIndex = ci.indexOf('pnpm walnut smoke:dist')
    expect(smokeIndex).toBeGreaterThan(buildIndex)
  })
})

describe('ci.yml × LOCAL_CI_STEPS —— 构建类步骤只有一份逻辑', () => {
  it('镜像步骤：workflow 里执行的 argv 就是步骤表那一步解析后的 argv（逐条，不是抽样）', () => {
    const mirrors = [
      ['Build server + shared packages', 'build-server'],
      ['Build admin', 'build-admin'],
      ['Smoke test the built admin bundle', 'smoke-dist'],
      ['Dist secret scan', 'lint-dist'],
    ] as const
    // 判据本身失效时也要红：一条都对不上说明 workflow 的步骤名改了，下面的循环会空转
    expect(mirrors.length).toBeGreaterThanOrEqual(4)
    for (const [name, id] of mirrors)
      expect(executedArgv(stepNamed(name)), `ci.yml 的「${name}」与步骤表 ${id} 不是同一条命令`).toEqual(argvOf(stepInTable(id)))
  })

  it('有意差异①：docs 构建在入口形态后面多一个 --cache-dir（turbo 的独立缓存目录），其余一致', () => {
    const executed = executedArgv(stepNamed('Docs build (dead-link check)'))
    const base = argvOf(stepInTable('build-docs'))
    expect(executed.slice(0, base.length)).toEqual(base)
    expect(executed.slice(base.length), '多出来的应当只有 --cache-dir 这一个').toHaveLength(1)
    expect(executed.at(-1)).toMatch(/^--cache-dir=/)
  })

  it('有意差异②：迁移在 apps/server 目录下直接跑包脚本（与步骤表的 -C apps/server 等价）', () => {
    const step = stepNamed('Apply migrations (fresh PG service)')
    expect(runTokens(step)).toEqual(['migration:run'])
    expect(runsInServerDir(step)).toBe(true)
    expect(argvOf(stepInTable('migration-run'))).toEqual(['-C', 'apps/server', 'migration:run'])
  })

  it('worker 冒烟经入口调步骤表的实现，--only 点名的那一步自带 run（逻辑在 TS 里）', () => {
    const executed = executedArgv(stepNamed('Worker smoke (cron registered)'))
    expect(executed).toEqual(['exec', 'walnut-ci-local', '--only=worker-smoke'])
    const smoke = stepInTable('worker-smoke')
    expect('run' in smoke, 'worker-smoke 应当是自带 run 的步骤').toBe(true)
  })

  it('冒烟之前先产出 dist：同条件下在 apps/server 下跑 pnpm build，且排在冒烟之前', () => {
    const build = stepNamed('Build server for worker smoke')
    const smoke = stepNamed('Worker smoke (cron registered)')
    expect(runTokens(build)).toEqual(['build'])
    expect(runsInServerDir(build)).toBe(true)
    const condition = (step: WorkflowStep): string | undefined => step.lines.find(line => /^\s+if: /.test(line))
    expect(condition(smoke), '冒烟那一步应当有条件（没有解密的 env 就不该跑）').toBeTruthy()
    expect(condition(build), '构建与冒烟的条件必须一致，否则会出现「构建没跑、冒烟去读旧产物」').toBe(condition(smoke))
    expect(ci.indexOf('- name: Build server for worker smoke')).toBeLessThan(ci.indexOf('- name: Worker smoke (cron registered)'))
  })

  it('内联 bash 版不许回潮（它和 TS 实现是两套逻辑）', () => {
    // 盯的是**实际起 worker、断言日志**的命令，不是文件里出现某个文件名 —— 注释里提到
    // `.data/tokensList.json` 是在说明判据，不是在实现它。worker 只能经入口那一步起，
    // 也不许有哪一步自己 grep 日志里的 cron 计数。
    expect(ci).not.toContain('node dist/apps/worker/src/main.js')
    expect(ci).not.toMatch(/grep -\S+ .*cron jobs:/)
    expect(ci).not.toMatch(/sha256sum/)
  })
})
