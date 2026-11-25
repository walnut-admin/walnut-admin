/**
 * `@walnut/contract` 的运行期桥。
 *
 * 为什么不能直接 `import { ... } from '@walnut/contract'`：该包的 `exports.import` 指向
 * **源码**（`./src/index.ts`，仓库里是「源码直消费」），而源码内部是**无扩展名的相对导入**
 * （`./cookie`）—— Node 原生 ESM 不做扩展名推断，直接 import 会在解析阶段
 * `ERR_MODULE_NOT_FOUND`。这与 `lib/protocol/sign-raw.ts` 是同一类问题，解法也相同：
 * 走 `createRequire` 消费该包的 `require` 条件（`dist/index.cjs`）。
 *
 * 前后端进程消费的也是这份 CJS 产物，E2E 因此与它们**逐字同源**（响应码 / 路由 / cookie 名
 * 不是抄一份）。前置条件：contract 的 dist 已构建 —— 缺产物时这里给可操作的报错，而不是让
 * Node 抛一句模块找不到。
 *
 * 纪律：只 re-export e2e 真正用到的名字。contract 里没有的常量**不要**为 e2e 顺手加进去
 * （那会触发契约快照 diff，且「测试需要什么就往契约里加」是本末倒置）。
 */
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)

type ContractModule = typeof import('@walnut/contract')

function load(): ContractModule {
  try {
    return require('@walnut/contract') as ContractModule
  }
  catch (error) {
    const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../packages/platform-any/contract')
    const distHint = existsSync(resolve(pkgDir, 'dist/index.cjs'))
      ? '（dist 存在但解析失败，检查 node_modules 链接）'
      : '（dist 不存在 —— 先跑 `pnpm --filter @walnut/contract build`）'
    throw new Error(`[e2e] 加载 @walnut/contract 的 CJS 产物失败${distHint}：${(error as Error).message}`)
  }
}

const mod = load()

// 来源：packages/platform-any/contract/src/cookie.ts —— cookie 基名（stage 形态无前缀）
export const WalnutAdminConstCookieKeys = mod.WalnutAdminConstCookieKeys
// 来源：packages/platform-any/contract/src/response-code.ts —— 业务响应码
export const WalnutAdminConstAppResponseCode = mod.WalnutAdminConstAppResponseCode
// 来源：packages/platform-any/contract/src/routes.ts —— 认证 / 安全 / 系统路由
export const AuthRoutes = mod.AuthRoutes
export const SecurityRoutes = mod.SecurityRoutes
export const SystemRoutes = mod.SystemRoutes
export const SystemEndpointRoutes = mod.SystemEndpointRoutes
