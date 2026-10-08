// LINK https://utc.yuy1n.io/features/highlight.html#options-1
// TODO build error, did not figure out which plugin conflict
// import '~console/theme-detect'

import { createApp } from 'vue'

import { setupStorageMigrations } from '@/utils/persistent/migrate'
import { App, bootstrapApp, renderBootstrapFailure, reportBootstrapProblems } from './App'
import { reportRuntimeFatal } from './App/src/runtime-error'
// unocss
import 'virtual:uno.css'
// iconify
import 'virtual:icon/bundle'
// LINK https://github.com/unocss/unocss/issues/2127
import '@unocss/reset/tailwind-compat.css'
// animate
import 'animate.css'
// custom scss
import './assets/styles/main.scss'

(async () => {
  const app = createApp(App)

  // ---- 运行时未捕获错误 ⇒ 全局覆盖层（2026-10-08）----
  //
  // 为什么需要它：启动序列早有容错（bootstrap 三档 + renderBootstrapFailure），但**挂载之后**的
  // 未捕获错误没人管 —— 2026-10-08 实测：空库 ⇒ `/security/sign/aes-key` 返回 50000 ⇒ 响应解密
  // 链路抛 `sa(...).create is not a function` ⇒ 页面「壳在、内容空」，除了浏览器控制台没有任何提示。
  //
  // 三条线各管一段（组件内外都要覆盖）：
  //   app.config.errorHandler  → 组件渲染 / 生命周期里抛出的
  //   unhandledrejection       → 没人 catch 的 Promise（axios 链路最常走这条）
  //   window.onerror           → 同步脚本错误
  //
  // 那个 `event.error` 判断不是多余的：**资源加载失败**（`<img>`/`<script>` 404，例如开着 DevTools
  // 时浏览器去请求 `*.js.map`）同样会触发 `error` 事件，但那是噪音，不该弹全屏错误。
  app.config.errorHandler = (err, _instance, info) => reportRuntimeFatal(err, `vue:${info}`)

  window.addEventListener('unhandledrejection', (event) => {
    reportRuntimeFatal(event.reason, 'unhandledrejection')
  })

  window.addEventListener('error', (event) => {
    if (event.error !== undefined && event.error !== null)
      reportRuntimeFatal(event.error, 'window.onerror')
  })

  setupStorageMigrations()

  // 这一步**不抛异常**：失败都变成返回值。关键步挂了就显示错误屏（不 mount），可降级步挂了照常
  // 进页面并提示 —— 原先这里是一句 `await setupApp(app)`，任何一步抛出都会让 mount 永不执行，
  // 用户只看到一屏 loading、原因只在控制台（留档 V4 / architecture-todo 的「前端启动序列没有容错」）。
  const result = await bootstrapApp(app)

  if (result.fatal !== undefined) {
    renderBootstrapFailure(result.fatal)
    return
  }

  app.mount('#app')

  // 提示必须在 mount 之后 —— naive-ui 的 provider 在 App.vue 里（`window.$message` 那时才存在）
  reportBootstrapProblems(result.problems)
})()
