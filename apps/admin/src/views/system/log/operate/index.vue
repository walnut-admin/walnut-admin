<script lang="ts" setup>
import type { Recordable } from 'easy-fns-ts'
import type { IModels } from '@/api/models'
import { computed, ref } from 'vue'
import { getLogOperateDeviceAPI, getLogOperateSnapshotAPI, logOperateAPI } from '@/api/system/log'
import { useCRUD } from '@/components/Advanced/CRUD'
import { useForm } from '@/components/UI/Form'
import { useAppI18n } from '@/locales/index'
import { logOperateFormSchema } from './schema'

defineOptions({
  name: 'LogOperate',
})

const { t } = useAppI18n()

const auths = {
  getSnapshot: 'system:log:operate:getSnapshot',
  getDevice: 'system:log:operate:getDevice',
}

// locale unique key
const localeKey = 'log.operate'
// auth key
const authKey = 'log:operate'
const keyField = '_id'

const showMerge = ref(false)
const mergeLoading = ref(false)
const mergeData = ref<{
  snapshotBefore?: string
  snapshotAfter?: string
}>({})

/**
 * 后端的快照是**对象**（`IResponseData.System.LogOperate.Snapshot` 里是 `Recordable`，服务端就是
 * `cloneDeep` 出来的文档），而 `WCodeMirrorMerge` 要的是**文本**。这里统一序列化 —— 顺带修掉一处
 * 一直没被发现的运行时错配：以前那句 `mergeData.value = snapshot` 把对象塞给了文本 prop。
 * （类型上之所以一直没报，是因为 `response.d.ts` 里 `Recordable` **忘了 import**、被 `skipLibCheck`
 * 静默变成 `any`；那条路 2026-09-29 由 `pnpm lint:dts` 堵上了。）
 */
function toSnapshotText(value: Recordable | undefined): string {
  if (value === undefined)
    return ''
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2)
}

const deviceData = ref<IModels.SystemDevice>({})

const [registerDevice, { onOpen }] = useForm<IModels.SystemDevice>({
  dialogPreset: 'modal',
  baseRules: false,
  labelWidth: 120,
  xGap: 0,

  descriptionProps: {
    bordered: true,
    column: 2,
    colon: true,
  },

  dialogProps: {
    defaultButton: false,
    width: '40%',
    closable: true,
    autoFocus: false,
    fullscreen: false,
    title: computed(() => t('app.base.device') + t('app.base.detail')),
  },

  schemas: [
    {
      type: 'Base:Input',
      formProp: {
        path: 'deviceId',
      },
      descriptionProp: {
        copy: true,
      },
    },

    {
      type: 'Base:Input',
      formProp: {
        path: 'deviceName',
      },
      descriptionProp: {
        copy: true,
      },
    },
  ],
})

