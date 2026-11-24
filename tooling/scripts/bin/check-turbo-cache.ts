#!/usr/bin/env node
/**
 * turbo 配置不变量：缓存边界（产物/outputs/env/依赖边）+ tags
 *
 * 退出码与输出由 `runCli` 统一（0 通过 / 1 查出违规 / 2 前置条件未满足）—— 见 `src/lib/cli.ts`。
 */
import { main } from '../src/ci/check-turbo-cache.ts'
import { runCli } from '../src/lib/cli.ts'

await runCli(main)
