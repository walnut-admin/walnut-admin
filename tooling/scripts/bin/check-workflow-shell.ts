#!/usr/bin/env node
/**
 * 工作流 shell 块的语法门禁：把 `.github/workflows/*.yml` 里每个 `run:` / `with.script:` 抽出来过
 * `bash -n`（`actionlint` 看不见字符串里的 shell 语法；本机没有 bash 时明确 SKIP）。
 * 退出码与输出由 `runCli` 统一：0 通过 / 1 查出违规 / 2 前置条件未满足 / 3 未验证 ——
 * 见 `src/lib/cli.ts`。没有 bash 时**这一步压根没跑**（`SkippedError` ⇒ 3），不是
 * 「跑了但前提不成立」（那才是 2）。
 */
import { main } from '../src/ci/check-workflow-shell.ts'
import { runCli } from '../src/lib/cli.ts'

await runCli(main)
