import type { Ref } from 'vue'
import { readonly, ref } from 'vue'

/**
 * 运行时错误的**唯一真源**（bootstrap 之后、页面跑起来时发生的未捕获错误）。
 *
 * ## 为什么不用 pinia store
 * 这里要接的是「**任何**时刻的未捕获错误」——包括 pinia 自己还没装好、router 还没建好的那一段。
 * 用 store 就等于把「上报错误」这件事依赖在「可能已经坏掉的启动序列」上。所以：
 * **只用模块级 `ref`**，谁都能 import，谁都不依赖。
 *
 * ## 与 `renderBootstrapFailure` 的分工
 * - 启动期（**mount 之前**，store/i18n/router 那几步）⇒ `renderBootstrapFailure`：纯 DOM 换掉 splash。
 *   那时候 Vue 还没挂载，只能用 DOM。
 * - 挂载之后 ⇒ 本模块：**只进控制台，不面向用户渲染**（2026-11-27 所有者拍板：任何时刻都不给
 *   用户弹此类弹窗——原覆盖层触发面过宽，流程控制类 rejection 也被糊成「无法恢复的错误」；
 *   `RuntimeErrorOverlay` 组件自此不再有数据源，`runtimeFatalError` 恒为 null）。
 */
export interface RuntimeFatalError {
  /** 人话摘要（给用户看的第一行） */
  title: string
  /** 技术细节：错误消息 / 错误码 / requestId / 堆栈（折叠展示） */
  detail: string
  /** 上报时间（毫秒），用于「点重试前先看看是不是旧的」这类判断 */
  at: number
}

/** 恒为 `null`（2026-11-27 起运行时错误不再进入渲染）；保留类型给 `RuntimeErrorOverlay` */
export const runtimeFatalError: Readonly<Ref<RuntimeFatalError | null>> = readonly(ref(null))

/**
 * 上报一个运行时错误。**只进控制台，不再面向用户渲染**（2026-11-27 所有者拍板：
 * 「任何时刻都不应该有类似的弹窗会弹出给用户」—— 此前的全屏覆盖层触发面过宽，
 * 流程控制类 rejection（如 40114 的 `MFA Required`）也会把页面糊成「无法恢复的错误」）。
 *
 * 诊断信息一条不少：`console.error` 打完整上下文与堆栈，排障看控制台 / E2E 日志。
 */
export function reportRuntimeFatal(error: unknown, context: string): void {
  console.error(`[runtime-fatal] ${context}`, error)
}
