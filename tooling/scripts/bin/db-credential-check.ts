#!/usr/bin/env node
/**
 * 只读探针：检查 `sys_user_identity` 里 `type='password'` 的行在当前 env 下能否被解密 /
 * valueHash 是否自洽（口令凭证静默变砖的早期发现通道）。
 *
 * 退出码由 `runCli` 统一（0 全部可用 / 1 查出 stale 或 hash 不一致 / 2 前置条件未满足）。
 */
import { main } from '../src/db/credential-check.ts'
import { runCli } from '../src/lib/cli.ts'

await runCli(main)
