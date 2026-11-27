<script lang="ts" setup>
import type { AuthMfaTotpGenerate } from '@walnut/api-types'
import type { InputInst } from 'naive-ui'
import type { InputHTMLAttributes } from 'vue'
import { downloadByBlob } from '@walnut/client/browser/file/download'
import { computed, nextTick, ref, useTemplateRef } from 'vue'
import { authMfaTotpBindAPI, authMfaTotpGenerateAPI, authMfaTotpUnbindAPI } from '@/api/auth/mfa'
import { name } from '@/const/package-info'
import { useAppConfirm } from '@/hooks/component/useConfirm'
import { useAppI18n } from '@/locales/index'
import { useAppStoreFingerprint } from '@/store/modules/app/app-fingerprint'

defineOptions({
  name: 'MfaTotpModal',
})

const emits = defineEmits<{ success: [] }>()

const { t } = useAppI18n()
const appStoreFingerprint = useAppStoreFingerprint()

/**
 * E2E 稳定选择器要落在**真实 `<input>`** 上（`input-props` 才是它的落点），
 * 与 `MfaVerified/index.vue` 的 `mfa-code-input` 同一写法和原因。
 */
const totpCodeInputProps = { 'data-testid': 'mfa-required-totp-code-input' } as unknown as InputHTMLAttributes

const nInputRef = useTemplateRef<InputInst>('nInputRef')

const show = ref(false)
const currentStep = ref(1)
const loading = ref(false)

const totpData = ref<AuthMfaTotpGenerate>()
const verifyCode = ref('')
const backupCodes = ref<string[]>([])

const canVerify = computed(() => verifyCode.value.length === 6)

// start generate totpy
async function onBind() {
  try {
    loading.value = true
    const res = await authMfaTotpGenerateAPI({
      name: appStoreFingerprint.getDeviceNameFromFingerprint,
    })
    totpData.value = res
    currentStep.value = 1
    show.value = true
  }
  catch {
    // 拦截器是唯一的 toast 责任方（已提示 + 已做路由级处理）；这里吞掉 rejection，
    // 否则冒到 `unhandledrejection` 会触发全屏「无法恢复的错误」遮罩（2026-11-27 实测）。
  }
  finally {
    loading.value = false
  }
}

// verify and bind totp
async function bindTotp() {
  if (!canVerify.value || !totpData.value)
    return

  try {
    loading.value = true
    const res = await authMfaTotpBindAPI({
      name: appStoreFingerprint.getDeviceNameFromFingerprint,
      code: verifyCode.value,
      tempTotpId: totpData.value.totpId,
    })

    backupCodes.value = res.backupCodes || []
    currentStep.value = 3

    emits('success')
  }
  catch {
    // 同 onBind：错误提示由拦截器完成（如 40000 参数错误 / 验证码错误文案），
    // 弹窗保持打开让用户改码重试，不往上逃逸。
  }
  finally {
    loading.value = false
  }
}

// TODO 删除 没有解绑totp的说法
// unbind totp
async function onUnbind() {
  const { confirmed } = await useAppConfirm(t('mfa.totp.unbind'))

  if (confirmed) {
    try {
      loading.value = true
      await authMfaTotpUnbindAPI()
      emits('success')
    }
    catch {
      // 同 onBind。
    }
    finally {
      loading.value = false
    }
  }
}

// close bind modal
function onCloseBindModal() {
  show.value = false
  currentStep.value = 1
  totpData.value = undefined
  verifyCode.value = ''
  backupCodes.value = []
}

// go to step 2
function onGoStep2() {
  currentStep.value = 2
  nextTick(() => {
    nInputRef.value?.focus()
  })
}

//  download backup codes
function onDownloadBackupCodes() {
  const content = `${name} - ${t('mfa.totp.backupCodes')}\n${t('app.base.createdAt')}: ${new Date().toLocaleString()}\n\n${backupCodes.value.join('\n')}\n\n${t('mfa.totp.backupCodes.title1')} - ${t('mfa.totp.backupCodes.title3')}`
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  downloadByBlob(blob, `totp-backup-codes-${Date.now()}.txt`)
}

defineExpose({
  onBind,
  onUnbind,
})
</script>

