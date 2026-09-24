import type { App } from 'vue'
import GoogleSignInPlugin from 'vue3-google-signin'

export function setupGoogleSignIn(app: App) {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID

  // 没配 client id 就整个跳过，别把它交给插件：install() 见空即抛
  // （`[GoogleSignInPlugin]: clientId is required to initialize`），而这里跑在 `app.mount()` 之前
  // —— 一抛整个 app 就挂不上去（白屏）。env 模板里这个键发的就是空串，所以这是必须容忍的分支。
  // 跳过之后登录页的 `useOneTap` 只是退化成 isReady=false，不会再炸。
  if (!clientId) {
    // turbo-console-disable-next-line
    console.warn('[GoogleSignIn] 未配置 VITE_GOOGLE_CLIENT_ID，已跳过 Google 登录插件注册')
    return
  }

  app.use(GoogleSignInPlugin, { clientId })
}
