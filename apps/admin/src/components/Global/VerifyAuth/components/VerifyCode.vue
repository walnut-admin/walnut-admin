<script lang="ts" setup>
import type { Ref } from 'vue'
import type { VerifyAuthMethod } from '../types'
import { useState } from '@walnut/client/hooks/core/useState'
import { computed, inject } from 'vue'
import { useForm } from '@/components/UI/Form'

/**
 * Step 3: Verification Code Input
 * Handles SMS, Email, and TOTP verification code input
 * Uses WForm with Raw:InputOtp - consistent with otp.vue pattern
 */

defineOptions({
  name: 'WCompBusinessVerifyAuthVerifyCode',
})

const emit = defineEmits<{
  (e: 'verify', code: string): void
}>()

const selectedMethod = inject<Ref<VerifyAuthMethod>>('selectedMethod')!

// Form data - using useState pattern from otp.vue
const { stateRef: formData } = useState({
  verifyCode: [] as string[],
  description: null,
})

const [register] = useForm<typeof formData.value>({
  baseRules: true,
  schemas: [
    {
      type: 'Base:Slot',
      formProp: {
        path: 'description',
        showLabel: false,
      },
      visibleProp: {
        vIf: computed(() => !!selectedMethod.value?.maskedValue),
      },
    },
    {
      type: 'Raw:InputOtp',
      formProp: {
        path: 'verifyCode',
        labelPlacement: 'top',
        labelAlign: 'left',
      },
      componentProp: {
        block: true,
        onFinish: async () => {
          await onVerify()
        },
      },
    },
  ],
})

/**
 * Handle verification submit
 */
async function onVerify() {
  if (!formData.value.verifyCode?.length || formData.value.verifyCode.length < 6) {
    return
  }

  const code = formData.value.verifyCode.join('')
  emit('verify', code)
}

/**
 * 给弹窗底部「验证」按钮的显式提交入口（E1 发现该按钮此前没有 click handler，
 * 只能靠 6 位输满的 onFinish 提交）。未输满时 no-op —— 与 onFinish 同一判据。
 */
defineExpose({ submit: onVerify })
</script>

<template>
  <!-- data-testid：二次验证弹窗的验证码步骤（40119 旅程填完 6 位码即由 onFinish 自动提交） -->
  <div data-testid="verify-auth-code">
    <!-- @vue-generic {typeof formData.value} -->
    <WForm :model="formData" @hook="register">
      <template #description>
        <div class="mb-4 text-center text-sm text-gray-500">
          {{ selectedMethod.maskedValue }}
        </div>
      </template>
    </WForm>
  </div>
</template>
