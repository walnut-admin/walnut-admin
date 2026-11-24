#!/usr/bin/env node
/**
 * 脚本前置钩子：有生成物（`build/generate/`）的包，其 vite / vue-tsc 脚本必须有 `pre<script>`
 *
 * 退出码与输出由 `runCli` 统一（0 通过 / 1 查出违规 / 2 前置条件未满足）—— 见 `src/lib/cli.ts`。
 */
import { main } from '../src/ci/check-pre-hooks.ts'
import { runCli } from '../src/lib/cli.ts'

await runCli(main)
