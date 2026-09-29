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
  <WIcon icon="mdi:lock-outline" height="28" :disabled="appStoreLock.getLoading" @click="onLock" />
</template>
