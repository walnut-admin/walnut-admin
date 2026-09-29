#!/usr/bin/env node
/**
 * 把初始化数据打成发版资产（`apps/server/db/.pack/walnut-admin-seed-<version>.tar.gz`）。
 *
 * 退出码与输出由 `runCli` 统一（0 通过 / 1 查出违规 / 2 前置条件未满足）—— 见 `src/lib/cli.ts`。
 */
import { main } from '../src/db/pack.ts'
import { runCli } from '../src/lib/cli.ts'

await runCli(main)
