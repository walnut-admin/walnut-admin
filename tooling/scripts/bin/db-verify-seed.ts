#!/usr/bin/env node
/**
 * 双库对拍：基线（旧 seed + 旧映射管线）与仓内 seed（PG 行形态）各灌一个空库，逐表逐列比 + 导出文件比。
 *
 * 退出码与输出由 `runCli` 统一（0 通过 / 1 查出违规 / 2 前置条件未满足）—— 见 `src/lib/cli.ts`。
 */
import { main } from '../src/db/seed-verify.ts'
import { runCli } from '../src/lib/cli.ts'

await runCli(main)
