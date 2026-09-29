<script lang="ts" setup>
import { useStoreCompForceQuit } from '@/store/modules/component/comp-force-quit'

defineOptions({
  name: 'TheAppGlobalComponents',
})

const appForceQuit = useStoreCompForceQuit()
</script>

<template>
  <WForceQuit v-if="appForceQuit.getShow" />
</template>
