#!/usr/bin/env node
/**
 * `pnpm walnut docs:version`：查**本仓** GitHub 最新发版，把 tag 写回 `apps/docs/version.json`
 * （文档站导航栏显示的版本号）。
 *
 * 逻辑见 `src/docs/docs-version.ts`（`releases/latest` → 404 回退本机最新 tag）；
 * 退出码由 `runCli` 统一（0 通过 / 2 前置条件未满足）。
 */
import { main } from '../src/docs/docs-version.ts'
import { runCli } from '../src/lib/cli.ts'

await runCli(main)
