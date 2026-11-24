/**
 * 终端交互的**通用**封装：一问一答与不回显输入。
 *
 * 为什么单独成模块：交互散在脚本里会有两处漂移 ——「非 TTY 时返回空串」这条约定（让调用方决定是缺
 * flag 还是取默认值）与「不回显」的实现细节（raw 模式逐键读，Windows 终端上比 readline 静音方案稳）。
 * 失败口径：**非 TTY 一律立刻返回空串，不抛错、不等待** —— 缺什么由调用方报出来并决定退出码。
 * 这条契约是硬的：CI / pre-push / `| tee` 里的脚本一旦停在提示上，表现出来的是「卡死」而不是「失败」，
 * **绝不能让非交互调用方挂在提示上**。
 * 不做什么：不解释输入的含义、不打印错误、不决定退出码（零业务语义）。
 */

import type { Key } from 'node:readline'
import process from 'node:process'
import readline from 'node:readline'

export function isInteractive(): boolean {
  // 只看 stdin：stdout 被 `| tee` / 包装器接管时，人还是在键盘前，不该退化成「非交互」
  return Boolean(process.stdin.isTTY)
}

/** 一问一答（非 TTY 返回空串，由调用方决定是缺 flag 还是取默认值） */
export function question(text: string): Promise<string> {
  return new Promise((resolve) => {
    if (!isInteractive()) {
      resolve('')
      return
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    rl.question(text, (answer) => {
      rl.close()
      resolve(answer)
    })
  })
}

/**
 * 不回显的输入（token / 口令）：raw 模式逐键读，自己回 `*`。
 *
 * 不用「readline + 静音 output」那套：它在 Windows 终端上依赖 output 是 TTY，粘贴长串时容易乱。
 */
export function askSecret(text: string): Promise<string> {
  return new Promise((resolve) => {
    if (!isInteractive()) {
      resolve('')
      return
    }
    process.stdout.write(text)
    const stdin = process.stdin
    readline.emitKeypressEvents(stdin)
    const wasRaw = Boolean(stdin.isRaw)
    stdin.setRawMode(true)
    stdin.resume()
    let value = ''
    let onKeypress: (chunk: string, key: Key) => void
    const finish = (result: string) => {
      stdin.removeListener('keypress', onKeypress)
      stdin.setRawMode(wasRaw)
      stdin.pause()
      process.stdout.write('\n')
      resolve(result)
    }
    onKeypress = (chunk: string, key: Key) => {
      if (key?.name === 'return' || key?.name === 'enter') {
        finish(value.trim())
        return
      }
      if (key?.ctrl && key?.name === 'c') {
        // 通用模块不决定退出码：Ctrl+C 一律当「没输入」返回空串，由调用方报错并提示重试
        finish('')
        return
      }
      if (key?.name === 'backspace') {
        if (value) {
          value = value.slice(0, -1)
          process.stdout.write('\b \b')
        }
        return
      }
      // 粘贴会一次性送来多个字符；只收可见字符（码点 ≥ 0x20 且非 DEL），避免控制序列混进 token
      const visible = [...(chunk ?? '')].filter(char => (char.codePointAt(0) ?? 0) >= 0x20 && char.codePointAt(0) !== 0x7F).join('')
      if (visible) {
        value += visible
        process.stdout.write('*'.repeat(visible.length))
      }
    }
    stdin.on('keypress', onKeypress)
  })
}
