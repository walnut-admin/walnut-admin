#!/usr/bin/env node
/**
 * 新增一个后端内部 lib 的脚手架：一次改完 10 个既有注册面 + 建 2 个新文件，**幂等**。
 *
 * 用法：`pnpm scaffold:lib <name> --layer=<层> [--dry-run]`
 * 退出码与输出由 `runCli` 统一（0 通过 / 1 查出问题 / 2 前置条件未满足）—— 见 `src/lib/cli.ts`。
 */
import { runCli } from '../src/lib/cli.ts'
import { main } from '../src/scaffold/scaffold-lib.ts'

await runCli(main)
