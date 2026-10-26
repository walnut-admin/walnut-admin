#!/usr/bin/env node
/**
 * 把 `apps/server/db/seed/` 的初始化数据播种进 PostgreSQL（按 id upsert，幂等可重放）。
 *
 * 退出码与输出由 `runCli` 统一（0 通过 / 1 查出违规 / 2 前置条件未满足）—— 见 `src/lib/cli.ts`。
 */
import { main } from '../src/db/seed-pg.ts'
import { runCli } from '../src/lib/cli.ts'

await runCli(main)
