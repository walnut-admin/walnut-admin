#!/usr/bin/env node
/**
 * 包 `exports` 的形态体检（`pnpm lint:exports`）。
 *
 * 本仓共享包**不构建就被消费**（`exports` 指 `./src/**`）⇒ 写错一个字符的症状不是报错，
 * 而是解析到别的入口或类型静默丢失，且往往在下游才炸。判据与取舍见
 * `src/ci/check-package-exports.ts` 顶部（含「产物不查存在性」这条实测结论）。
 */
import process from 'node:process'
import { main } from '../src/ci/check-package-exports.ts'

process.exit(main())
