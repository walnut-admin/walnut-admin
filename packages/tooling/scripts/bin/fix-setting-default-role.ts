#!/usr/bin/env node
/**
 * 把 `app_setting.app.default.role` 的值从 role ObjectId hex 订正为 uuid v5
 * （幂等，已是 uuid 则跳过；`--dry-run` 只看不写）。
 *
 * 退出码与输出由 `runCli` 统一（0 通过 / 1 查出违规 / 2 前置条件未满足）—— 见 `src/lib/cli.ts`。
 */
import { main } from '../src/db/fix-setting-default-role.ts'
import { runCli } from '../src/lib/cli.ts'

await runCli(main)
