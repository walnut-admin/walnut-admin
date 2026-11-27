<script lang="ts" setup>
import type { SystemUserDeviceListItem } from '@walnut/api-types'
import { useState } from '@walnut/client/hooks/core/useState'
import { computed, ref } from 'vue'
import { forceQuitUserDeviceAPI, listUserDevicesAPI, lockUserDeviceAPI, unlockUserDeviceAPI, updateUserDeviceNameAPI } from '@/api/system/user_device'
import { useForm } from '@/components/UI/Form'
import { useTable } from '@/components/UI/Table'
import { AppConstLockMode } from '@/const/app'
import { useAppMsgSuccess } from '@/hooks/component/useMessage'

import { useAppI18n } from '@/locales/index'
import { useAppStoreLock } from '@/store/modules/app/app-lock'

defineOptions({
  name: 'WAccountSettingsTabSecurityTab3Device',
  defaultView: false,
})

const { t } = useAppI18n()
const appStoreLock = useAppStoreLock()
const visible = ref(false)

const { stateRef: updateDeviceNameData, resetState: resetUpdateDeviceNameFormData } = useState({ deviceId: '', deviceName: '' })
const [registerUpdatePassword, { onOpen: onOpenUpdateDeviceNameModal }] = useForm<typeof updateDeviceNameData.value>({
  dialogPreset: 'modal',
  baseRules: true,
  labelWidth: 120,
  xGap: 0,

  dialogProps: {
    title: computed(() => t('app.security.device.updateName')),
    width: '40%',
    onYes: onUpdateDeviceNameYes,
    onNo: (done) => {
      resetUpdateDeviceNameFormData()
      done()
    },
  },

  schemas: [
    {
      type: 'Base:Input',
      formProp: {
        path: 'deviceName',
      },
      componentProp: {
        clearable: true,
        maxlength: 80,
      },
    },
  ],
})

/**
 * security 模式解除某台已登录设备的锁屏需要锁屏密码（服务端 `SysUserLockUnLockDto`）。
 * default / idle 仍然免密直接解 —— 只在该用户当前偏好是 security 时弹这一步。
 */
const { stateRef: unlockDeviceData, resetState: resetUnlockDeviceFormData } = useState({ deviceId: '', deviceName: '', lockPwdHash: '' })

const [registerUnlockDevice, { onOpen: onOpenUnlockDeviceModal }] = useForm<typeof unlockDeviceData.value>({
  dialogPreset: 'modal',
  baseRules: true,
  labelWidth: 120,
  xGap: 0,

  dialogProps: {
    title: computed(() => t('app.security.lock.unlockDevice')),
    width: '40%',
    onYes: onUnlockDeviceYes,
    onNo: (done) => {
      resetUnlockDeviceFormData()
      done()
    },
  },

  schemas: [
    {
      type: 'Extra:Password',
      formProp: {
        path: 'lockPwdHash',
        label: computed(() => t('app.security.lock.pwd')),
        first: true,
        rule: [
          {
            key: 'lockPwdHash',
            type: 'string',
            min: 6,
            max: 64,
            required: true,
            message: t('app.security.lock.invalidPwd'),
          },
        ],
      },
      componentProp: {
        capslock: true,
      },
    },
  ],
})

async function onUnlockDevice(rowData: SystemUserDeviceListItem) {
  const deviceId = rowData.deviceId!

  if (appStoreLock.getLockMode !== AppConstLockMode.SECURITY) {
    await doUnlockDevice(deviceId, '')
    return
  }

  unlockDeviceData.value.deviceId = deviceId
  unlockDeviceData.value.deviceName = rowData.deviceName ?? ''
  unlockDeviceData.value.lockPwdHash = ''
  onOpenUnlockDeviceModal()
}

async function onUnlockDeviceYes(_: any, done: () => void) {
  try {
    await doUnlockDevice(unlockDeviceData.value.deviceId, unlockDeviceData.value.lockPwdHash)
    resetUnlockDeviceFormData()
  }
  finally {
    done()
  }
}

