#!/usr/bin/env node
/**
 * `pnpm-workspace.yaml` 的 catalog ↔ `pnpm-lock.yaml` 锁步（比的是 HEAD 里那一对）
 *
 * 退出码与输出由 `runCli` 统一（0 通过 / 1 查出违规 / 2 前置条件未满足）—— 见 `src/lib/cli.ts`。
 */
import { main } from '../src/ci/check-catalog-lockstep.ts'
import { runCli } from '../src/lib/cli.ts'

await runCli(main)
