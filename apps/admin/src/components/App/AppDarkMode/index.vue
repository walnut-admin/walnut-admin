<script lang="ts" setup>
import { toggleDark } from '@/hooks/app/useAppDark'

defineOptions({
  name: 'AppDarkMode',
})
</script>

<template>
  <WIcon icon="mdi:theme-light-dark" width="28" @click="toggleDark" />
</template>
