<script lang="ts" setup>
import { useAppRouter } from '@/router/index'
import { useAppStoreLock } from '@/store/modules/app/app-lock'

defineOptions({
  name: 'AppLock',
})

const appStoreLock = useAppStoreLock()
const { currentRoute } = useAppRouter()

async function onLock() {
  await appStoreLock.lock(currentRoute)
}
</script>

<template>
  <!-- data-testid：旅程用例触发锁屏的唯一入口（header 右侧的锁图标） -->
  <span data-testid="lock-trigger" class="inline-flex cursor-pointer" @click="onLock">
    <WIcon icon="mdi:lock-outline" height="28" :disabled="appStoreLock.getLoading" />
  </span>
</template>
