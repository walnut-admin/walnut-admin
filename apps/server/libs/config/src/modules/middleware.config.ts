import type { Recordable } from 'easy-fns-ts'
import * as process from 'node:process'
import { registerAs } from '@nestjs/config'
import { isProd } from '@walnut-server/config/utils/env'
import { WalnutAdminConstAppHTTPMethods } from '@walnut-server/const/app/methods'
import { getPackageJsonData } from '@walnut-server/utils/pkg'
import { RequestHeaders } from '@walnut/contract/http'

const pkg = getPackageJsonData()

/**
 * F-43：dev / stage 的 CORS 白名单（显式枚举，不再回 `*`）。
 *
 * 为什么必须换掉 `*`：CORS 规范里 `Access-Control-Allow-Origin: *` 与
 * `Access-Control-Allow-Credentials: true` **互斥** —— 浏览器看到这两条同时出现会直接
 * 拒绝带凭据的跨源响应。而本项目全站走 cookie（DEVICE_ID / SIGN_TICKET / CAPJS_TOKEN）
 * + `credentials: true`，所以 `*` 在开发下**本来就是坏的**（登录态跨源请求拿不到响应）。
 * 改成显式白名单后，Origin 会被原样回写、凭据才真正可用。
 *
 * 端口取本仓库实际会起的那几个（host 双写 127.0.0.1 与 localhost，协议双写 http/https ——
 * admin 的 dev server 由 vite-plugin-mkcert 起 **https**，见 apps/admin/build/vite/plugin/https.ts）：
 * - 3100  admin dev server（Vite）
 * - 3000  后端自身（APP_PORT；Scalar API Reference 与直连调试）
 * - 8886  docs dev server（VitePress）
 * - 4173  `vite preview` 默认端口
 *
 * 端口变了 / 要额外放行某个源时**不用改代码**：`APP_CORS_ALLOW_ORIGINS`（逗号分隔）优先。
 */
const DEV_ALLOW_ORIGIN_HOSTS = ['127.0.0.1', 'localhost'] as const
const DEV_ALLOW_ORIGIN_PORTS = [3100, 3000, 8886, 4173] as const

const DEV_ALLOW_ORIGINS: string[] = DEV_ALLOW_ORIGIN_HOSTS.flatMap(host =>
  DEV_ALLOW_ORIGIN_PORTS.flatMap(port => [`http://${host}:${port}`, `https://${host}:${port}`]),
)

/**
 * 解析 `APP_CORS_ALLOW_ORIGINS`（逗号分隔，允许空白与空项）。
 * 返回空数组 = 未配置 = 走下面的默认值（env 覆盖**优先**，不是追加）。
 */
function readAllowOriginOverride() {
  return (process.env.APP_CORS_ALLOW_ORIGINS ?? '')
    .split(',')
    .map(origin => origin.trim())
    .filter(origin => origin.length > 0)
}

function resolveAllowOrigin() {
  const override = readAllowOriginOverride()

  if (override.length > 0) {
    return override
  }

  // 生产：单源（www 域），与改造前一致；dev / stage：本地白名单
  return isProd
    ? `https://www.${(pkg.config as Recordable).domain as string}`
    : DEV_ALLOW_ORIGINS
}

export default registerAs('middleware', () => ({
  cors: {
    allowMethod: [
      WalnutAdminConstAppHTTPMethods.GET,
      WalnutAdminConstAppHTTPMethods.POST,
      WalnutAdminConstAppHTTPMethods.DELETE,
      WalnutAdminConstAppHTTPMethods.PUT,
      WalnutAdminConstAppHTTPMethods.PATCH,
    ],

    allowOrigin: resolveAllowOrigin(),

    allowHeader: [
      'Accept',
      'Accept-Language',
      'Content-Language',
      'Content-Type',
      'Origin',
      'Authorization',
      'Access-Control-Request-Method',
      'Access-Control-Request-Headers',
      'Access-Control-Allow-Headers',
      'Access-Control-Allow-Origin',
      'Access-Control-Allow-Methods',
      'Access-Control-Allow-Credentials',
      'Access-Control-Expose-Headers',
      'Access-Control-Max-Age',
      'Referer',
      'Host',
      'X-Requested-With',
      'X-Content-Type-Options',
      ...Object.values(RequestHeaders),
    ],
  },
}))
