<script lang="ts" setup>
import type { ICompUISwitchProps } from '.'
import { NSwitch } from 'naive-ui'

defineOptions({
  name: 'WCompUISwitch',
})

defineProps<ICompUISwitchProps>()
</script>

<template>
  <NSwitch>
    <template #checked>
      {{ checkedText }}
    </template>
    <template #unchecked>
      {{ uncheckedText }}
    </template>
  </NSwitch>
</template>
