import type { ValueOf } from 'easy-fns-ts'
import process from 'node:process'

export const WalnutAdminConstAppEnv = {
  DEV: 'development',
  STAGE: 'stage',
  PROD: 'production',
} as const

export type IWalnutAdminConstAppEnv = ValueOf<
  typeof WalnutAdminConstAppEnv
>

// ── 运行环境判定（纯 process.env 读）─────────────────────────────────────────────
// 为什么放在 const 而不是 config（W3 分层守卫补盲批，2026-11-01）：
// 原先四个判定在 `libs/config/src/utils/env.ts`，而 `libs/const`（cookie 的
// __Host-/__Secure- 前缀）与 `libs/utils`（response 的 _devMsg）都要 import 它 ——
// 与 middleware.config 对 `libs/utils/pkg` 的反向依赖一起构成
// const ↔ config ↔ utils 的同层互引 SCC。三者同属基建层，层间 ESLint 规则看不见这种环，
// 只能靠「纯判定放到最低叶子」消除。值仍在模块求值时读一次 process.env，语义与迁移前一致；
// `config/utils/env` 保留为兼容转发入口。
export const isDev = process.env.NODE_ENV === WalnutAdminConstAppEnv.DEV
export const isProd = process.env.NODE_ENV === WalnutAdminConstAppEnv.PROD
export const isStage = process.env.NODE_ENV === WalnutAdminConstAppEnv.STAGE

export const WalnutAdminEnv = process.env.NODE_ENV
