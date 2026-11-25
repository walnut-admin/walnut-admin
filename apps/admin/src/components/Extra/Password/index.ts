export { default } from './index.vue'

export interface ICompExtraPasswordProps {
  maxlength?: number
  minlength?: number
  placeholder?: string
  progress?: boolean
  capslock?: boolean
  onSubmit?: () => Promise<void>
  /**
   * 透传给内部 `n-input` 的 `input-props`（落在真实 `<input>` 元素上）。
   * 用途：E2E 的 `data-testid` 等稳定选择器 —— 这个组件的根节点是包裹层，
   * 直接写在组件上的 `data-*` 只会落到 `<div>` 上，点不到输入框。
   */
  inputProps?: Record<string, string>
}
