#!/usr/bin/env node
/**
 * 产物去密体检：`apps/admin/dist` 里有没有机密形态 / 后端 env 真值 / 凭据文件
 *
 * 退出码与输出由 `runCli` 统一（0 通过 / 1 查出违规 / 2 前置条件未满足）—— 见 `src/lib/cli.ts`。
 */
import { main } from '../src/ci/check-dist-secrets.ts'
import { runCli } from '../src/lib/cli.ts'

await runCli(main)
