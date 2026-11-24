#!/usr/bin/env node
/**
 * 入口 nginx（`deploy/nginx/conf.d/`）的 4 个安全响应头
 *
 * 退出码与输出由 `runCli` 统一（0 通过 / 1 查出违规 / 2 前置条件未满足）—— 见 `src/lib/cli.ts`。
 */
import { main } from '../src/ci/check-nginx-headers.ts'
import { runCli } from '../src/lib/cli.ts'

await runCli(main)
