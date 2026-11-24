/**
 * 步骤模块与 CLI 之间的**唯一接口**：只声明，不实现。
 *
 * 为什么这么切：步骤体（generate / consume / steps / changelog）绝不 import CLI 的任何东西，
 * 它们只接收一个 `ReleaseUi`。于是「退出码是 0/1/2 哪一档」「日志走 stdout 还是 stderr」
 * 「子进程环境剥没剥凭据」这三件策略**只有 CLI 说了算**（实现在 release/release.ts），
 * 与步骤体写在哪一层无关。
 */

import type { RunVisibleOptions } from '@walnut/scripts/lib/child-run'

export interface ReleaseUi {
  /** 人类日志（`--json` 时全部改道 stderr） */
  log: (msg: string) => void
  /** 警告：不中断，但必须显眼 */
  warn: (msg: string) => void
  /** 交互横幅（总览 / 状态）；正文由 report.ts 构造 */
  banner: (lines: string[]) => void
  /** 机器可读结果（只在 `--json` 时输出；stdout 仅此一处） */
  emitJson: (payload: Record<string, unknown>) => void
  /** 终止：`code` 只允许 1（检出违规 / 子步骤失败）或 2（前置条件未满足） */
  die: (code: 1 | 2, msg: string) => never
  /** 子进程的统一出口：日志出口 + 输出改道 + 剥过凭据的环境，一次给全 */
  childOptions: (extra?: Omit<RunVisibleOptions, 'output' | 'note'>) => RunVisibleOptions
  /** 跑一条 `pnpm <args>`（分钟级，实况转播 + 心跳 + 可中断） */
  runPnpmStep: (args: string[], hint?: string) => Promise<void>
  /**
   * 跑一条**秒级**的 `pnpm <args>`（同步，不转播）—— 用于 `pnpm change` 这类每个 commit 一次、
   * 输出量小且必须在循环里立即拿到结果的命令。走同一个出口 ⇒ 同样剥过凭据、同样 argv 直传。
   */
  execPnpmSync: (args: string[]) => { code: number, stdout: string, stderr: string }
  isInteractive: () => boolean
  ask: (text: string) => Promise<string>
  askSecret: (text: string) => Promise<string>
}
