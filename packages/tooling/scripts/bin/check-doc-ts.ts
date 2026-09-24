#!/usr/bin/env node
/**
 * 文档里标成 `ts` 的代码块必须能按 TypeScript 解析（JSON 别标成 ts）
 *
 * 退出码与输出由 `runCli` 统一（0 通过 / 1 查出违规 / 2 前置条件未满足）—— 见 `src/lib/cli.ts`。
 */
import { main } from '../src/ci/check-doc-ts.ts'
import { runCli } from '../src/lib/cli.ts'

await runCli(main)
