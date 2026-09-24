#!/usr/bin/env node
/**
 * 用 actionlint 校验 `.github/workflows/*.yml` 与本地 composite action
 *
 * 退出码与输出由 `runCli` 统一（0 通过 / 1 查出违规 / 2 前置条件未满足）—— 见 `src/lib/cli.ts`。
 */
import { main } from '../src/ci/lint-workflows.ts'
import { runCli } from '../src/lib/cli.ts'

await runCli(main)