<template>
  <NModal
    v-model:show="show"
    preset="card"
    :title="$t('mfa.totp.title')"
    :style="{ width: '600px' }"
    :closable="currentStep !== 3"
    :mask-closable="false"
    @close="onCloseBindModal"
  >
    <!-- step -->
    <NSteps :current="currentStep" class="mb-8 ml-20" content-placement="bottom">
      <NStep :title="$t('comp.qrcode.scan')" />
      <NStep :title="$t('app.base.verify')" />
      <NStep :title="$t('app.base.done')" />
    </NSteps>

    <!-- step 1: scan qrcode -->
    <div v-if="currentStep === 1 && totpData" class="text-center">
      <h3 class="mb-4 text-lg font-semibold">
        {{ $t('mfa.totp.scan') }}
      </h3>

      <!-- qrcode -->
      <div class="mb-4 inline-block rounded-lg bg-white p-4 shadow-sm">
        <img :src="totpData.qrCode" alt="TOTP QR Code" class="h-64 w-64">
      </div>

      <p class="mb-4 text-sm">
        {{ $t('app.base.account') }}: <span class="font-medium font-mono">{{ totpData.account }}</span>
      </p>

      <!-- manual input option -->
      <details class="text-left">
        <summary class="mb-2 cursor-pointer text-sm text-warning">
          {{ $t('mfa.totp.manual') }}
        </summary>
        <NAlert type="info" class="mt-2">
          <div class="text-sm">
            <p class="mb-2">
              {{ $t('mfa.totp.manual.key') }}
            </p>
            <div class="flex items-center justify-between rounded px-3 py-2 font-mono">
              <span class="break-all">{{ totpData.secret }}</span>
              <WCopy
                :source="totpData.secret"
              />
            </div>
          </div>
        </NAlert>
      </details>

      <NSpace justify="center" class="mt-6">
        <NButton @click="onCloseBindModal">
          {{ $t('app.base.no') }}
        </NButton>
        <!-- data-testid：MFA 强制绑定旅程从扫码步进入验证码步 -->
        <NButton type="primary" data-testid="mfa-required-totp-next-btn" @click="onGoStep2">
          {{ $t('app.base.next') }}
        </NButton>
      </NSpace>
    </div>

    <!-- Step2: verify -->
    <div v-if="currentStep === 2" class="text-center">
      <h3 class="mb-4 text-lg font-semibold">
        {{ $t('mfa.totp.verify.title1') }}
      </h3>

      <p class="mb-6 text-sm text-gray-600">
        {{ $t('mfa.totp.verify.title2') }}
      </p>

      <div class="mx-auto mb-6 max-w-xs">
        <NInput
          ref="nInputRef"
          v-model:value="verifyCode"
          placeholder="000000"
          size="large"
          maxlength="6"
          :allow-input="(value: string) => /^\d*$/.test(value)"
          :input-props="totpCodeInputProps"
          class="text-center text-2xl tracking-widest font-mono"
          @keyup.enter="bindTotp"
        >
          <template #prefix>
            <WIcon icon="carbon-password" />
          </template>
        </NInput>
      </div>

      <NSpace justify="center">
        <NButton @click="currentStep = 1">
          {{ $t('app.base.prev') }}
        </NButton>
        <!-- data-testid：MFA 强制绑定旅程提交 6 位码完成绑定 -->
        <NButton
          type="primary"
          data-testid="mfa-required-totp-verify-btn"
          :disabled="!canVerify"
          :loading="loading"
          @click="bindTotp"
        >
          {{ $t('mfa.totp.verify.button') }}
        </NButton>
      </NSpace>
    </div>

    <!-- Step3: done -->
    <div v-if="currentStep === 3" class="text-center">
      <WIcon icon="carbon-checkmark-filled" class="mx-auto mb-4 text-6xl" />
      <h3 class="mb-2 text-lg font-semibold">
        {{ $t('mfa.totp.done.title1') }}
      </h3>
      <p class="mb-6 text-gray-600">
        {{ $t('mfa.totp.done.title2') }}
      </p>

      <!-- backup codes -->
      <NAlert type="warning" class="mb-6 text-left">
        <template #header>
          <div class="flex items-center gap-2 font-medium">
            {{ $t('mfa.totp.backupCodes.title1') }}
          </div>
        </template>
        <div class="text-sm">
          <p class="mb-3">
            {{ $t('mfa.totp.backupCodes.title2') }}
            <strong class="text-orange-700">{{ $t('mfa.totp.backupCodes.title3') }}</strong>
          </p>
          <div class="mb-3 max-h-48 overflow-y-auto rounded p-3 text-xs font-mono">
            <div v-for="(code, index) in backupCodes" :key="index" class="mb-1">
              {{ index + 1 }}. {{ code }}
            </div>
          </div>
          <NSpace>
            <WCopy :source="backupCodes.join('\n')" />
            <NButton size="tiny" dashed type="info" @click="onDownloadBackupCodes">
              <template #icon />
              {{ $t('app.base.download') }}
            </NButton>
          </NSpace>
        </div>
      </NAlert>

      <NButton type="primary" block @click="onCloseBindModal">
        {{ $t('app.base.done') }}
      </NButton>
    </div>
  </NModal>
</template>
