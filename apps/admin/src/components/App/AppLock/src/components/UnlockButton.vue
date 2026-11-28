<script lang="ts" setup>
import { useAppStoreLock } from '@/store/modules/app/app-lock'

defineOptions({
  name: 'WAppLockUnlockButton',
})

const appStoreLock = useAppStoreLock()

async function onUnlock() {
  try {
    await appStoreLock.unLock()
  } catch (error) {
    // D4：失败留在锁屏页；default / idle 没有可展示的口径，至少别抛成未处理 rejection
    console.error('[app-lock] unlock failed', error)
  }
}
</script>

<template>
  <!-- data-testid：锁屏页唯一的解锁按钮（锁屏闭环用例点击它回到原路由） -->
  <WIconButton
    :icon-props="{ icon: 'mdi:lock-open-variant-outline', height: 24 }"
    :button-props="{
      testId: 'lock-unlock-btn',
      disabled: appStoreLock.getLoading,
      onClick: onUnlock,
      class: 'absolute left-1/2 top-8 z-20 -translate-x-1/2',
    }"
  />
</template>
