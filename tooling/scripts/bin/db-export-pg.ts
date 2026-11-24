#!/usr/bin/env node
/**
 * 从 PostgreSQL 反向导出 seed 形态的 Extended JSON（PG 生态回灌口径，uuid 为 _id；`--anonymize` 脱敏）。
 *
 * 退出码与输出由 `runCli` 统一（0 通过 / 1 查出违规 / 2 前置条件未满足）—— 见 `src/lib/cli.ts`。
 */
import { main } from '../src/db/export-pg.ts'
import { runCli } from '../src/lib/cli.ts'

await runCli(main)
