#!/usr/bin/env node
/**
 * 活文档正文里引用的包名 / 仓库路径是否真实存在
 *
 * 退出码与输出由 `runCli` 统一（0 通过 / 1 查出违规 / 2 前置条件未满足）—— 见 `src/lib/cli.ts`。
 */
import { main } from '../src/ci/check-doc-refs.ts'
import { runCli } from '../src/lib/cli.ts'

await runCli(main)
