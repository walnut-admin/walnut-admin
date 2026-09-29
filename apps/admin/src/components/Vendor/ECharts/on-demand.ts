import { BarChart, LineChart, PieChart } from 'echarts/charts'
import {
  DatasetComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TitleComponent,
  ToolboxComponent,
  TooltipComponent,
} from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([
  LineChart,
  BarChart,
  PieChart,
  GridComponent,
  TitleComponent,
  TooltipComponent,
  LegendComponent,
  DatasetComponent,
  DataZoomComponent,
  ToolboxComponent,
  CanvasRenderer,
])

// ⚠️ 这里必须断言：echarts 自己用 **UMD 全局**声明了 `Window.echarts`，而本文件给它的是
// `echarts/core`（ESM）的模块对象 —— 两边各有一套私有 `_setting`，身份互不兼容（实测：删掉我们
// 自己的 `Window.echarts` 声明，这条赋值**照样**报 TS2322 ⇒ 是上游形状问题）。
// `types/window.d.ts` 里按 ESM 声明（这样 `window.echarts.init(...)` 有类型），赋值点在这里收口。
window.echarts = echarts as typeof window.echarts

export default echarts
