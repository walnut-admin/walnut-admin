#!/usr/bin/env node
/**
 * 包 `exports` 形态：目标存在 / 通配命中 / `types` 条件在前 / 与顶层 main·types 不矛盾
 *
 * 退出码与输出由 `runCli` 统一（0 通过 / 1 查出违规 / 2 前置条件未满足）—— 见 `src/lib/cli.ts`。
 */
import { main } from '../src/ci/check-package-exports.ts'
import { runCli } from '../src/lib/cli.ts'

await runCli(main)
