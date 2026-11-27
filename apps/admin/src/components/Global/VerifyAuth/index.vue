<script lang="ts" setup>
import type { components } from '@walnut/api-types'
import type { VerifyAuthMethod, VerifyAuthMethodType, VerifyAuthOptions, VerifyAuthSensitiveChallenge, VerifyAuthStep } from './types'
import { WalnutAdminConstSysUserMfaType } from '@walnut/contract/mfa'
import { computed, provide, ref, useTemplateRef, watch } from 'vue'
import { authMfaTotpVerifyAPI } from '@/api/auth/mfa'
import { verifySensitiveAPI } from '@/api/security/sensitive'
import { bindUserIdentityAPI, checkUserIdentityAPI, sendCodeForVerifyAPI, verifyUserIdentityAPI } from '@/api/system/user_identity'
import { useAppI18n } from '@/locales/index'
import { useStoreCompVerifyAuth } from '@/store/modules/component/comp-verify-auth'
import IdentityInput from './components/IdentityInput.vue'
import MethodSelect from './components/MethodSelect.vue'
import VerifyCode from './components/VerifyCode.vue'

/**
 * Secondary Authentication Modal Component
 * Unified secondary authentication for sensitive operations
 * Supports SMS, Email, TOTP, and WebAuthn methods
 * Supports both verify mode (existing) and bind mode (first-time)
 *
 * Architecture:
 * - This component: Flow control and state management only
 * - MethodSelect: Step 1 - Select authentication method
 * - IdentityInput: Step 2 - Input phone/email (bind mode only)
 * - VerifyCode: Step 3 - Input verification code
 */

defineOptions({
  name: 'WCompBusinessVerifyAuth',
})

const compStoreVerifyAuth = useStoreCompVerifyAuth()

const options = computed(() => compStoreVerifyAuth.getOptions)

const { t } = useAppI18n()

// ============================================
// State Management
// ============================================
const currentStep = ref<VerifyAuthStep>('select')
const selectedMethod = ref<VerifyAuthMethod>()
/** 加载态（`provide` 给子步骤；也用于发码 / 提交期间禁用按钮） */
const loading = ref(true)

// MFA 方法值集的单一真源是 @walnut/contract（server 侧同一数组做 enum 校验）
const [mfaTotp] = WalnutAdminConstSysUserMfaType

/** Component refs */
const identityInputRef = useTemplateRef('identityInputRef')

// ============================================
// Options with defaults
// ============================================

const localOptions = computed<Required<VerifyAuthOptions>>(() => ({
  mode: 'verify',
  preSelectedMethod: undefined as unknown as VerifyAuthMethodType,
  allowedMethods: undefined as unknown as VerifyAuthMethodType[],
  showTrusted: true,
  purpose: 'security',
  showSetAsSecurity: false,
  sensitive: undefined as unknown as VerifyAuthSensitiveChallenge,
  ...options.value,
}))

const getIsBindMode = computed(() => localOptions.value.mode === 'bind')
const getIsSms = computed(() => selectedMethod.value?.type === 'sms')

// ============================================
// Methods
// ============================================

/**
 * Handle method selection from MethodSelect component
 */
async function onMethodSelect(method: VerifyAuthMethod) {
  selectedMethod.value = method

  // Determine next step based on mode and method
  if (getIsBindMode.value && (method.type === 'sms' || method.type === 'email')) {
    // Bind mode with SMS/Email: show input form first
    currentStep.value = 'input'
    return
  }

  // 40119 敏感操作验证：验证码**必须由这一侧主动发**（verify 模式的历史调用方
  // —— tab1 的「验证」下拉项 —— 都是先自己 send-code 再开弹窗；40119 没有调用方，
  // 弹窗就是入口）。发码失败就留在选择步，别把用户丢进一个收不到码的输入框。
  if (localOptions.value.sensitive && (method.type === 'sms' || method.type === 'email')) {
    loading.value = true

    try {
      await sendCodeForVerifyAPI(
        method.type === 'sms' ? 'phoneNumber' : 'emailAddress',
        localOptions.value.purpose,
      )
    }
    catch (e) {
      console.error(e)
      selectedMethod.value = undefined
      return
    }
    finally {
      loading.value = false
    }
  }

  // Verify mode or TOTP: go directly to verification
  currentStep.value = 'verify'
}

