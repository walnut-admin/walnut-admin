<script lang="ts" setup>
import type { ICompUIDynamicTagsProps } from '.'
import { NDynamicTags } from 'naive-ui'

defineOptions({
  name: 'WCompUIDynamicTags',
})

defineProps<ICompUIDynamicTagsProps>()
</script>

<template>
  <NDynamicTags />
</template>
