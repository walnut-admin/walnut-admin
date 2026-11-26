<script lang="ts" setup>
import type { SystemUser } from '@walnut/api-types'
import { useState } from '@walnut/client/hooks/core/useState'
import { computed } from 'vue'
import { clearPasswordAPI, userAPI } from '@/api/system/user'
import { resetUserLockAPI } from '@/api/system/user_lock'
import { useCRUD } from '@/components/Advanced/CRUD'
import { useForm } from '@/components/UI/Form'
import { WTablePresetCreatedAtColumn, WTablePresetStatusColumn, WTablePresetUpdatedAtColumn } from '@/components/UI/Table/src/utils/presetColumns'
import { AppConstRoles } from '@/const/app'
import { useAppConfirm } from '@/hooks/component/useConfirm'
import { useAppMsgSuccess } from '@/hooks/component/useMessage'
import { useDeptTree } from '@/hooks/core/useDeptTree'
import { useAppI18n } from '@/locales/index'

import { useAppStoreUserAuth } from '@/store/modules/user/user-auth'

defineOptions({
  name: 'User',
})

const { t } = useAppI18n()
const userStoreAuth = useAppStoreUserAuth()

// 数据权限二期批 2：用户所属部门（sys_user.dept_id）
const { getDeptTree } = useDeptTree()

// locale unique key
const key = 'user'
const keyField = 'id'

const { stateRef: updatePasswordFormData, resetState: resetPasswordFormData } = useState({ userId: '', userName: '', newPassword: '' })

const [registerUpdatePassword, { onOpen }] = useForm<typeof updatePasswordFormData.value>({
  dialogPreset: 'modal',
  baseRules: true,
  labelWidth: 120,
  xGap: 0,

  dialogProps: {
    title: computed(() => t('dict.sys_operate_type.update_password')),
    width: '40%',
    onYes,
    onNo: (done) => {
      resetPasswordFormData()
      done()
    },
  },

  schemas: [
    {
      type: 'Extra:Password',
      formProp: {
        path: 'newPassword',
        label: computed(() => t('app.base.pass.new')),
        first: true,
        rule: [
          {
            key: 'newPassword',
            type: 'string',
            min: 8,
            max: 80,
            required: true,
            message: 'Password is not valid',
          },
        ],
      },
      componentProp: {
        progress: true,
        capslock: true,
      },
    },
  ],
})