/**
 * Handle verification code submit from VerifyCode component
 */
async function onVerifyCode(code: string) {
  if (!selectedMethod.value)
    return

  const { mode, purpose, sensitive } = localOptions.value
  const method = selectedMethod.value

  loading.value = true

  try {
    if (sensitive) {
      // 40119：把码交给敏感验证端点（授权写 Redis，原请求由拦截器重放）。
      // 注意服务端的 method 词表是 password/sms/mfa/email —— 组件的 totp 对应 mfa。
      //
      // `level` / `operationType` 是 40119 `meta` 里的运行时字符串（服务端守卫装饰器的枚举），
      // 这里按生成类型收口；非法值由服务端 controller 校验拒绝（40099），不在前端复制枚举表。
      type SensitiveVerifyPayload = components['schemas']['SecuritySensitiveVerifyRequestDTO']
      await verifySensitiveAPI({
        level: sensitive.level as SensitiveVerifyPayload['level'],
        operationType: sensitive.operationType as SensitiveVerifyPayload['operationType'],
        method: toServerVerifyMethod(method.type),
        credential: code,
      })

      // 成功：关弹窗 + 结清（40119 接线据此重放原请求）
      compStoreVerifyAuth.onVerifiedVerifyAuthModal({ verified: true, method: method.type, trusted: false })
    }
    else if (mode === 'bind' && (method.type === 'sms' || method.type === 'email')) {
      // Bind mode: bind then verify
      await bindUserIdentityAPI({
        type: method.type === 'sms' ? 'phoneNumber' : 'emailAddress',
        purpose,
        identifier: identityInputRef.value?.getIdentifier() as string,
        setAsSecurity: false,
        verifyCode: code,
      })
      compStoreVerifyAuth.onVerifiedVerifyAuthModal({ verified: true, method: method.type, trusted: false })
    }
    else if (method.type === 'sms' || method.type === 'email') {
      // Verify mode: just verify
      await verifyUserIdentityAPI({
        type: method.type === 'sms' ? 'phoneNumber' : 'emailAddress',
        purpose,
        verifyCode: code,
      })
      compStoreVerifyAuth.onVerifiedVerifyAuthModal({ verified: true, method: method.type, trusted: false })
    }
    else if (method.type === mfaTotp) {
      await authMfaTotpVerifyAPI({
        code,
        trusted: false,
      })
      compStoreVerifyAuth.onVerifiedVerifyAuthModal({ verified: true, method: method.type, trusted: false })
    }

    // Close modal and reset
    resetState()
  }
  catch (_error) {
    console.error(_error)
    // Error is handled by API interceptor
    // Stay on verify step for user to retry
  }
  finally {
    loading.value = false
  }
}

/**
 * 组件方法 → 服务端 `WalnutAdminConstVerifyMethod`。
 * totp/webauthn 在服务端同属 `mfa`（webauthn 不在敏感验证的可用方式里，这里只做穷举收口）。
 */
function toServerVerifyMethod(type: VerifyAuthMethodType): components['schemas']['SecuritySensitiveVerifyRequestDTO']['method'] {
  if (type === 'sms' || type === 'email')
    return type
  return 'mfa'
}

/**
 * Handle back button
 */
function onBack() {
  if (getIsBindMode.value) {
    if (currentStep.value === 'input') {
      currentStep.value = 'select'
      selectedMethod.value = undefined
    }
    else {
      currentStep.value = 'input'
    }
  }
  else {
    // In verify mode, go back to selection
    currentStep.value = 'select'
    selectedMethod.value = undefined
  }
}

/**
 * Reset all state
 */
function resetState() {
  selectedMethod.value = undefined
}

// ============================================
// Modal
// ============================================
const getModalTitle = computed(() => {
  if (currentStep.value === 'select') {
    return getIsBindMode.value
      ? t('security.bind.title1')
      : t('security.verify.title1')
  }
  else if (currentStep.value === 'input') {
    return t(getIsSms.value ? 'security.phone.modalTitle' : 'security.email.modalTitle')
  }
  else if (currentStep.value === 'verify') {
    return t('security.title3')
  }
  return ''
})
const getModalCanClose = computed(() => {
  // Only allow closing on method select step
  return currentStep.value === 'select'
})

