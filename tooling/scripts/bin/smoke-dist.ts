#!/usr/bin/env node
/**
 * 产物冒烟：把 `dist` 拿真实浏览器打开，断言应用真的挂载了（`#app` 里 splash 消失、无未捕获异常）。
 *
 * 退出码与输出由 `runCli` 统一（0 通过 / 1 查出违规 / 2 前置条件未满足）—— 见 `src/lib/cli.ts`。
 * 找不到浏览器时**明确 SKIP** 并按通过返回（那行字会说明怎么启用）。
 */
import { runCli } from '../src/lib/cli.ts'
import { main } from '../src/smoke/dist.ts'

await runCli(main)
