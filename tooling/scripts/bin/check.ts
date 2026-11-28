#!/usr/bin/env node
/**
 * 本地完整检查（`pnpm check`）：ESLint 轨 + 类型 + 测试 + oxlint 轨 + 格式。
 *
 * 步骤表在 `src/ci/check.ts`（顺序即执行顺序，第一个失败即止）。退出码由 `runCli` 统一
 * （0 通过 / 1 查出违规 / 2 前置条件未满足）—— 见 `src/lib/cli.ts`。
 */
import { main } from '../src/ci/check.ts'
import { runCli } from '../src/lib/cli.ts'

await runCli(main)
