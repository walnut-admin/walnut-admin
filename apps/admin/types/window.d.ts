// `@types/gtag.js` 是**全局类型包**（`declare var gtag` + `declare namespace Gtag`），没有模块导出；
// 而本工程的 `compilerOptions.types` 是空数组 ⇒ 它不会被自动加载 ⇒ 原来那行
// `import type * as Gtag from 'gtag.js'` 从来就没生效过（`Gtag.DataLayer` 一直静默是 any）。
/// <reference types="gtag.js" />
import type * as ECharts from 'echarts/core'
import type { DialogApiInjection } from 'naive-ui/lib/dialog/src/DialogProvider'
import type { LoadingBarApiInjection } from 'naive-ui/lib/loading-bar/src/LoadingBarProvider'
import type { MessageApiInjection } from 'naive-ui/lib/message/src/MessageProvider'
import type { NotificationApiInjection } from 'naive-ui/lib/notification/src/NotificationProvider'
import type { App } from 'vue'
import type {
  CLSMetric,
  INPMetric,
  LCPMetric,
  TTFBMetric,
} from 'web-vitals'

interface WebVitalsAPI {
  onCLS: (handler: (metric: CLSMetric) => void) => void
  onINP: (handler: (metric: INPMetric) => void) => void
  onLCP: (handler: (metric: LCPMetric) => void) => void
  onTTFB: (handler: (metric: TTFBMetric) => void) => void
}

declare global {
  interface Window {
    // Global vue app instance
    __APP__: App<Element>

    // capjs
    Cap: ICapInst
    CAP_CUSTOM_WASM_URL: string

    // naive relative
    $loadingBar: LoadingBarApiInjection
    $message: MessageApiInjection
    $notification: NotificationApiInjection
    $dialog: DialogApiInjection

    // echarts
    echarts: typeof ECharts

    // google analytics
    // ⚠️ 这里没有 `dataLayer`：`@types/gtag.js` 只声明了 `Gtag.Gtag` 与若干参数类型、**没有**
    // `DataLayer`；而仓里也**零处**读 `window.dataLayer` ⇒ 原来那条声明既解析不了、也没人用，
    // 于是被 `skipLibCheck` 藏成了一行静默 any（2026-09-29 由 `pnpm lint:dts` 抓出）。
    // 哪天真要用，按 GA4 的实际形状自己声明，别再从 `Gtag` 命名空间里找一个不存在的成员。
    gtag: Gtag.Gtag
    webVitals: WebVitalsAPI

    // baidu map
    BMapGL: any
    __onBMapLoaded?: () => void
    BMAP_ANCHOR_TOP_LEFT: number
  }
}
