#!/usr/bin/env node
/**
 * ADR 形态校验：编号连续 / `Status` 在枚举内 / 四个必需小节齐备 / `index.md` 双向对齐
 *
 * 退出码与输出由 `runCli` 统一（0 通过 / 1 查出违规 / 2 前置条件未满足）—— 见 `src/lib/cli.ts`。
 */
import { main } from '../src/ci/check-adr.ts'
import { runCli } from '../src/lib/cli.ts'

await runCli(main)
