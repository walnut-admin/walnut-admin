<script lang="ts" setup>
import { useGlobalAsyncComponent } from '@walnut/client/hooks/component/useGlobalAsyncComponent'

defineOptions({
  name: 'WAppGlobalComponents',
})

const compStoreCapJS = useStoreCompCapJS()
const compStoreVerifyAuth = useStoreCompVerifyAuth()

const cap = useGlobalAsyncComponent(
  computed(() => compStoreCapJS.getShow),
  { unmountDelay: 350 },
)

const verifyAuth = useGlobalAsyncComponent(
  computed(() => compStoreVerifyAuth.getShow),
  { unmountDelay: 350 },
)
</script>

<template>
  <div v-if="cap.mounted" v-show="cap.visible">
    <WCap />
  </div>
  <div v-if="verifyAuth.mounted" v-show="verifyAuth.visible">
    <WVerifyAuth />
  </div>
</template>
