#!/usr/bin/env node
/**
 * 手写 `.d.ts` 关掉 `skipLibCheck` 查一遍（只报仓库内文件）
 *
 * 退出码与输出由 `runCli` 统一（0 通过 / 1 查出违规 / 2 前置条件未满足）—— 见 `src/lib/cli.ts`。
 */
import { main } from '../src/ci/check-handwritten-dts.ts'
import { runCli } from '../src/lib/cli.ts'

await runCli(main)
