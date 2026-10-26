#!/usr/bin/env node
/**
 * MongoDB → PostgreSQL 存量数据搬迁（默认增量幂等；`--fresh` 全量重建）。
 *
 * Mongo 侧**只读**（walnut-admin-nestjs 绝不写入）。退出码与输出由 `runCli` 统一
 * （0 通过 / 1 查出违规 / 2 前置条件未满足）—— 见 `src/lib/cli.ts`。
 */
import { main } from '../src/db/etl-mongo-to-pg.ts'
import { runCli } from '../src/lib/cli.ts'

await runCli(main)
