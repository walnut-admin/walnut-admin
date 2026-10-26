#!/usr/bin/env node
/**
 * ETL 结果三重对账（行数 / 抽样逐列 / 聚合）；任何差异 → 退出码非 0。
 *
 * 退出码与输出由 `runCli` 统一（0 通过 / 1 查出违规 / 2 前置条件未满足）—— 见 `src/lib/cli.ts`。
 */
import { main } from '../src/db/verify-etl.ts'
import { runCli } from '../src/lib/cli.ts'

await runCli(main)
