<script setup lang="ts">
import { runtimeFatalError } from '@/App/src/runtime-error'

/**
 * 运行时致命错误的**全屏覆盖层**。
 *
 * 为什么是覆盖层、而不是跳 `/500`：用户 2026-10-08 指出（并在代码里核实过）——`sign` 是 bootstrap
 * 第 5 步、`router` 是第 9 步，签名失败时**路由还不存在**，跳转这条路根本走不通；而且「不换 URL」
 * 还有个好处：刷新即重试，不需要用户理解发生了什么。
 *
 * 为什么纯 HTML + 内联样式、不用 naive-ui：走到这里说明运行时已经出过问题，组件库/provider 同样
 * 可能是坏的。与 `renderBootstrapFailure` 的取舍一致（那边更极端：连 Vue 都不用）。
 */
const retry = () => location.reload()
</script>

<template>
  <div
    v-if="runtimeFatalError"
    class="runtime-fatal"
    role="alertdialog"
    aria-modal="true"
    aria-labelledby="runtime-fatal-title"
  >
    <div class="runtime-fatal__card">
      <h1 id="runtime-fatal-title" class="runtime-fatal__title">
        {{ runtimeFatalError.title }}
      </h1>

      <p class="runtime-fatal__hint">
        已停止继续渲染，避免出现「界面在但点了没反应」的假象。常见原因：后端未就绪、数据库是空的、
        或者前后端版本对不上。可以重新加载试试；如果一直这样，把下面的详情发给我们。
      </p>

      <div class="runtime-fatal__actions">
        <button class="runtime-fatal__btn" type="button" @click="retry">
          重新加载
        </button>
      </div>

      <details class="runtime-fatal__details">
        <summary>技术细节</summary>
        <pre class="runtime-fatal__pre">{{ runtimeFatalError.detail }}</pre>
      </details>
    </div>
  </div>
</template>

<style scoped>
.runtime-fatal {
  position: fixed;
  inset: 0;
  z-index: 99999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgb(0 0 0 / 72%);
}

.runtime-fatal__card {
  width: min(880px, 100%);
  max-height: 86vh;
  overflow: auto;
  padding: 24px;
  border-radius: 12px;
  background: #1f1f1f;
  color: #f5f5f5;
  box-shadow: 0 12px 48px rgb(0 0 0 / 45%);
}

.runtime-fatal__title {
  margin: 0 0 12px;
  font-size: 20px;
  font-weight: 600;
  color: #ffb4b4;
}

.runtime-fatal__hint {
  margin: 0 0 16px;
  font-size: 14px;
  line-height: 1.7;
  color: #d0d0d0;
}

.runtime-fatal__actions {
  display: flex;
  gap: 12px;
  margin-bottom: 12px;
}

.runtime-fatal__btn {
  padding: 8px 20px;
  border: 0;
  border-radius: 6px;
  background: #0065cc;
  color: #fff;
  cursor: pointer;
}

.runtime-fatal__details summary {
  cursor: pointer;
  font-size: 13px;
  color: #9e9e9e;
}

.runtime-fatal__pre {
  max-height: 40vh;
  overflow: auto;
  margin: 8px 0 0;
  padding: 12px;
  border-radius: 8px;
  background: #151515;
  color: #ffb4b4;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
