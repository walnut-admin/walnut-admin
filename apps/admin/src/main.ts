// LINK https://utc.yuy1n.io/features/highlight.html#options-1
// TODO build error, did not figure out which plugin conflict
// import '~console/theme-detect'

import { createApp } from 'vue'

import { setupStorageMigrations } from '@/utils/persistent/migrate'
import { App, bootstrapApp, renderBootstrapFailure, reportBootstrapProblems } from './App'
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
