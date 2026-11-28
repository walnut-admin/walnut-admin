/**
 * `@walnut/utils/sign-raw` 的运行期桥。
 *
 * 为什么不能直接 `import { buildSignRaw } from '@walnut/utils/sign-raw'`：
 * 该包的 `exports.import` 指向 **源码**（`./src/*.ts`，仓库里是「源码直消费」），
 * 而源码内部是**无扩展名的相对导入**（`./object-paths`）—— Node 原生 ESM 不做扩展名推断，
 * 直接 import 会在解析阶段 `ERR_MODULE_NOT_FOUND`（tsc / Vite / vitest 各自有解析器，
 * 所以只有「Node 原生跑」的这条腿会炸）。
 *
 * 服务端进程消费的是该包的 `require` 条件（`dist/*.cjs`），E2E 也用同一份产物：
 * 签名原文的规则因此与后端**逐字节同源**（不是抄一份）。
 * 前置条件：`pnpm build`（或 `pnpm --filter @walnut/utils build`）已产出 dist；
 * 缺产物时这里给可操作的报错，而不是让 Node 抛一句模块找不到。
 */
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)

interface SignRawModule {
  buildSignRaw: (parts: {
    method: string
    path: string
    query?: string
    body?: unknown
    timestamp: number
    nonce: string
    ua: string
  }) => string
  splitPathAndQuery: (url: string) => { path: string; query?: string }
}

function load(): SignRawModule {
  try {
    return require('@walnut/utils/sign-raw') as SignRawModule
  } catch (error) {
    const pkgDir = resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../../../packages/platform-any/utils-core',
    )
    const distHint = existsSync(resolve(pkgDir, 'dist/sign-raw.cjs'))
      ? '（dist 存在但解析失败，检查 node_modules 链接）'
      : '（dist 不存在 —— 先跑 `pnpm --filter @walnut/utils build`）'
    throw new Error(
      `[e2e] 加载 @walnut/utils/sign-raw 的 CJS 产物失败${distHint}：${(error as Error).message}`,
    )
  }
}

const mod = load()

export const buildSignRaw = mod.buildSignRaw
export const splitPathAndQuery = mod.splitPathAndQuery
