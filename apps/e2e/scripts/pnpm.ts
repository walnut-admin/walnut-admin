/**
 * 经 pnpm 跑子进程（migration / seed / playwright test）。
 *
 * `npm_execpath` 的形态**因安装方式而异**：pnpm 自己的 bin 可能是**可执行文件**
 * （本机 corepack/nvm 布局里是 `pnpm.exe`），也可能是 `.cjs`。把 `.exe` 交给 `node` 去跑
 * 会得到「Command failed」而没有任何有用信息（实测：`node pnpm.exe run migration:run`
 * 直接非零退出），所以按扩展名分三路：js 用 node、exe 直接执行、其余（.cmd/.bat/无扩展名）
 * 交给 shell。手工 `node scripts/*.ts` 时没有 npm_execpath，走最后的 shell 路。
 *
 * 所有 spawn 都带 `windowsHide: true`：本机**禁止弹可见窗口**（WSL 侧天然无窗口，
 * Windows 侧任何子进程都必须隐藏）。
 */
import { execFileSync, spawnSync } from 'node:child_process'
import process from 'node:process'
import { E2eChildFailure } from './failure.ts'

interface PnpmInvocation {
  command: string
  prefixArgs: string[]
  shell: boolean
}

/**
 * 解析「怎么调 pnpm」。导出的唯一外部消费者是 `scripts/start-backend.ts` —— 它要**流式**
 * 读取后端输出（tee + 脱敏），不能用下面的同步入口（`stdio: 'inherit'` 拿不到管道）。
 */
export function resolvePnpm(): PnpmInvocation {
  const execpath = process.env.npm_execpath

  if (execpath !== undefined && /\.[cm]?js$/i.test(execpath)) {
    return { command: process.execPath, prefixArgs: [execpath], shell: false }
  }

  if (execpath !== undefined && /\.exe$/i.test(execpath)) {
    return { command: execpath, prefixArgs: [], shell: false }
  }

  return { command: 'pnpm', prefixArgs: [], shell: true }
}

/**
 * 跑一条 pnpm 命令并等它结束。非零退出折成 {@link E2eChildFailure}
 * （`status 2` 透传，其余 1 —— 见 scripts/failure.ts 的退出码口径）。
 */
export function runPnpm(args: readonly string[], cwd: string, env: NodeJS.ProcessEnv, label = args.join(' ')): void {
  const { command, prefixArgs, shell } = resolvePnpm()
  try {
    execFileSync(command, [...prefixArgs, ...args], { cwd, env, stdio: 'inherit', shell, windowsHide: true })
  }
  catch (error) {
    const status = (error as { status?: number | null }).status
    if (typeof status === 'number') {
      throw new E2eChildFailure(label, status)
    }
    throw error
  }
}

/**
 * 跑一条 pnpm 命令，**原样返回它的退出码**（给 Playwright 用：它的退出码是契约，
 * 不参与 prepare 那边的 2 / 1 折算）。
 */
export function spawnPnpm(args: readonly string[], cwd: string, env: NodeJS.ProcessEnv): number {
  const { command, prefixArgs, shell } = resolvePnpm()
  const result = spawnSync(command, [...prefixArgs, ...args], {
    cwd,
    env,
    stdio: 'inherit',
    shell,
    windowsHide: true,
  })

  if (result.error !== undefined && result.error !== null) {
    throw result.error
  }
  // 被信号杀掉时 status 是 null —— 视同失败 1（不是「环境没准备好」）
  return result.status ?? 1
}