const [register, { onApiList }] = useTable<SystemUserDeviceListItem>({
  bordered: true,
  striped: true,
  rowKey: row => row.deviceId!,
  auths: {
    list: 'system:user:device:list',
  },
  apiProps: {
    listApi: listUserDevicesAPI,
  },
  headerLeftBuiltInActions: [
    {
      _builtInType: 'create',
      onPresetClick() {
        console.log('create')
      },
    },
    {
      _builtInType: 'delete',
      onPresetClick() {
        console.log('delete')
      },
    },
  ],
  columnSetting: false,
  maxHeight: 300,
  minHeight: 300,
  pagination: false,
  localeUniqueKey: 'app.base',
  columns: [
    {
      title: '#',
      key: 'key',
      render: (_, index) => {
        return `${index + 1}`
      },
      width: 40,
      fixed: 'left',
      locale: false,
    },
    {
      key: 'deviceName',
      fixed: 'left',
      minWidth: 240,
      extendType: 'tag',
      tagProps: row => ({
        type: row.current === true ? 'success' : 'info',
        size: 'small',
      }),
      formatter: row =>
        row.current === true
          ? `${row.deviceName} (Current)`
          : row.deviceName,
    },
    {
      title: computed(() => t('table.app.monitor.user.auth')),
      locale: false,
      key: 'auth',
      width: 160,
      extendType: 'tag',
      tagProps: row => ({
        type: row.auth === true ? 'success' : 'warning',
        size: 'small',
      }),
      formatter: row =>
        row.auth === true
          ? t('table.app.monitor.user.auth.true')
          : t('table.app.monitor.user.auth.false'),
      filter: true,
      filterMultiple: false,
      filterOptions: [
        {
          value: 'true',
          label: computed(() => t('table.app.monitor.user.auth.true')),
        },
        {
          value: 'false',
          label: computed(() => t('table.app.monitor.user.auth.false')),
        },
      ],
    },
    {
      title: computed(() => t('app.base.lock.status')),
      locale: false,
      key: 'locked',
      width: 160,
      extendType: 'tag',
      tagProps: row => ({
        type: row.locked === true ? 'success' : 'warning',
        size: 'small',
      }),
      formatter: row =>
        row.locked === true
          ? t('app.base.lock.true')
          : t('app.base.lock.false'),
      filter: true,
      filterMultiple: false,
      filterOptions: [
        {
          value: 'true',
          label: computed(() => t('app.base.lock.true')),
        },
        {
          value: 'false',
          label: computed(() => t('app.base.lock.false')),
        },
      ],
    },
    {
      key: 'deviceType',
      width: 120,
    },
    {
      key: 'location',
      width: 200,
    },
    {
      key: 'lastActiveAt',
      minWidth: 200,
    },
    {
      title: 'Action',
      key: 'action',
      width: 100,
      extendType: 'action',
      columnExtraActions: [
        {
          _builtInType: 'updateDeviceName',
          _dropdown: true,
          async onPresetClick(rowData) {
            updateDeviceNameData.value.deviceId = rowData.deviceId!
            updateDeviceNameData.value.deviceName = rowData.deviceName!
            onOpenUpdateDeviceNameModal()
          },
          buttonProps: {
            textProp: () => t('app.security.device.updateName'),
            type: 'info',
            size: 'small',
            auth: `system:user:device:updateName`,
          },
          iconProps: {
            icon: 'mdi:update',
          },
        },
        {
          _builtInType: 'lock',
          _dropdown: true,
          confirm: true,
          _disabled: row => !row.auth,
          _show: row => !row.locked,
          iconProps: {
            icon: 'mdi:lock-outline',
          },
          buttonProps: {
            auth: `system:user:device:lock`,
            type: 'warning',
            textProp: () => t('app.base.lockDevice'),
          },
          async onPresetClick(rowData) {
            await lockUserDeviceAPI({ deviceId: rowData.deviceId! })
            useAppMsgSuccess()
            const timeId = setTimeout(async () => {
              await onApiList()
              clearTimeout(timeId)
            }, 1000)
          },
        },
        {
          _builtInType: 'unlock',
          _dropdown: true,
          confirm: true,
          _disabled: row => !row.auth,
          _show: row => row.locked,
          iconProps: {
            icon: 'mdi:lock-open-variant-outline',
          },
          buttonProps: {
            auth: `system:user:device:lock`,
            type: 'warning',
            textProp: () => t('app.base.unlockDevice'),
          },
          async onPresetClick(rowData) {
            await onUnlockDevice(rowData)
          },
        },
        {
          _builtInType: 'force-quit',
          _dropdown: true,
          confirm: true,
          _disabled: row => !row.auth,
          iconProps: {
            icon: 'ant-design:logout-outlined',
          },
          buttonProps: {
            auth: `system:user:device:forceQuit`,
            type: 'error',
            textProp: () => t('app.monitor.user.forceLogout'),
          },
          async onPresetClick(rowData) {
            await forceQuitUserDeviceAPI({ deviceId: rowData.deviceId! })
            useAppMsgSuccess()
            const timeId = setTimeout(async () => {
              await onApiList()
              clearTimeout(timeId)
            }, 1000)
          },
        },
      ],
      fixed: 'right',
    },
  ],
})

async function doUnlockDevice(deviceId: string, lockPwdHash: string) {
  await unlockUserDeviceAPI({ deviceId, lockPwdHash })
  useAppMsgSuccess()
  const timeId = setTimeout(async () => {
    await onApiList()
    clearTimeout(timeId)
  }, 1000)
}

async function onUpdateDeviceNameYes(_: any, done: () => void) {
  try {
    await updateUserDeviceNameAPI({
      deviceId: updateDeviceNameData.value.deviceId,
      deviceName: updateDeviceNameData.value.deviceName,
    })
    useAppMsgSuccess()
    resetUpdateDeviceNameFormData()
    await onApiList()
  }
  finally {
    done()
  }
}

async function onOpen() {
  visible.value = true
}

defineExpose({
  onOpen,
})
</script>

<template>
  <WModal v-model:show="visible" :title="$t('sys.menu.user.device')" width="60%" height="60%" :fullscreen="false" :default-button="false">
    <!-- @vue-generic {SystemUserDeviceListItem} -->
    <WTable @hook="register" />

    <WForm :model="updateDeviceNameData" @hook="registerUpdatePassword" />

    <WForm :model="unlockDeviceData" @hook="registerUnlockDevice" />
  </WModal>
</template>
