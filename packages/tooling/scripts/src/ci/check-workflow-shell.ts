import { execFileSync } from 'node:child_process'
/**
 * 工作流里 **shell 块**的语法门禁：把 `.github/workflows/*.yml` 里所有 `run:` 与
 * `with.script:`（appleboy/ssh-action 那种）按 YAML 缩进剥离出来，逐块过 `bash -n`。
 *
 * ## 为什么需要它（两次实测踩到的同一类问题）
 *
 * workflow 里的 shell 是**字符串里的 shell** —— `actionlint` 只看 YAML 结构与 `${{ }}` 表达式，
 * **完全看不见 shell 语法**：
 *
 * - `deploy.yml` 的注入步骤曾有三层嵌套引号（宿主 `sh` → `docker compose exec` → 容器 `sh`），
 *   在服务器上手工跑没事、放进 workflow 必炸，而报错又被 `| tail -2` 吃掉 ⇒ 只看到"这一步红了"；
 * - 改成带引号 heredoc（`<<'INNER'`）之后，heredoc 的缩进与终止符是否正确**同样只有 shell 才认**。
 *
 * 这两次都只能靠发版撞出来。这道门禁把它们提前到推送前：语法错在这里就红。
 *
 * ## 两个必须处理的细节
 *
 * ① **GitHub 表达式在 bash 里非法**：`${{ secrets.X }}` 会让 bash 报 `bad substitution` ⇒
 *    先把 `${{ … }}` 换成占位符再验（占位符只是个裸词，语法上合法）；
 * ② **本机可能没有 bash**（Windows 开发者）⇒ 明确打一行 SKIP 并按通过退出（与 `smoke:dist`
 *    同规矩：跳过**不等于**通过，只是不在没有条件的机器上假装红）。CI 的 ubuntu runner 自带 bash，
 *    所以这道闸在 CI 上是真跑的。
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { parse as parseYaml } from 'yaml'
import { PreconditionError, ViolationError } from '../lib/errors.ts'
import { line, out } from '../lib/log.ts'
import { REPO_ROOT } from '../lib/repo-root.ts'

/** 工作流目录（相对仓库根） */
export const WORKFLOW_DIR = '.github/workflows'

/** 一段被抽出来的 shell */
export interface ShellBlock {
  /** 出处：`<文件>:<步骤名或键路径>` */
  where: string
  /** shell 文本（已剥离 YAML 缩进） */
  script: string
}

/**
 * 把 `${{ … }}` 换成占位符。
 *
 * 不这么做的话，任何用到 secrets / matrix 的 workflow 都会在 bash 里报 `bad substitution`
 * —— 那是**表达式**的语法，不是 shell 的语法，不属于这道门禁该管的事。
 */
export function neutralizeExpressions(script: string): string {
  return script.replace(/\$\{\{[\s\S]*?\}\}/g, '__GH_EXPR__')
}

/** 递归收集一个 YAML 节点里的 shell 块（`run:` 与 `with.script:`） */
function walk(node: unknown, path: string, into: ShellBlock[]): void {
  if (node === null || typeof node !== 'object')
    return
  if (Array.isArray(node)) {
    node.forEach((item, index) => walk(item, `${path}[${index}]`, into))
    return
  }
  const record = node as Record<string, unknown>
  const stepName = typeof record.name === 'string' ? record.name : null
  const label = stepName === null ? path : `${path} · ${stepName}`
  for (const [key, value] of Object.entries(record)) {
    if (key === 'run' && typeof value === 'string')
      into.push({ where: `${label} · run`, script: value })
    if (key === 'script' && typeof value === 'string')
      into.push({ where: `${label} · script`, script: value })
    // `with: { script: … }`（appleboy/ssh-action 的用法）走这一支
    walk(value, `${label} · ${key}`, into)
  }
}

/** 从一个 workflow 的文本里抽出所有 shell 块（纯函数：给用例喂字符串用） */
export function collectShellBlocks(text: string, file = 'workflow.yml'): ShellBlock[] {
  const doc: unknown = parseYaml(text)
  const into: ShellBlock[] = []
  walk(doc, file, into)
  // YAML 块标量已把公共缩进剥掉；这里只去掉首尾空白行，保留内部结构
  return into.map(block => ({ where: block.where, script: block.script.replace(/^\n+|\s+$/g, '') }))
}

/** 找一个可用的 bash；`exists` 可注入（平台判定用例外，见仓库里那几条教训） */
export function findBash(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  exists: (path: string) => boolean = existsSync,
): string | null {
  const candidates: string[] = []
  if (env.BASH_PATH !== undefined && env.BASH_PATH !== '')
    candidates.push(env.BASH_PATH)
  if (platform === 'win32')
    candidates.push('C:/Program Files/Git/bin/bash.exe', 'C:/Program Files/Git/usr/bin/bash.exe')
  else
    candidates.push('/bin/bash', '/usr/bin/bash', '/usr/local/bin/bash')
  return candidates.find(candidate => exists(candidate)) ?? null
}

/** 语法检查一段 shell：返回 bash 的报错文本（`null` = 通过） */
export function checkWithBash(bash: string, script: string): string | null {
  const dir = mkdtempSync(join(tmpdir(), 'walnut-wf-shell-'))
  const file = join(dir, 'block.sh')
  try {
    writeFileSync(file, neutralizeExpressions(script), 'utf8')
    try {
      execFileSync(bash, ['-n', file], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
      return null
    }
    catch (error) {
      const stderr = (error as { stderr?: string }).stderr ?? String(error)
      return stderr.trim()
    }
  }
  finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/** 列工作流文件（相对仓库根，稳定序） */
export function listWorkflows(root: string = REPO_ROOT): string[] {
  const dir = join(root, WORKFLOW_DIR)
  if (!existsSync(dir))
    return []
  return readdirSync(dir)
    .filter(name => name.endsWith('.yml') || name.endsWith('.yaml'))
    .sort()
    .map(name => `${WORKFLOW_DIR}/${name}`)
}

/** 门禁主体 */
export async function main(): Promise<void> {
  const bash = findBash()
  if (bash === null) {
    line('skipped', '没找到 bash，跳过 workflow shell 语法检查（设 BASH_PATH 指向 bash 即可启用）')
    out('  提示：CI 的 ubuntu runner 自带 /bin/bash。跳过**不等于**通过。')
    return
  }

  const files = listWorkflows()
  if (files.length === 0)
    throw new PreconditionError(`没有找到工作流文件（${WORKFLOW_DIR}/*.yml）`)

  const failures: string[] = []
  let checked = 0
  for (const file of files) {
    const blocks = collectShellBlocks(readFileSync(join(REPO_ROOT, file), 'utf8'), file)
    for (const block of blocks) {
      checked += 1
      const error = checkWithBash(bash, block.script)
      if (error !== null)
        failures.push(`${block.where}\n${error.split('\n').map(l => `    ${l}`).join('\n')}`)
    }
  }

  if (failures.length > 0)
    throw new ViolationError(`workflow 里有 ${failures.length} 段 shell 语法错（bash -n 判定）：\n\n${failures.join('\n\n')}`)

  out(`workflow shell 语法：${files.length} 个文件、${checked} 段 shell 块，bash -n 全部通过`)
}
