#!/usr/bin/env node
/**
 * 从库反向导出 `apps/server/db/seed/`（让初始化数据"可再生成"，`git diff` 即判据）。
 *
 * 退出码与输出由 `runCli` 统一（0 通过 / 1 查出违规 / 2 前置条件未满足）—— 见 `src/lib/cli.ts`。
 */
import { main } from '../src/db/export.ts'
import { runCli } from '../src/lib/cli.ts'

await runCli(main)
