import type { Fn } from '@walnut/types/universal'
import type { ButtonProps } from 'naive-ui'
import type { VNodeChild } from 'vue'

export { default } from './index.vue'

// TODO 000
export interface ICompUIButtonProps extends /* @vue-ignore */ ButtonProps {
  icon?: string
  auth?: string
  title?: string
  textProp?: string | Fn<VNodeChild>
  debounce?: number
  onClick?: (e: MouseEvent) => void | Promise<void>
  /**
   * E2E 的稳定选择器（落在真实 `<button>` 上）。
   * 用显式 prop 而不是让 `data-*` 从 schema 里 fallthrough：`v-bind="item.componentProp"`
   * 的类型是固定接口，多写的键过不了类型检查。
   */
  testId?: string
}
