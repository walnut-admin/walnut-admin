/**
 * 子进程输出的**尾部缓冲**：把最后 N 行留下来，失败时重播给用户。
 *
 * 为什么需要：`git push` 会触发 `.git/hooks/pre-push` → 本仓的 pre-push 门禁（boundaries /
 * types:check / syncpack / lint:workflows / `pnpm change check`，冷跑数分钟），输出量很大。而用
 * `stdio: 'inherit'` 让子进程**直接写终端**时，脚本自己一个字都拿不到 —— 失败时能补的只有
 * 「退出码 1」，报错正文早被心跳与后续输出冲到屏幕外，用户既不知道哪一项失败，也没法提 bug。
 *
 * 这里只做**缓冲**这件纯粹的事（不碰 IO、不碰 spawn），所以能被单测钉住；转播与重播由
 * lib/child-run.ts 负责。
 */

/** 保留的非空行数上限：够覆盖「哪一项失败 + 报错 + 修法」，又不会把终端刷满 */
const TAIL_LINES = 60

/**
 * 尾部缓冲：留最后 N 行 + 见过的总行数。
 *
 * 按 `\n` 切块（一块 chunk 常含多行）；空行不计 —— 它们只占位置、不携带信息。
 */
export class TailBuffer {
  private readonly limit: number
  private readonly buffer: string[] = []
  private count = 0

  constructor(limit: number = TAIL_LINES) {
    this.limit = limit > 0 ? limit : TAIL_LINES
  }

  /** 吃进一块输出 */
  push(chunk: string): void {
    for (const line of chunk.split('\n')) {
      if (line.trim() === '')
        continue
      this.count += 1
      this.buffer.push(line)
      while (this.buffer.length > this.limit)
        this.buffer.shift()
    }
  }

  /** 尾部缓冲的快照（拷贝：调用方改不动内部状态） */
  lines(): string[] {
    return [...this.buffer]
  }

  /** 见过的**总行数**（含已被挤掉的）：报错里说「一共 N 行，这里只留最后 M 行」靠它 */
  total(): number {
    return this.count
  }
}

/**
 * 把尾部缓冲渲染成「失败时重播的那段」（只取最后 `max` 行，缺省 60）。
 *
 * 没有输出时也明确说一句，而不是留空白 —— 留空白会让人以为是脚本自己吞了输出。
 */
export function renderFailureTail(lines: string[], max: number = TAIL_LINES): string {
  const tail = max > 0 && lines.length > max ? lines.slice(-max) : lines
  if (tail.length === 0)
    return '   （子进程没有输出任何内容）'
  return `   ── 失败前的最后 ${tail.length} 行输出 ──\n${tail.map(line => `   ${line}`).join('\n')}`
}
