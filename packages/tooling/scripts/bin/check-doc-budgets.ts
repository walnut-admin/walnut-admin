#!/usr/bin/env node
/**
 * 常驻上下文文档（根与包级 AGENTS.md 等）的字数预算
 *
 * 退出码与输出由 `runCli` 统一（0 通过 / 1 查出违规 / 2 前置条件未满足）—— 见 `src/lib/cli.ts`。
 */
import { main } from '../src/ci/check-doc-budgets.ts'
import { runCli } from '../src/lib/cli.ts'

await runCli(main)
