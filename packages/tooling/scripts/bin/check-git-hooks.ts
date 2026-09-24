#!/usr/bin/env node
/**
 * 断言本机的 git 钩子仍由 lefthook 托管（`pnpm hooks:check`）。
 *
 * 为什么它必须由 bot/发版这类**不经钩子**的入口来调：`prepush` 本身就是钩子调的，
 * 钩子没装时它根本不会跑 —— 它保护不了自己。判据与修法见 `src/ci/check-git-hooks.ts`。
 *
 * ⚠️ 两条 import 的**书写顺序必须与 import sorter 一致**（`ci` 在 `lib` 之前）——
 * 否则 `eslint --fix` 会把上面的文件头跟着它原来那条 import 一起搬走，`script-header` 当场红。
 */
import { main } from '../src/ci/check-git-hooks.ts'
import { runCli } from '../src/lib/cli.ts'

await runCli(main)