const [
  register,
  {
    onOpenCreateForm,
    onReadAndOpenUpdateForm,
    onDeleteConfirm,
    onDeleteManyConfirm,
    onApiList,
  },
] = useCRUD<SystemUser>({
  baseAPI: userAPI,

  strictFormData: true,

  safeForm: true,
  safeFormFeedback: true,
  safeFormKey: key,
  safeFormUnwantedFields: ['status'],

  tableProps: {
    // E2E：`user-list-table` 供权限可见性用例判「列表已挂载 / 门禁后为空」；`user-create-btn` 判无 create 权限时隐藏
    testId: 'user-list-table',
    localeUniqueKey: key,
    rowKey: row => row[keyField]!,
    striped: true,
    bordered: true,
    singleLine: false,

    headerLeftBuiltInActions: [
      {
        _builtInType: 'create',
        testId: 'user-create-btn',
        onPresetClick() {
          onOpenCreateForm()
        },
      },
      {
        _builtInType: 'delete',
        testId: 'user-delete-many-btn',
        onPresetClick() {
          onDeleteManyConfirm()
        },
      },
    ],

    auths: {
      list: `system:${key}:list`,
      create: `system:${key}:create`,
      read: `system:${key}:read`,
      update: `system:${key}:update`,
      delete: `system:${key}:delete`,
    },

    queryFormProps: {
      localeUniqueKey: key,
      localeWithTable: true,
      span: 6,
      showFeedback: false,
      labelWidth: 120,
      schemas: [
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
            path: 'nickName',
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
        key: 'userName',
        width: 100,
      },

      {
        key: 'nickName',
        width: 100,
        formatter(rowData, _rowIndex) {
          return rowData.nickName ?? '-'
        },
      },

      {
        key: 'roles_count',
        width: 80,
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
          multiple: 1,
          compare: 'default',
        },
      },

      {
        ...WTablePresetUpdatedAtColumn,
        defaultSortOrder: 'descend',
        sorter: {
          multiple: 2,
          compare: 'default',
        },
      },

      {
        key: 'action',
        width: 140,
        extendType: 'action',
        fixed: 'right',
        columnBuiltInActions: [
          {
            _builtInType: 'read',
            // E2E：编辑抽屉触发器（权限可见性用例同时验证行内按钮随 read 权限显隐）
            testId: 'user-edit-btn',
            _show: row => !row.roles_list?.map(i => i.roleName).includes(AppConstRoles.ROOT) && !row.roles_list?.map(i => i.roleName).includes(AppConstRoles.DEVELOPER),
            async onPresetClick(rowData) {
              await onReadAndOpenUpdateForm(rowData[keyField]!)
            },
          },
          {
            _builtInType: 'delete',
            _dropdown: true,
            _show: row => !row.roles_list?.map(i => i.roleName).includes(AppConstRoles.ROOT) && !row.roles_list?.map(i => i.roleName).includes(AppConstRoles.DEVELOPER),
            async onPresetClick(rowData) {
              await onDeleteConfirm(rowData[keyField]!)
            },
          },
        ],
        columnExtraActions: [
          {
            // Q6 / L2：管理员重置某用户的锁屏（只解锁 + 清计次，不读不碰锁屏密码）。
            // 权限点 `system:user:lock:reset` 由 seed 提供；root 短路放行，其它角色需显式授予。
            // 行内普通按钮（不进 dropdown）：旅程 J3 的「轻 UI」有稳定落点。
            _builtInType: 'resetLock',
            _show: row => !row.roles_list?.map(i => i.roleName).includes(AppConstRoles.ROOT) && !row.roles_list?.map(i => i.roleName).includes(AppConstRoles.DEVELOPER),
            confirm: true,
            testId: 'user-reset-lock-btn',
            async onPresetClick(rowData) {
              await resetUserLockAPI(rowData[keyField]!)
              useAppMsgSuccess()
              await onApiList()
            },
            buttonProps: {
              textProp: () => t('app.security.lock.reset'),
              type: 'warning',
              size: 'small',
              auth: 'system:user:lock:reset',
            },
            iconProps: {
              icon: 'mdi:lock-open-variant-outline',
            },
          },
          {
            _builtInType: 'updatePass',
            _dropdown: true,
            _show: row => !row.roles_list?.map(i => i.roleName).includes(AppConstRoles.ROOT) && !row.roles_list?.map(i => i.roleName).includes(AppConstRoles.DEVELOPER),
            async onPresetClick(rowData) {
              updatePasswordFormData.value.userId = rowData[keyField]!
              updatePasswordFormData.value.userName = rowData.userName!
              onOpen()
            },
            buttonProps: {
              textProp: () => t('dict.sys_operate_type.update_password'),
              type: 'info',
              size: 'small',
              auth: `system:${key}:pass:update`,
            },
            iconProps: {
              icon: 'mdi:update',
            },
          },
          {
            _builtInType: 'clearPass',
            _dropdown: true,
            _show: row => !row.roles_list?.map(i => i.roleName).includes(AppConstRoles.ROOT) && !row.roles_list?.map(i => i.roleName).includes(AppConstRoles.DEVELOPER),
            async onPresetClick(rowData) {
              const { confirmed } = await useAppConfirm(t('app.base.pass.clear.confirm', { userName: rowData.userName }))

              if (confirmed) {
                const res = await clearPasswordAPI({ id: rowData[keyField]! })

                if (res) {
                  useAppMsgSuccess()
                  await onApiList()
                }
              }
            },
            buttonProps: {
              textProp: () => t('dict.sys_operate_type.clear_password'),
              type: 'warning',
              size: 'small',
              auth: `system:${key}:pass:clear`,
            },
            iconProps: {
              icon: 'mdi:lock-reset',
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

    schemas: [
      {
        type: 'Base:Input',
        formProp: {
          path: 'userName',
        },
        componentProp: {
          clearable: true,
        },
      },

      {
        // 数据权限二期批 2：所属部门（DEPT / DEPT_AND_CHILD / DEPT_OR_SELF 的解析输入）。
        // 可空（无部门 = DEPT 系档位默认拒绝，SELF 不受影响）。
        type: 'Base:TreeSelect',
        formProp: {
          path: 'deptId',
          labelHelpMessage: true,
        },
        componentProp: {
          defaultValue: null,
          treeSelectProps: {
            options: getDeptTree as unknown as any[],
            keyField: 'id',
            labelField: 'deptName',
            clearable: true,
            placeholder: t('table.user.deptId.placeholder'),
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
        type: 'Extend:RoleSelect',
        formProp: {
          path: 'roles',
          labelHelpMessage: true,
        },
        componentProp: {
          multiple: true,
        },
      },
    ],
  },
})

async function onYes(_: any, done: () => void) {
  try {
    await userStoreAuth.updatePasswordWithOpaqueForAdmin({
      userId: updatePasswordFormData.value.userId,
      userName: updatePasswordFormData.value.userName,
      newPassword: updatePasswordFormData.value.newPassword,
    })
    useAppMsgSuccess()
    resetPasswordFormData()
    await onApiList()
  }
  finally {
    done()
  }
}
</script>

<template>
  <div>
    <!-- @vue-generic {SystemUser} -->
    <WCRUD @hook="register" />

    <WForm :model="updatePasswordFormData" @hook="registerUpdatePassword" />
  </div>
</template>
