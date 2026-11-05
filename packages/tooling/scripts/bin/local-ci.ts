#!/usr/bin/env node
/**
 * `pnpm ci:local` 的入口：把 CI 的**构建类**步骤（server / admin 构建、产物冒烟、产物去密、
 * 文档死链、迁移、worker 冒烟、actionlint）按依赖顺序复刻到本机跑一遍。
 *
 * 退出码与输出由 `runCli` 统一（0 通过 / 1 查出违规 / 2 前置条件未满足 / 3 未验证）——
 * 见 `src/lib/cli.ts`。第 3 态是「本机没装 actionlint ⇒ 那一步压根没跑」，
 * 它**不是**通过：汇总里会单列出未验证的步骤。
 *
 * 与 `pnpm prepush` 的分工：那边是静态门禁（每次 push 必跑、并行、快），这边是构建类
 * （推之前跑一次、顺序、分钟级），两条命令没有重叠的步骤。步骤表在 `src/ci/local-ci.ts`。
 */
import { main } from '../src/ci/local-ci.ts'
import { runCli } from '../src/lib/cli.ts'

await runCli(main)