/**
 * 关闭弹窗的唯一出口：`WModal` 的 `update:show(false)`（右上角 X / 遮罩 / Esc，只在
 * 选择步可用）必须走 store 的取消动作，否则挂起的打开方（40119 接线）永远等不到结清。
 */
function onUpdateShow(v: boolean) {
  if (!v) {
    compStoreVerifyAuth.onCloseVerifyAuthModal()
  }
}

async function onCheckInput() {
  if (currentStep.value === 'input' && identityInputRef.value) {
    const isValid = await identityInputRef.value.validate()
    if (!isValid)
      return
    identityInputRef.value.restoreValidation()
    loading.value = true
    try {
      await checkUserIdentityAPI({
        type: getIsSms.value ? 'phoneNumber' : 'emailAddress',
        purpose: localOptions.value.purpose,
        identifier: identityInputRef.value.getIdentifier()!,
      })
      currentStep.value = 'verify'
    }
    finally {
      loading.value = false
    }
  }
}

/** 底部「验证」按钮：把显式点击转给当前步骤的验证码表单（未输满时它是 no-op） */
const verifyCodeRef = useTemplateRef('verifyCodeRef')
function onVerifySubmit() {
  verifyCodeRef.value?.submit()
}

/**
 * 每次打开都从「选择方式」重新开始：弹窗组件在关闭后会被 `useGlobalAsyncComponent`
 * 卸载，但同一次打开的重复 `show=true`（并发 40119 复用同一个弹窗）不会重建，
 * 因此显式归位比依赖卸载可靠。
 */
watch(
  () => compStoreVerifyAuth.getShow,
  (show) => {
    if (show) {
      currentStep.value = 'select'
      selectedMethod.value = undefined
    }
  },
)

provide('loading', loading)
provide('selectedMethod', selectedMethod)
</script>

<template>
  <WModal
    :show="compStoreVerifyAuth.show"
    :title="getModalTitle"
    :default-button="false"
    width="480px"
    :fullscreen="false"
    :loading="loading"
    :closable="getModalCanClose"
    :mask-closable="getModalCanClose"
    :close-on-esc="getModalCanClose"
    @update:show="onUpdateShow"
  >
    <template #default>
      <WTransition appear transition-name="slide-left" :duration="300">
        <!-- Step 1: Method Selection -->
        <MethodSelect
          v-show="currentStep === 'select'"
          :options="localOptions"
          @select="onMethodSelect"
        />
      </WTransition>

      <WTransition appear transition-name="slide-left" :duration="300">
        <!-- Step 2: Identity Input (Bind Mode Only) -->
        <IdentityInput
          v-show="currentStep === 'input'"
          ref="identityInputRef"
          key="input"
        />
      </WTransition>

      <WTransition appear transition-name="slide-left" :duration="300">
        <!-- Step 3: Verification Code -->
        <VerifyCode
          v-show="currentStep === 'verify'"
          ref="verifyCodeRef"
          key="verify"
          @verify="onVerifyCode"
        />
      </WTransition>
    </template>

    <template #action>
      <div v-if="currentStep === 'input'" class="w-full flex justify-end">
        <WButton size="small" class="me-2" @click="onBack">
          {{ t('app.base.back') }}
        </WButton>

        <WButton size="small" type="primary" @click="onCheckInput">
          {{ t('app.base.yes') }}
        </WButton>
      </div>

      <div v-else-if="currentStep === 'verify'" class="w-full flex justify-end">
        <WButton size="small" class="me-2" :disabled="loading" @click="onBack">
          {{ t('app.base.back') }}
        </WButton>

        <!-- data-testid：40119 旅程的显式提交（6 位输满的 onFinish 已能自动提交，这里是兜底入口） -->
        <WButton size="small" type="primary" :disabled="loading" data-testid="verify-auth-submit" @click="onVerifySubmit">
          {{ t('app.base.verify') }}
        </WButton>
      </div>
    </template>
  </WModal>
</template>
