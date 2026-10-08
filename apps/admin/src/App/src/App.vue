<script lang="ts" setup>
import { onBeforeMount } from 'vue'
import { useAppStoreSettingBackend } from '@/store/modules/app/app-setting-backend'
import GlobalComponents from './compoent/global.vue'
import { useAppHooks } from './hooks'
import ThemeProvider from './naive/AppTheme.vue'
import MsgProvider from './naive/MsgProvider.vue'
import UIProvider from './naive/UIProvider.vue'
// 运行时致命错误的覆盖层：**刻意放在所有 Provider 之外**（见模板里的注释）
import { RuntimeErrorOverlay } from './RuntimeErrorOverlay'

// app hooks
useAppHooks()

// get public setting first
const appStoreBackendSettings = useAppStoreSettingBackend()

onBeforeMount(() => {
  appStoreBackendSettings.onInitPublicSettings()
})
</script>

<template>
  <!--
    覆盖层是**最外层**的兄弟节点：它只在我们自己捕获到运行时致命错误时出现（`v-if` 在组件内部）。
    为什么放在 Provider 之外：走到那一步说明运行时已经出过问题，UIProvider / ThemeProvider /
    MsgProvider 自己也可能坏掉——覆盖层依赖它们就等于「错误界面也被同一个错误带走了」。
    它是纯 HTML + 内联样式，不需要主题与消息上下文（与 `renderBootstrapFailure` 的取舍一致）。
  -->
  <RuntimeErrorOverlay />
  <UIProvider>
    <ThemeProvider>
      <MsgProvider>
        <GlobalComponents />
        <RouterView />
      </MsgProvider>
    </ThemeProvider>
  </UIProvider>
</template>
