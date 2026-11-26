#!/usr/bin/env node
/**
 * 产物去密体检：`apps/admin/dist` + `apps/admin/dist-staging` 里有没有机密形态 /
 * 后端 env 真值 / 凭据文件。
 *
 * 退出码与输出由 `runCli` 统一（0 通过 / 1 查出违规 / 2 前置条件未满足）—— 见 `src/lib/cli.ts`。
 * **argv 必须转发**：`main` 支持显式传产物目录（本地对着别处产物跑），此前写
 * `runCli(main)` 让 `main()` 收不到 `process.argv`，那个参数面是死代码。
 */
import process from 'node:process'
import { main } from '../src/ci/check-dist-secrets.ts'
import { runCli } from '../src/lib/cli.ts'

await runCli(() => main(process.argv.slice(2)))
