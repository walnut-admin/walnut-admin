#!/usr/bin/env node
/**
 * apps/** 里不许出现「拼出来的」动态 import（模板插值 / 非字面量说明符）
 *
 * 退出码与输出由 `runCli` 统一（0 通过 / 1 查出违规 / 2 前置条件未满足）—— 见 `src/lib/cli.ts`。
 */
import { main } from '../src/ci/check-dynamic-imports.ts'
import { runCli } from '../src/lib/cli.ts'

await runCli(main)
