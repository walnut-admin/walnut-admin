import type { IViteEnv } from './types.ts'

/**
 * 把 `loadEnv()` 读到的字符串表映射成构建期使用的结构化环境。
 *
 * 布尔量一律按**字面量 `'true'`** 判定（`VITE_DEV_CSP === 'true'`），不是「非空即真」——
 * 这是历史口径，`.env*` 里写 `false` 的开关必须是 `false` 而不是真。
 * `VITE_PROXY` 是 JSON 字符串，由 `VITE_PROXY_VALIDATE()` 的 zod schema 保证形状。
 * `VITE_BUILD_CSP` / `VITE_BUILD_LEGACY` 是可选键：不配时是 `undefined`，按 `=== 'true'` 的口径自然落到关。
 */
export function useBuildEnv(env: Record<string, string>): IViteEnv {
  return {
    port: +env.VITE_PORT,
    host: env.VITE_HOST,
    title: env.VITE_APP_TITLE,
    publicPath: env.VITE_PUBLIC_PATH,
    proxy: JSON.parse(env.VITE_PROXY),
    gaId: env.VITE_GA_ID,

    dev: {
      csp: env.VITE_DEV_CSP === 'true',
    },

    build: {
      outDir: env.VITE_BUILD_OUT_DIR,
      obfuscator: env.VITE_BUILD_OBFUSCATOR === 'true',
      dropConsole: env.VITE_BUILD_DROP_CONSOLE === 'true',
      compression: env.VITE_BUILD_COMPRESSION === 'true',
      analyzer: env.VITE_BUILD_ANALYZER === 'true',
      banner: env.VITE_BUILD_BANNER === 'true',
      cdn: env.VITE_BUILD_CDN === 'true',
      disableBrowserDevtool: env.VITE_BUILD_DISABLE_BROWSER_DEVTOOL === 'true',
      // 可选键：不配时是 undefined ⇒ 关
      csp: env.VITE_BUILD_CSP === 'true',
      legacy: env.VITE_BUILD_LEGACY === 'true',
      sentry: {
        enabled: env.VITE_BUILD_SENTRY === 'true',
        dsn: env.VITE_BUILD_SENTRY_DSN,
        org: env.VITE_BUILD_SENTRY_ORG,
        project: env.VITE_BUILD_SENTRY_PROJECT,
        authToken: env.VITE_BUILD_SENTRY_AUTH_TOKEN,
      },
    },
  }
}
