import { defineConfig } from '@julr/vite-plugin-validate-env'
import { z } from 'zod/v4'
import { VITE_PROXY_VALIDATE, VITE_SHARED_CONFIG } from './shared'

export default defineConfig({
  ...VITE_SHARED_CONFIG(),

  // dev 下这两个**允许不配**（覆盖 shared 里那条必填）：`@julr/vite-plugin-validate-env` 对
  // **键不存在**是硬报错 —— standardValidation 只做 `validator['~standard'].validate(env[key])`，
  // undefined 即 `Invalid input: expected string, received undefined` ⇒ dev server 起不来。
  // 但「允许不配」≠「空着也能跑」，两者的实际后果不同：
  //   · `VITE_GA_ID` 空着没事 —— `analytics.ts` 自己写着 `if (!…VITE_GA_ID) return`；
  //   · `VITE_GOOGLE_CLIENT_ID` 空着会在**运行时**抛（`vue3-google-signin` 的 install() 见空即
  //     `clientId is required to initialize`，调用点 `src/App/src/scripts/google-signin.ts`）。
  // 这里放开的只是**启动校验**；要用 Google 登录，本地必须填真 client id。
  VITE_GA_ID: z.string().optional(),
  VITE_GOOGLE_CLIENT_ID: z.string().optional(),

  VITE_PORT: z.coerce.number(),
  VITE_HOST: z.string(),
  VITE_PUBLIC_PATH: z.string(),
  VITE_PROXY: VITE_PROXY_VALIDATE(),

  VITE_DEV_CSP: z.coerce.boolean(),
})
