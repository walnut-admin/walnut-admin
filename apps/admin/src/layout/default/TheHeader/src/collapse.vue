<script lang="ts" setup>
import { useAppStoreAdapter } from '@/store/modules/app/app-adapter'
import { useAppStoreMenu } from '@/store/modules/app/app-menu'
import { useAppStoreSettingDev } from '@/store/modules/setting/setting-dev'

const appStoreSettingDev = useAppStoreSettingDev()
const appStoreMenu = useAppStoreMenu()
const appStoreAdapter = useAppStoreAdapter()

function onClick() {
  if (appStoreAdapter.isMobile) {
    appStoreMenu.setShowAside(!appStoreMenu.getShowAside)
    appStoreMenu.setCollapse(false)
  }
  else {
    appStoreMenu.setCollapse(!appStoreMenu.getCollapse)
  }
}
</script>

<template>
  <WTransition appear transition-name="slide-up">
    <WIcon
      v-if="appStoreSettingDev.getMenuCollapseIconStatus"
      :icon="
        appStoreMenu.getCollapse
          ? 'ant-design:menu-fold-outlined'
          : 'ant-design:menu-unfold-outlined'
      "
      width="24"
      class="cursor-pointer"
      @click="onClick"
    />
  </WTransition>
</template>
