#!/usr/bin/env node
/**
 * 用 actionlint 校验 `.github/workflows/*.yml` 与本地 composite action
 *
 * 退出码与输出由 `runCli` 统一（0 通过 / 1 查出违规 / 2 前置条件未满足 / 3 未验证）——
 * 见 `src/lib/cli.ts`。没有 actionlint 时**这一步压根没跑**（`SkippedError` ⇒ 3）；
 * 与 2 的区别是：2 跑了但前提不成立，3 一步都没跑，所以 3 既不是通过也不是违规。
 */
import { main } from '../src/ci/lint-workflows.ts'
import { runCli } from '../src/lib/cli.ts'

await runCli(main)