const [
  register,
  {
    onReadAndOpenUpdateForm,
    onApiList,
    onGetApiListParams,
    onGetFormData,
  },
] = useCRUD<IModels.SystemLogOperate>({
  baseAPI: logOperateAPI,

  tableProps: {
    localeUniqueKey: localeKey,
    rowKey: row => row[keyField]!,
    striped: true,
    bordered: true,
    singleLine: false,

    auths: {
      list: `system:${authKey}:list`,
      read: `system:${authKey}:read`,
    },

    queryFormProps: {
      localeUniqueKey: localeKey,
      localeWithTable: true,
      span: 6,
      showFeedback: false,
      labelWidth: 80,
      yGap: 10,
      // query form schemas
      schemas: [
        {
          type: 'Base:Input',
          formProp: {
            path: 'title',
          },
          componentProp: {
            clearable: true,
            onKeyupEnter() {
              onApiList()
            },
          },
        },

        {
          type: 'Base:Input',
          formProp: {
            path: 'userName',
          },
          componentProp: {
            clearable: true,
            onKeyupEnter() {
              onApiList()
            },
          },
        },

        {
          type: 'Base:Input',
          formProp: {
            path: 'ip',
          },
          componentProp: {
            clearable: true,
            onKeyupEnter() {
              onApiList()
            },
          },
        },

        {
          type: 'Base:DatePicker',
          formProp: {
            path: 'operatedAt',
          },
          componentProp: {
            type: 'daterange',
            clearable: true,
            format: 'yyyy-MM-dd',
            valueFormat: 'yyyy-MM-dd',
            onUpdateFormattedValue(v: string) {
              const queryFormData = onGetApiListParams()
              queryFormData.value.query = Object.assign(queryFormData.value.query!, { operatedAt: v })
            },
          },
        },

        {
          type: 'Extend:Query',
          componentProp: {
            foldable: true,
            defaultFold: true,
            countToFold: 2,
          },
        },
      ],
    },

    // table columns
    columns: [
      {
        key: 'index',
        extendType: 'index',
        fixed: 'left',
      },

      {
        key: 'title',
        width: 100,
        sorter: {
          multiple: 1,
          compare: 'default',
        },
      },

      {
        key: 'actionType',
        width: 140,
        extendType: 'dict',
        dictType: 'sys_action_type',
        sorter: {
          multiple: 2,
          compare: 'default',
        },
        filter: true,

        // use dict name as column title
        useDictNameAsTitle: true,
      },

      {
        key: 'operation',
        width: 140,
        extendType: 'dict',
        dictType: 'sys_operate_type',
        sorter: {
          multiple: 3,
          compare: 'default',
        },
        filter: true,

        // use dict name as column title
        useDictNameAsTitle: true,
      },

      {
        key: 'method',
        width: 120,
        sorter: {
          multiple: 4,
          compare: 'default',
        },
        filter: true,
        filterOptions: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(i => ({
          value: i,
          label: i,
        })),
      },

      {
        key: 'userName',
        width: 120,
        sorter: {
          multiple: 5,
          compare: 'default',
        },
      },

      {
        key: 'ip',
        width: 120,
      },

      {
        key: 'success',
        width: 120,
        sorter: {
          multiple: 6,
          compare: 'default',
        },
        extendType: 'dict',
        dictType: 'sys_shared_success',
        filter: true,
        filterMultiple: false,
      },

      {
        key: 'operatedAt',
        width: 200,
        sorter: {
          multiple: 1,
          compare: 'default',
        },
        defaultSortOrder: 'descend',
      },

      {
        key: 'action',
        width: 80,
        extendType: 'action',
        fixed: 'right',
        columnBuiltInActions: [
          {
            _builtInType: 'detail',
            async onPresetClick(rowData) {
              await onReadAndOpenUpdateForm(rowData[keyField]!)
            },
          },
        ],
      },
    ],
  },

  formProps: {
    localeUniqueKey: localeKey,
    localeWithTable: true,
    dialogPreset: 'drawer',
    baseRules: true,
    labelWidth: 140,
    xGap: 0,

    descriptionProps: {
      bordered: true,
      column: 2,
      colon: true,
    },

    dialogProps: {
      defaultButton: false,
      width: '40%',
      closable: true,
      autoFocus: false,

      footerButtons: [
        {
          textProp: computed(() => t('sys.log.operate.getDevice')),
          auth: auths.getDevice,
          type: 'primary',
          debounce: 300,
          async onClick() {
            try {
              const formData = onGetFormData()
              const device = await getLogOperateDeviceAPI(formData.value._id!)
              deviceData.value = device
              onOpen()
            }
            catch (e) {
              console.error(e)
            }
          },
        },
        {
          textProp: computed(() => t('sys.log.operate.getSnapshot')),
          auth: auths.getSnapshot,
          type: 'info',
          debounce: 300,
          loading: computed(() => mergeLoading.value),
          disabled: computed((): boolean => {
            const formData = onGetFormData()
            return formData.value.actionType !== 'UPDATE'
          }),
          async onClick() {
            mergeLoading.value = true
            try {
              const formData = onGetFormData()
              const snapshot = await getLogOperateSnapshotAPI(formData.value._id!)
              mergeData.value = {
                snapshotBefore: toSnapshotText(snapshot.snapshotBefore),
                snapshotAfter: toSnapshotText(snapshot.snapshotAfter),
              }
              showMerge.value = true
            }
            finally {
              mergeLoading.value = false
            }
          },
        },
      ],
    },

    schemas: logOperateFormSchema,
  },
})
</script>

<template>
  <div>
    <!-- @vue-generic {IModels.SystemLogOperate} -->
    <WCRUD @hook="register" />

    <WAppAuthorize :value="auths.getSnapshot">
      <WModal
        v-model:show="showMerge"
        width="80%"
        :fullscreen="false"
        :default-button="false"
        :title="$t('app.base.compare')"
        display-directive="show"
        :loading="mergeLoading"
      >
        <WCodeMirrorMerge :after="mergeData.snapshotAfter" :before="mergeData.snapshotBefore" />
      </WModal>
    </WAppAuthorize>

    <WAppAuthorize :value="auths.getDevice">
      <!-- @vue-generic {IModels.SystemDevice} -->
      <WForm :model="deviceData" @hook="registerDevice" />
    </WAppAuthorize>
  </div>
</template>
