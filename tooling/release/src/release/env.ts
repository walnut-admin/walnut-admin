/**
 * 发版子进程的环境策略：**哪些变量不许进子进程**。
 *
 * 为什么需要它：`git push` 会触发本仓自己的 pre-push 钩子（`pnpm --silent prepush`），
 * 那里面跑的全是仓库里的脚本。它们没有任何正当理由看到发版机上的凭据 —— 而钩子内容是可以被
 * 一次提交改掉的。用 `--no-verify` 规避是**错的**：那等于把本地门禁整个拆掉。
 *
 * 所以策略是「剥掉」而不是「绕过」：所有子进程统一从 `RELEASE_CHILD_ENV` 取环境，
 * 而它由一个工厂函数产出（见 release/release.ts 的 childOptions），调用点没有机会漏掉。
 */

import { sanitizeEnv } from '@walnut/scripts/lib/child-run'

/** 不许进入任何子进程的变量名 */
export const RELEASE_CHILD_ENV_SECRETS: readonly string[] = ['GITHUB_TOKEN', 'GH_TOKEN'] as const

/**
 * 子进程环境。`sanitizeEnv` 同时会强制 `GIT_TERMINAL_PROMPT=0` ——
 * 否则凭据缺失时 git 会**挂在交互提示上**，在非交互环境里表现为「卡死」而不是「失败」。
 */
export const RELEASE_CHILD_ENV: NodeJS.ProcessEnv = sanitizeEnv(RELEASE_CHILD_ENV_SECRETS)
