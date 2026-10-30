<script lang="ts" setup>
import type { SystemMenu, SystemRole } from '@walnut/api-types'
import { computed } from 'vue'
import { roleAPI } from '@/api/system/role'
import { useCRUD } from '@/components/Advanced/CRUD'
import { WTablePresetCreatedAtColumn, WTablePresetOrderColumn, WTablePresetStatusColumn, WTablePresetUpdatedAtColumn } from '@/components/UI/Table/src/utils/presetColumns'
import { AppConstRoles } from '@/const/app'
import { AppConstMenuType } from '@/const/menu'
import { useDeptTree } from '@/hooks/core/useDeptTree'
import { useAppI18n } from '@/locales'

import { useMenuTree } from './useMenuTree'

defineOptions({
  name: 'Role',
})

const { t } = useAppI18n()

// locale unique key
const key = 'role'
const keyField = 'id'

const { getLeftMenu } = useMenuTree()
// 数据权限二期批 2：CUSTOM(2) 档位的部门勾选树
const { getDeptTree } = useDeptTree()

const [
  register,
  {
    onOpenCreateForm,
    onReadAndOpenUpdateForm,
    onGetActionType,
    onApiList,
  },
] = useCRUD<SystemRole>({
  baseAPI: roleAPI,

  strictFormData: true,

  safeForm: true,
  safeFormFeedback: true,
  safeFormKey: key,
  safeFormUnwantedFields: ['status'],

  tableProps: {
    localeUniqueKey: key,
    rowKey: row => row[keyField]!,
    striped: true,
    bordered: true,
    singleLine: false,

    headerLeftBuiltInActions: [
      {
        _builtInType: 'create',
        onPresetClick() {
          onOpenCreateForm()
        },
      },
    ],

    auths: {
      list: `system:${key}:list`,
      create: `system:${key}:create`,
      read: `system:${key}:read`,
      update: `system:${key}:update`,
    },

    queryFormProps: {
      localeUniqueKey: key,
      localeWithTable: true,
      span: 6,
      showFeedback: false,
      labelWidth: 120,
      // query form schemas
      schemas: [
        {
          type: 'Base:Input',
          formProp: {
            path: 'roleName',
          },
          componentProp: {
            clearable: true,
            onKeyupEnter() {
              onApiList()
            },
          },
        },

        {
          type: 'Extend:Query',
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
        key: 'roleName',
        width: 200,
        sorter: {
          multiple: 5,
          compare: 'default',
        },
      },

      {
        key: 'description',
        width: 200,
        ellipsis: {
          tooltip: true,
        },
      },

      {
        key: 'usersCount',
        width: 120,
      },

      {
        ...WTablePresetOrderColumn,
        defaultSortOrder: 'ascend',
        sorter: {
          multiple: 4,
          compare: 'default',
        },
      },

      {
        ...WTablePresetStatusColumn,
        sorter: {
          multiple: 3,
          compare: 'default',
        },
      },

      {
        ...WTablePresetCreatedAtColumn,
        sorter: {
          multiple: 2,
          compare: 'default',
        },
      },

      {
        ...WTablePresetUpdatedAtColumn,
        sorter: {
          multiple: 1,
          compare: 'default',
        },
      },

      {
        key: 'action',
        width: 160,
        extendType: 'action',
        fixed: 'right',
        columnBuiltInActions: [
          {
            _builtInType: 'read',
            _show: row => row.roleName !== AppConstRoles.ROOT,
            async onPresetClick(rowData) {
              await onReadAndOpenUpdateForm(rowData[keyField]!)
            },
          },
        ],
      },
    ],
  },

  formProps: {
    localeUniqueKey: key,
    localeWithTable: true,
    dialogPreset: 'drawer',
    baseRules: true,
    labelWidth: 140,
    xGap: 0,
    // create/update form schemas
    schemas: [
      {
        type: 'Base:Input',
        formProp: {
          path: 'roleName',
          labelHelpMessage: true,
        },
        componentProp: {
          clearable: true,
          disabled: computed((): boolean => onGetActionType().value === 'update'),
        },
      },
      {
        type: 'Base:Input',
        formProp: {
          path: 'description',
        },
        componentProp: {
          clearable: true,
          type: 'textarea',
        },
      },
      {
        type: 'Base:InputNumber',
        formProp: {
          path: 'order',
        },
        componentProp: {
          clearable: true,
          defaultValue: 0,
        },
      },
      {
        // 数据权限二期六档（docs/plans/data-scope-phase2-3-plan.md §1.1）：
        // 1=ALL 2=CUSTOM(部门清单) 3=DEPT 4=DEPT_AND_CHILD 5=SELF 6=DEPT_OR_SELF。
        // 值集与后端 WalnutAdminConstDataScope 同源；CUSTOM 的部门清单即下方 deptIds。
        type: 'Base:Select',
        formProp: {
          path: 'dataScope',
          labelHelpMessage: true,
        },
        componentProp: {
          defaultValue: 1,
          options: [
            { label: t('table.role.dataScope.all'), value: 1 },
            { label: t('table.role.dataScope.custom'), value: 2 },
            { label: t('table.role.dataScope.dept'), value: 3 },
            { label: t('table.role.dataScope.deptAndChild'), value: 4 },
            { label: t('table.role.dataScope.self'), value: 5 },
            { label: t('table.role.dataScope.deptOrSelf'), value: 6 },
          ],
        },
      },
      {
        // CUSTOM(2) 的部门清单：只在选中 CUSTOM 时显示（visibleProp.vIf 读 formData）。
        // 提交到角色 create/update 的 deptIds，后端整组替换 sys_role_dept junction。
        // 非 CUSTOM 时该 schema 仍参与 strictFormData 的字段收集，但值保持上次勾选
        // （后端对非 CUSTOM 角色无执行语义，切回 CUSTOM 时可直接复用）。
        type: 'Base:TreeSelect',
        formProp: {
          path: 'deptIds',
          labelHelpMessage: true,
        },
        visibleProp: {
          vIf: ({ formData }) => (formData as { dataScope?: number }).dataScope === 2,
        },
        componentProp: {
          multiple: true,
          defaultValue: [],
          treeSelectProps: {
            options: getDeptTree as unknown as any[],
            keyField: 'id',
            labelField: 'deptName',
            placeholder: t('table.role.deptIds.placeholder'),
          },
        },
      },
      {
        type: 'Business:Dict',
        formProp: {
          path: 'status',
        },
        componentProp: {
          dictType: 'sys_shared_status',
          renderType: 'radio',
          defaultValue: true,
          componentProps: {
            button: true,
            valueType: 'boolean',
          },
        },
      },
      {
        type: 'Base:Tree',
        formProp: {
          path: 'menus',
          rule: false,
          labelHelpMessage: true,
        },
        componentProp: {
          presetPrefixIcon: true,
          toolbar: true,
          multiple: true,
          maxHeight: '600px',
          defaultValue: [],

          treeProps: {
            data: getLeftMenu as unknown as any[],
            blockLine: true,
            blockNode: true,
            keyField,
            labelField: 'title',
            renderLabel: ({ option }) =>
              option.type === AppConstMenuType.ELEMENT
                ? ((option as unknown as SystemMenu).meta.permission as string)
                : (option.title as string),
          },
        },
      },
    ],
  },
})
</script>

<template>
  <div>
    <!-- @vue-generic {SystemRole} -->
    <WCRUD @hook="register" />
  </div>
</template>
