/**
 * 构建期环境的结构化形态 —— `useBuildEnv` 的返回值，也是代理与插件表的输入。
 *
 * 此前它是 app 的 `types/vite-env.d.ts` 里的**全局**接口 `IViteEnv`（不 import 就能用）。
 * 搬进本包后改为显式导出：读代码的人必须 import 才看得见依赖，`tsc` 也才管得住它。
 */
export interface IViteEnv {
  port: number
  host: string
  title: string
  publicPath: string
  proxy: [[number, string, string], [number, string, string, string, string]]
  gaId: string

  dev: {
    /** 开发时是否启用 CSP 插件（`VITE_DEV_CSP`）：给 dev server 的页面注入策略，用来试错 */
    csp: boolean
  }

  build: {
    outDir: string
    obfuscator: boolean
    dropConsole: boolean
    compression: boolean
    analyzer: boolean
    banner: boolean
    cdn: boolean
    disableBrowserDevtool: boolean
    /** 构建时是否生成 CSP（`VITE_BUILD_CSP`，可选、默认关） */
    csp: boolean
    /** 构建时是否产出旧浏览器兼容包（`VITE_BUILD_LEGACY`，可选、默认关） */
    legacy: boolean
    sentry: {
      enabled: boolean
      dsn: string
      org: string
      project: string
      authToken: string
    }
  }
}
