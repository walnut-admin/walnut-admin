/**
 * 后端 stage 进程的 **webServer 包装脚本**（Playwright 的 `webServer.command` 指向它）。
 *
 * 之前 `webServer` 直接跑 `pnpm run start:stage` 且 `stdout: 'ignore'` —— 后端启动日志、
 * 请求日志、异常栈基本看不到，排障只能靠手工捕获的 `.e2e/backend-*.log`。现在它做三件事：
 *
 * 1. spawn `pnpm run start:stage`（cwd = `apps/server`，后端必须从那里跑 —— ConfigModule 用
 *    `process.cwd()` 定位 env）；
 * 2. 把 stdout / stderr **同时** tee 到控制台（即本进程的同名流，Playwright 再转给 reporter）
 *    与 `test-results/backend.log`；
 * 3. **写入之前脱敏**（`lib/redact.ts`）：Authorization / Cookie / x-sign / CAPJS_TOKEN /
 *    DEVICE_ID 等的实际值换成 `<redacted>`。控制台那一份也脱敏 —— CI 的 job 日志同样是
 *    「会被人复制出去」的位置。
 *
 * 为什么必须按**整行**处理：脱敏规则的值不跨换行，半个 token 落在两次 chunk 里就匹配不到。
 * 所以这里做行缓冲，只把「以换行结尾的完整行」送进脱敏函数。
 *
 * 为什么必须包一层而不是直接用 shell 重定向：`tee` 在 Windows runner 上不可用（Git Bash 之外
 * 没有 tee），而仓库对 `.ts` 的约定正是「Node 24 原生类型剥离执行」—— 一个跨平台的 Node 包装
 * 比平台分支的 shell 命令更可控。
 *
 * 生命周期：Playwright 结束时按进程树杀（Windows `taskkill /T /F`、POSIX 杀进程组），
 * 本进程与后端一起结束；子进程自己退出时把最后一个不完整的行 flush 掉，不吞日志。
 */
import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { redactText } from '../lib/redact.ts'
import { SERVER_ROOT, TEST_RESULTS_DIR } from './env.ts'
import { resolvePnpm } from './pnpm.ts'
import { STACK_PROFILE } from './stack-profiles.ts'

const BACKEND_LOG_FILE = path.join(TEST_RESULTS_DIR, 'backend.log')
/** 落盘上限：正常一轮几 MB；真到 64 MB 说明日志已经失控，继续写只会占满 runner 磁盘 */
const MAX_LOG_BYTES = 64 * 1024 * 1024

let writtenBytes = 0
let logDisabled = false
let logWarned = false

/** 写日志文件（每次写入前确保目录在：Playwright 会在 webServer 之前清空 outputDir） */
function appendToLog(text: string): void {
  if (logDisabled) {
    return
  }
  if (writtenBytes + text.length > MAX_LOG_BYTES) {
    // 先把收尾说明写进去再关闸（顺序反了的话说明本身会被 `logDisabled` 挡掉）
    logDisabled = true
    try {
      mkdirSync(TEST_RESULTS_DIR, { recursive: true })
      appendFileSync(BACKEND_LOG_FILE, `\n[e2e/backend] 日志超过 ${MAX_LOG_BYTES} 字节上限，后续输出只进控制台（避免占满磁盘）\n`, 'utf8')
    }
    catch {
      // 写不进去也没关系：控制台那份仍在
    }
    return
  }
  try {
    mkdirSync(TEST_RESULTS_DIR, { recursive: true })
    appendFileSync(BACKEND_LOG_FILE, text, 'utf8')
    writtenBytes += text.length
  }
  catch (error) {
    if (!logWarned) {
      logWarned = true
      console.error(`[e2e/backend] 写 ${BACKEND_LOG_FILE} 失败（后续不再重复）：${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

/** 一段文本 → 控制台 + 日志文件（两处都是脱敏后的版本） */
function emit(text: string, target: NodeJS.WriteStream): void {
  const redacted = redactText(text)
  appendToLog(redacted)
  try {
    target.write(redacted)
  }
  catch {
    // Playwright 收掉管道后（本进程正在退出）写控制台可能 EPIPE —— 日志文件那份仍已写出
  }
}

/** 行缓冲：只把完整行送进脱敏，最后一段在流结束时 flush */
function teeLines(stream: NodeJS.ReadableStream, target: NodeJS.WriteStream): void {
  stream.setEncoding('utf8')
  let buffer = ''
  stream.on('data', (chunk: string) => {
    buffer += chunk
    const lastNewline = buffer.lastIndexOf('\n')
    if (lastNewline === -1) {
      return
    }
    const ready = buffer.slice(0, lastNewline + 1)
    buffer = buffer.slice(lastNewline + 1)
    emit(ready, target)
  })
  stream.on('end', () => {
    if (buffer !== '') {
      emit(buffer, target)
      buffer = ''
    }
  })
}

function main(): void {
  // 管道被上游收掉时（Playwright 正在退出）写控制台会 EPIPE —— 别让它变成未捕获异常
  process.stdout.on('error', () => {})
  process.stderr.on('error', () => {})

  mkdirSync(TEST_RESULTS_DIR, { recursive: true })
  appendToLog(`[e2e/backend] ${new Date().toISOString()} start: pnpm run start:stage（profile=${STACK_PROFILE.name}，库=${STACK_PROFILE.database}，cwd=${SERVER_ROOT}）\n`)

  const { command, prefixArgs, shell } = resolvePnpm()
  // `--silent` 只压 pnpm 自己的横幅（`> @walnut/server start:stage`）与收尾时的
  // `[ELIFECYCLE] Command failed` 噪音（Playwright 杀进程树时 pnpm 会这么报，容易被误读成
  // 「后端在跑的时候挂了」）。后端 stdout/stderr 不受影响。
  const child = spawn(command, [...prefixArgs, '--silent', 'run', 'start:stage'], {
    cwd: SERVER_ROOT,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell,
    windowsHide: true,
  })

  if (child.stdout !== null) {
    child.stdout.on('error', () => {})
    teeLines(child.stdout, process.stdout)
  }
  if (child.stderr !== null) {
    child.stderr.on('error', () => {})
    teeLines(child.stderr, process.stderr)
  }

  child.on('error', (error) => {
    appendToLog(`[e2e/backend] spawn 失败：${error.message}\n`)
    console.error(`[e2e/backend] spawn 失败：${error.message}`)
    process.exit(1)
  })

  child.on('exit', (code, signal) => {
    const detail = signal === null ? `exit ${code ?? 1}` : `signal ${signal}`
    appendToLog(`[e2e/backend] child ${detail}（${new Date().toISOString()}）\n`)
    // 退出码原样上报：Playwright 会把非零视作 webServer 起不来，失败信息里带上它。
    // 用 exitCode 而不是 process.exit()：让 stdout 的待写内容先 flush（日志被截尾比丢一行更难查）。
    // 信号退出的 status 是 null —— 按失败 1 处理（同 scripts/pnpm.ts 的口径）。
    process.exitCode = code ?? 1
  })
}

try {
  main()
}
catch (error) {
  console.error(`[e2e/backend] 失败：${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
