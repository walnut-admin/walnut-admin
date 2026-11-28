import { z } from 'zod'

export function VITE_PROXY_VALIDATE() {
  return z.preprocess(
    (v: unknown) => typeof v === 'string' && JSON.parse(v),
    z.tuple([
      z.tuple([
        z.coerce.number(),
        z.string(),
        // https://github.com/colinhacks/zod/discussions/1254#discussioncomment-6395482
        z.string().url().optional().or(z.literal('')),
      ]),
      z.tuple([
        z.coerce.number(),
        z.string(),
        // https://github.com/colinhacks/zod/discussions/1254#discussioncomment-6395482
        z.string().url().optional().or(z.literal('')),
        z.string(),
        z.string(),
      ]),
    ]),
  )
}

export function VITE_SENTRY_CONFIG() {
  return {
    VITE_BUILD_SENTRY: z.coerce.boolean(),
    VITE_BUILD_SENTRY_DSN: z.string(),
    VITE_BUILD_SENTRY_ORG: z.string(),
    VITE_BUILD_SENTRY_PROJECT: z.string(),
    VITE_BUILD_SENTRY_AUTH_TOKEN: z.string(),
  }
}

/**
 * 可选的构建类插件开关：**不配就是关**。
 *
 * 为什么是 `optional()`：这两个键是后加的，密文 env 模板里没有它们；而 `@julr/vite-plugin-validate-env`
 * 对「键不存在」是硬报错（不是跳过），不设成可选的话启动校验会让 dev server / 构建直接起不来。
 * 想启用时在对应 env 文件里加一行（或经环境变量传入），不必动模板里的其它键。
 */
export function VITE_OPTIONAL_BUILD_PLUGIN_FLAGS() {
  return {
    VITE_BUILD_CSP: z.coerce.boolean().optional(),
    VITE_BUILD_LEGACY: z.coerce.boolean().optional(),
  }
}

export function VITE_SHARED_CONFIG() {
  return {
    VITE_APP_TITLE: z.string(),
    VITE_GA_ID: z.string(),
    VITE_GOOGLE_CLIENT_ID: z.string(),
    VITE_SERVER_STATIC_PUBLIC_KEY: z.string(),

    VITE_SECONDS_AXIOS_TIMEOUT: z.coerce.number(),
    VITE_SECONDS_AXIOS_CACHE: z.coerce.number(),
    VITE_SECONDS_PERSIST: z.coerce.number(),
  }
}
