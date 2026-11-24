#!/usr/bin/env node
/**
 * 历史导出目录（`db:export:pg` 的 Extended JSON）→ **PG 行形态** seed 目录（`{ id, … }` + junction 独立文件）。
 *
 * 退出码与输出由 `runCli` 统一（0 通过 / 1 查出违规 / 2 前置条件未满足）—— 见 `src/lib/cli.ts`。
 */
import { main } from '../src/db/seed-reshape.ts'
import { runCli } from '../src/lib/cli.ts'

await runCli(main)
