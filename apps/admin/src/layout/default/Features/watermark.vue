<script lang="ts" setup>
import { useAppStoreSettingScope } from '@/store/modules/setting/setting-scope'

defineOptions({
  name: 'TheAppWatermark',
})

const appSettingScope = useAppStoreSettingScope()
</script>

<template>
  <n-watermark
    v-bind="appSettingScope.getWatermarkConfig($route)"
  />
</template>
