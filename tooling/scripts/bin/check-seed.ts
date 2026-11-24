#!/usr/bin/env node
/**
 * 初始化数据集（`apps/server/db/seed/`）的形态门禁：必需集合 / 禁入集合 / 体积 / 凭据形状 / 引用完整性 / 裁剪生效。
 *
 * 退出码与输出由 `runCli` 统一（0 通过 / 1 查出违规 / 2 前置条件未满足）—— 见 `src/lib/cli.ts`。
 */
import { main } from '../src/ci/check-seed.ts'
import { runCli } from '../src/lib/cli.ts'

await runCli(main)
