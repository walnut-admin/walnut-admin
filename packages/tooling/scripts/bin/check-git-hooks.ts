#!/usr/bin/env node
/**
 * 断言本机的 git 钩子仍由 lefthook 托管（`pnpm hooks:check`）。
 *
 * 为什么它必须由 bot/发版这类**不经钩子**的入口来调：`prepush` 本身就是钩子调的，
 * 钩子没装时它根本不会跑 —— 它保护不了自己。判据与修法见 `src/ci/check-git-hooks.ts`。
 */
import process from 'node:process'
import { main } from '../src/ci/check-git-hooks.ts'

process.exit(main())
