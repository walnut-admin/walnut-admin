<script lang="ts" setup>
import { useAppStoreLock } from '@/store/modules/app/app-lock'

defineOptions({
  name: 'WAppLockUnlockButton',
})

const appStoreLock = useAppStoreLock()

async function onUnlock() {
  await appStoreLock.unLock()
}
</script>

<template>
  <!-- data-testid：锁屏页唯一的解锁按钮（锁屏闭环用例点击它回到原路由） -->
  <WIconButton
    :icon-props="{ icon: 'mdi:lock-open-variant-outline', height: 24 }"
    :button-props="{ testId: 'lock-unlock-btn', disabled: appStoreLock.getLoading, onClick: onUnlock, class: 'absolute left-1/2 top-8 -translate-x-1/2' }"
  />
</template>
