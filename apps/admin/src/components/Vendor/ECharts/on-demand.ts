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

// ⚠️ 这里**不再**把 echarts 挂到 `window.echarts` 上（2026-09-29）：echarts 自己用 **UMD 全局**
// 声明了 `Window.echarts`，而本文件用的是 `echarts/core`（ESM）—— 两边各有一套私有 `_setting`，
// **类型身份互不兼容**，赋值只能靠断言糊过去，而那条断言正是「全局关掉 `skipLibCheck`」过不去的
// 那道墙（见 VERIFICATION-LOG 的 V12）。改成让消费方直接 `import echarts from './on-demand'`：
// 全局没了、断言没了、双身份也没了（顺带与「不许隐式全局」的方向一致）。
export default echarts
