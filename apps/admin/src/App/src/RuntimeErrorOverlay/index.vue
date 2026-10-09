<script lang="ts" setup>
import { useClipboard } from '@vueuse/core'
import { ref } from 'vue'
import { runtimeFatalError } from '@/App/src/runtime-error'
import { useAppI18n } from '@/locales/index'

/**
 * 运行时致命错误的**全屏覆盖层**。
 *
 * 为什么是覆盖层、而不是跳 `/500`：`sign` 是 bootstrap 第 5 步、`router` 是第 9 步 ——
 * 签名失败时路由**还不存在**，跳转这条路走不通；不换 URL 还有个好处：刷新即重试。
 *
 * 两处**刻意**的取舍（都不是随手写的）：
 * 1. **不用 naive-ui 的组件**（`n-button` 等）：走到这里是运行时致命错误，provider / 主题
 *    可能已经坏了，用它们等于让"错误界面"也依赖可能坏掉的东西。样式一律走 UnoCSS 原子类
 *    （与 `views/error/500` 同一套写法），只有一个原生 `<button>`。
 * 2. **文案走 i18n，但带内置退化文案**：本仓语言包唯一来源是后端（见 `locales/index.ts` 顶部），
 *    而"后端没起来 / 库是空的"恰恰是最常见的触发场景 —— 那时 `t()` 只会吐出 key 本身。
 *    所以这里先 `te()` 判断，没有就退到内置中文（否则错误屏上会显示 `app.error.title`）。
 */
defineOptions({
  name: 'AppRuntimeErrorOverlay',
})

const { t, te } = useAppI18n()
const { copy, copied, isSupported } = useClipboard({ source: () => runtimeFatalError.value?.detail ?? '' })

/** 有语言包就用语言包，没有就用内置文案（见文件头第 2 条） */
function tr(key: string, fallback: string): string {
  return te(key) ? t(key) : fallback
}

const retry = () => location.reload()

const showDetail = ref(false)
</script>

<template>
  <div
    v-if="runtimeFatalError"
    class="fixed inset-0 z-99999 flex items-center justify-center bg-black/70 p-6"
    role="alertdialog"
    aria-modal="true"
    :aria-label="tr('app.error.title', '页面遇到无法恢复的错误')"
  >
    <div class="max-h-[86vh] max-w-[880px] w-full overflow-auto rounded-xl bg-#1f1f1f p-6 text-white shadow-2xl">
      <h1 class="m-0 text-xl text-red-300 font-semibold">
        {{ tr('app.error.title', '页面遇到无法恢复的错误') }}
      </h1>

      <p class="mb-4 mt-3 text-sm text-white/75 leading-relaxed">
        {{ tr('app.error.hint', '已停止继续渲染，避免出现「界面在但点了没反应」的假象。常见原因：后端未就绪、数据库是空的、或前后端版本对不上。可以重新加载试试；若一直如此，把下面的技术细节发给我们。') }}
      </p>

      <div class="flex flex-wrap gap-3">
        <button
          type="button"
          class="cursor-pointer border-0 rounded-md bg-#0065cc px-5 py-2 text-white transition-colors hover:bg-#0057ad"
          @click="retry"
        >
          {{ tr('app.error.retry', '重新加载') }}
        </button>
        <button
          v-if="isSupported"
          type="button"
          class="cursor-pointer border border-white/25 rounded-md border-solid bg-transparent px-5 py-2 text-white/85 transition-colors hover:border-white/45"
          @click="copy()"
        >
          {{ copied ? tr('app.error.copied', '已复制') : tr('app.error.copy', '复制技术细节') }}
        </button>
      </div>

      <details class="mt-4" @toggle="showDetail = !showDetail">
        <summary class="cursor-pointer select-none text-xs text-white/45">
          {{ tr('app.error.detail', '技术细节') }}
        </summary>
        <pre
          v-if="showDetail"
          class="mt-2 max-h-[40vh] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-#151515 p-3 text-xs text-red-200"
        >{{ runtimeFatalError.detail }}</pre>
      </details>
    </div>
  </div>
</template>

<style lang="scss" scoped></style>
