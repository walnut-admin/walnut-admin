#!/usr/bin/env node
/**
 * 源码里的凭据形状（PEM 私钥 / 带真口令的连接串 / JWT / 云厂商 AK）
 *
 * 退出码与输出由 `runCli` 统一（0 通过 / 1 查出违规 / 2 前置条件未满足）—— 见 `src/lib/cli.ts`。
 */
import { main } from '../src/ci/check-source-secrets.ts'
import { runCli } from '../src/lib/cli.ts'

await runCli(main)
