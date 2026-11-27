<script lang="ts" setup generic="T">
import { computed } from 'vue'
import { useForm } from '@/components/UI/Form'
import { useTableContext } from '../hooks/useTableContext'

const { tablePropsCtx, apiListParams, onApiQuery, onApiReset } = useTableContext<T>()

const { getProps: tableProps } = tablePropsCtx

const getFormProps = computed(() => ({
  ...tableProps.value?.queryFormProps,
  disabled: tableProps.value.loading,
}))

const [register] = useForm<T>(getFormProps)
</script>

<template>
  <!-- @vue-generic {T} -->
  <!-- data-testid：查询表单根（E2E 取其中第一个 input = 首个筛选字段，如 userName）。
       WForm 有多根节点（n-form + dialog），attr 不会透传，testid 必须落在包装 div 上。 -->
  <div data-testid="table-query-form">
    <WForm :model="apiListParams.query" @hook="register" @query="onApiQuery" @reset="onApiReset" />
  </div>
</template>
