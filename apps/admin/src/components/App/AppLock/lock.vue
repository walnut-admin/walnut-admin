<script lang="ts" setup>
import { useAppStoreAdapter } from '@/store/modules/app/app-adapter'
import { useAppStoreLock } from '@/store/modules/app/app-lock'
import LockDesktop from './src/desktop.vue'
import LockMobile from './src/mobile.vue'

defineOptions({
  name: 'Lock',
})

const appStoreAdapter = useAppStoreAdapter()
const appStoreLock = useAppStoreLock()
appStoreLock.unlockFromSocket()
</script>

<template>
  <!-- data-testid：锁屏页容器（socket LOCK → /lock 的落地判据；桌面/移动两种布局共用） -->
  <div class="h-screen w-screen overflow-hidden" data-testid="lock-page">
    <LockMobile v-if="appStoreAdapter.isMobile" />

    <LockDesktop v-else />
  </div>
</template>
