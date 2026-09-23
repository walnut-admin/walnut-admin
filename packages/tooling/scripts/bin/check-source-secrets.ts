#!/usr/bin/env node
/**
 * 源码密钥形态体检（`pnpm lint:secrets`）：仓库里的文本文件不许出现凭据形状的串。
 *
 * 为什么必须在**推送前**跑：GitHub 的 push protection 在服务端、且**先于 CI** ——
 * 靠 CI 拦等于拦不住（那时 push 已经被拒了）。缘由与判据见 `src/ci/check-source-secrets.ts`。
 */
import process from 'node:process'
import { main } from '../src/ci/check-source-secrets.ts'

process.exit(main())
