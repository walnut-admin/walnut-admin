import type { Ref } from 'vue'
import { readonly, ref } from 'vue'

/**
 * 运行时致命错误的**唯一真源**（bootstrap 之后、页面跑起来时发生的未捕获错误）。
 *
 * ## 为什么不用 pinia store
 * 这里要接的是「**任何**时刻的未捕获错误」——包括 pinia 自己还没装好、router 还没建好的那一段。
 * 用 store 就等于把「上报错误」这件事依赖在「可能已经坏掉的启动序列」上。所以：
 * **只用模块级 `ref`**，谁都能 import，谁都不依赖。
 *
 * ## 与 `renderBootstrapFailure` 的分工
 * - 启动期（**mount 之前**，store/i18n/router 那几步）⇒ `renderBootstrapFailure`：纯 DOM 换掉 splash。
 *   那时候 Vue 还没挂载，只能用 DOM。
 * - 挂载之后 ⇒ 这个模块 + `RuntimeErrorOverlay` 组件：**不换 URL、不依赖路由**（用户 2026-10-08 指出：
 *   `sign` 失败时 router 还没创建，所以「跳 /500」这条路根本走不通）。
 */
export interface RuntimeFatalError {
  /** 人话摘要（给用户看的第一行） */
  title: string
  /** 技术细节：错误消息 / 错误码 / requestId / 堆栈（折叠展示） */
  detail: string
  /** 上报时间（毫秒），用于「点重试前先看看是不是旧的」这类判断 */
  at: number
}

/** 当前展示中的致命错误；`null` 表示没有 */
const current = ref<RuntimeFatalError | null>(null)

/** 只读视图：组件里 watch/读取它；写入一律走 `reportRuntimeFatal` */
export const runtimeFatalError: Readonly<Ref<RuntimeFatalError | null>> = readonly(current)

/** 同一个错误连报多次时只显示第一条（避免覆盖层内容被后来的噪音冲掉） */
let reportedOnce = false

/**
 * 上报一个致命错误。**幂等**：已经报过就不再替换（第一条通常最接近根因）。
 * 同时始终往控制台打完整信息 —— 覆盖层只给人看摘要，排障看控制台。
 */
export function reportRuntimeFatal(error: unknown, context: string): void {
  console.error(`[runtime-fatal] ${context}`, error)

  if (reportedOnce)
    return
  reportedOnce = true

  current.value = {
    title: '页面遇到无法恢复的错误',
    detail: formatDetail(error, context),
    at: Date.now(),
  }
}

/** 供排障/测试用：清空状态（例如重试前） */
export function clearRuntimeFatal(): void {
  reportedOnce = false
  current.value = null
}

function formatDetail(error: unknown, context: string): string {
  const lines: string[] = [`位置：${context}`]

  if (error instanceof Error) {
    lines.push(`类型：${error.name}`, `消息：${error.message}`)
    if (error.stack)
      lines.push('', error.stack)
  }
  else if (typeof error === 'object' && error !== null) {
    // axios 错误里最有用的是「HTTP 状态 + 后端返回的 message/requestId」
    const e = error as Record<string, unknown>
    const response = e.response as { status?: number, data?: unknown } | undefined
    if (response?.status !== undefined)
      lines.push(`HTTP：${response.status}`)
    if (response?.data !== undefined) {
      try {
        lines.push(`响应：${JSON.stringify(response.data).slice(0, 800)}`)
      }
      catch {
        lines.push('响应：（无法序列化）')
      }
    }
    try {
      lines.push('', JSON.stringify(error, null, 2).slice(0, 1200))
    }
    catch {
      lines.push('（无法序列化该错误对象）')
    }
  }
  else {
    lines.push(`原始值：${String(error)}`)
  }

  return lines.join('\n')
}
