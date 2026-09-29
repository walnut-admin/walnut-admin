#!/usr/bin/env node
/**
 * 把 `apps/server/db/seed/` 的初始化数据播种进库（幂等；`--dry-run` 只看不写）。
 *
 * 退出码与输出由 `runCli` 统一（0 通过 / 1 查出违规 / 2 前置条件未满足）—— 见 `src/lib/cli.ts`。
 */
import { main } from '../src/db/seed.ts'
import { runCli } from '../src/lib/cli.ts'

await runCli(main)
