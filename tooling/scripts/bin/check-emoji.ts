#!/usr/bin/env node
/**
 * 注释里不许有 emoji（纯文字）：扫所有被跟踪的文本文件，按扩展名分派注释语法；常驻上下文文档走严格档。
 *
 * 退出码与输出由 `runCli` 统一（0 通过 / 1 查出违规 / 2 前置条件未满足）—— 见 `src/lib/cli.ts`。
 * 加 `--fix` 可直接剔除（含相邻空格）。
 */
import { main } from '../src/ci/check-emoji.ts'
import { runCli } from '../src/lib/cli.ts'

await runCli(main)
