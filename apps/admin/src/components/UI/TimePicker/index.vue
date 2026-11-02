<script lang="ts" setup>
import type { ICompUITimePickerProps } from '.'
import { NTimePicker } from 'naive-ui'

defineOptions({
  name: 'WCompUITimePicker',
})

defineProps<ICompUITimePickerProps>()
</script>

<template>
  <NTimePicker />
</template>
