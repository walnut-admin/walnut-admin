<script lang="ts" setup>
import type { components } from '@walnut/api-types'
import type { InputHTMLAttributes } from 'vue'
import type { ValueOfAppConstLockMode } from '@/const/app'
import { computed, onBeforeMount, reactive, ref } from 'vue'
import { updateLockPreferenceAPI } from '@/api/system/user_lock'
import { AppConstLockMode } from '@/const/app'
import { useAppMsgError, useAppMsgSuccess } from '@/hooks/component/useMessage'
import { useAppI18n } from '@/locales/index'
import { useAppStoreLock } from '@/store/modules/app/app-lock'

defineOptions({
  name: 'WMeTabSecurityTab5',
  defaultView: false,
})

const { t } = useAppI18n()
const appStoreLock = useAppStoreLock()

const saving = ref(false)

const form = reactive<{
  lockMode: ValueOfAppConstLockMode
  lockIdleSec: number | null
  lockSecuritySec: number | null
  lockCrossDevice: boolean
  lockPwd: string
  lockPwdConfirm: string
}>({
  lockMode: AppConstLockMode.DEFAULT,
  lockIdleSec: 600,
  lockSecuritySec: 60,
  lockCrossDevice: false,
  lockPwd: '',
  lockPwdConfirm: '',
})

/** 服务端只回布尔（`lockPwdHash` 永不出响应）—— 它决定密码是「设置」还是「修改」 */
const lockPwdSet = computed(() => appStoreLock.getLockPwdSet)

// E2E 稳定选择器要落在真实 `<input>` 上；`InputHTMLAttributes` 没有 data-* 索引签名，窄 cast
const lockPwdSetInputProps = {
  'data-testid': 'lock-pwd-set',
  autocomplete: 'new-password',
} as unknown as InputHTMLAttributes
const lockPwdConfirmInputProps = {
  'data-testid': 'lock-pwd-set-confirm',
  autocomplete: 'new-password',
} as unknown as InputHTMLAttributes

function onInit() {
  form.lockMode = appStoreLock.getLockMode
  form.lockIdleSec = appStoreLock.getLockIdleSec
  form.lockSecuritySec = appStoreLock.getLockSecuritySec
  form.lockCrossDevice = appStoreLock.getLockCrossDevice
  form.lockPwd = ''
  form.lockPwdConfirm = ''
}

function validate(): string | null {
  if (form.lockIdleSec === null || form.lockIdleSec < 60 || form.lockIdleSec > 7200) {
    return t('app.security.lock.idleRange')
  }

  if (form.lockSecuritySec === null || form.lockSecuritySec < 15 || form.lockSecuritySec > 600) {
    return t('app.security.lock.securityRange')
  }

  // Q3：本期不支持「清除锁屏密码」—— 密码框留空 = 不修改（security 模式下必须库里已有）
  if (form.lockPwd) {
    if (form.lockPwd.length < 6 || form.lockPwd.length > 64) {
      return t('app.security.lock.invalidPwd')
    }

    if (form.lockPwd !== form.lockPwdConfirm) {
      return t('app.security.lock.pwdNotMatch')
    }
  } else if (form.lockMode === AppConstLockMode.SECURITY && !lockPwdSet.value) {
    // 服务端同样会 40000（pwdRequired），前端先挡一道，省一次往返
    return t('app.security.lock.invalidPwd')
  }

  return null
}

async function onSave() {
  const error = validate()
  if (error !== null) {
    useAppMsgError(error)
    return
  }

  saving.value = true

  try {
    const payload: components['schemas']['SysUserLockPreferenceUpdateDto'] = {
      lockMode: form.lockMode,
      lockIdleSec: form.lockIdleSec!,
      lockSecuritySec: form.lockSecuritySec!,
      lockCrossDevice: form.lockCrossDevice,
    }

    if (form.lockPwd) {
      payload.lockPwdHash = form.lockPwd
    }

    await updateLockPreferenceAPI(payload)

    // 重拉服务端偏好（含 lockPwdSet 与可能被服务端兜底的默认值）
    await appStoreLock.onInitLockState()
    onInit()

    useAppMsgSuccess()
  } finally {
    saving.value = false
  }
}

onBeforeMount(onInit)
</script>

<template>
  <n-card :bordered="false" data-testid="lock-settings">
    <template #header>
      {{ $t('app.intro.lock') }}
    </template>

    <template #header-extra>
      <span class="text-sm text-gray-400">{{ $t('app.security.lock.desc') }}</span>
    </template>

    <n-form
      :model="form"
      label-placement="left"
      label-width="180"
      require-mark-placement="right-hanging"
    >
      <n-form-item :label="$t('form.app.settings.app.lockMode')">
        <n-radio-group v-model:value="form.lockMode" data-testid="lock-mode-group">
          <n-radio-button :value="AppConstLockMode.DEFAULT" data-testid="lock-mode-default">
            {{ $t('app.security.lock.mode.default') }}
          </n-radio-button>
          <n-radio-button :value="AppConstLockMode.IDLE" data-testid="lock-mode-idle">
            {{ $t('app.security.lock.mode.idle') }}
          </n-radio-button>
          <n-radio-button :value="AppConstLockMode.SECURITY" data-testid="lock-mode-security">
            {{ $t('app.security.lock.mode.security') }}
          </n-radio-button>
        </n-radio-group>
      </n-form-item>

      <n-form-item :label="$t('form.app.settings.app.lockIdleSeconds')">
        <n-input-number
          v-model:value="form.lockIdleSec"
          :min="60"
          :max="7200"
          :step="60"
          :precision="0"
          data-testid="lock-idle-seconds"
        />
      </n-form-item>

      <n-form-item :label="$t('app.security.lock.securitySeconds')">
        <n-input-number
          v-model:value="form.lockSecuritySec"
          :min="15"
          :max="600"
          :step="15"
          :precision="0"
          data-testid="lock-security-seconds"
        />
      </n-form-item>

      <n-form-item :label="$t('app.security.lock.crossDevice')">
        <div class="flex flex-col gap-y-1">
          <n-switch v-model:value="form.lockCrossDevice" data-testid="lock-cross-device" />
          <span class="text-sm text-gray-400">{{ $t('app.security.lock.crossDevice.desc') }}</span>
        </div>
      </n-form-item>

      <n-form-item :label="$t('app.security.lock.pwd')">
        <div class="w-full flex flex-col gap-y-2">
          <n-input
            v-model:value="form.lockPwd"
            type="password"
            show-password-on="click"
            :placeholder="
              lockPwdSet ? $t('app.security.lock.pwd.keep') : $t('app.security.lock.pwd')
            "
            :input-props="lockPwdSetInputProps"
          />
          <n-input
            v-model:value="form.lockPwdConfirm"
            type="password"
            show-password-on="click"
            :placeholder="$t('app.base.pass.new.confirm')"
            :input-props="lockPwdConfirmInputProps"
          />
          <span v-if="lockPwdSet" class="text-sm text-gray-400">{{
            $t('app.security.lock.pwd.keep')
          }}</span>
        </div>
      </n-form-item>

      <n-form-item :show-label="false">
        <n-button type="primary" :loading="saving" data-testid="lock-settings-save" @click="onSave">
          {{ $t('app.base.save') }}
        </n-button>
      </n-form-item>
    </n-form>
  </n-card>
</template>
