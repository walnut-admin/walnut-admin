import { defineConfig } from '@julr/vite-plugin-validate-env'
import { z } from 'zod/v4'
import { VITE_PROXY_VALIDATE, VITE_SHARED_CONFIG } from './shared'

export default defineConfig({
  ...VITE_SHARED_CONFIG(),

  // ⚠️ dev 下这两个**允许不配**（覆盖 shared 里那条必填）。判据是代码自己就是「没配也能跑」：
  //   · `src/App/src/scripts/analytics.ts` 开头就是 `if (!import.meta.env.VITE_GA_ID) return`
  //     —— 没有 GA 就不上报，是设计好的分支；
  //   · Google 登录靠 GIS 的 `clientId` 为空时自然不启用。
  //
  // 而 `@julr/vite-plugin-validate-env` 对**键不存在**是**硬报错**，不是警告：
  //   standardValidation → validator['~standard'].validate(env[key])
  //   ⇒ env[key] 是 undefined 就 `Failed to validate environment variables
  //     … Invalid value for "VITE_GA_ID" : expected string, received undefined`
  //   ⇒ dev server 直接起不来（页面打不开）。
  // 留成空值（`VITE_GA_ID=`）能过校验，但没人该为了"能启动"而在本地保留两行空配置。
  VITE_GA_ID: z.string().optional(),
  VITE_GOOGLE_CLIENT_ID: z.string().optional(),

  VITE_PORT: z.coerce.number(),
  VITE_HOST: z.string(),
  VITE_PUBLIC_PATH: z.string(),
  VITE_PROXY: VITE_PROXY_VALIDATE(),

  VITE_DEV_CSP: z.coerce.boolean(),
})
