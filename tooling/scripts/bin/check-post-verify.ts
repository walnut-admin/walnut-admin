#!/usr/bin/env node
/**
 * `deploy/post-verify.test.sh` 的行为测试门禁：用假 `docker` / `curl` 覆盖部署后验证脚本的
 * 各条失败分支（不需要 Docker）。
 *
 * 退出码与输出由 `runCli` 统一（0 通过 / 1 有用例失败 / 2 前置条件未满足 / 3 本机没有 bash）——
 * 见 `src/lib/cli.ts`。没有 bash 时**这一步压根没跑**（`SkippedError` ⇒ 3），不是
 * 「跑了但前提不成立」（那才是 2）。
 */
import { main } from '../src/ci/check-post-verify.ts'
import { runCli } from '../src/lib/cli.ts'

await runCli(main)
