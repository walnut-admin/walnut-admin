#!/usr/bin/env node
/**
 * 推送前门禁表（并行跑、每段报耗时；表在 `src/ci/prepush.ts`）
 *
 * 退出码与输出由 `runCli` 统一（0 通过 / 1 查出违规 / 2 前置条件未满足）—— 见 `src/lib/cli.ts`。
 */
import { main } from '../src/ci/prepush.ts'
import { runCli } from '../src/lib/cli.ts'

await runCli(main)
