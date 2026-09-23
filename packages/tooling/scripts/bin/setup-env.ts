#!/usr/bin/env node
/**
 * 用根 `.env.keys` 在 `env-encrypted/` 与 `env-local/` 之间加解密（`pnpm setup-env` / `pnpm encrypt-env`）。
 *
 * 子命令由 argv 给（`decrypt` / `encrypt`），退出码遵循本仓三态：0 通过 / 1 失败 / 2 前置条件未满足。
 */
import process from 'node:process'
import { main } from '../src/env/setup-env.ts'

process.exit(main(process.argv.slice(2)))
