<script lang="ts" setup>
import type { InputHTMLAttributes } from 'vue'
import type { IAppResponseError } from '@/utils/axios/types'
import * as opaque from '@serenity-kit/opaque'
import { computed, onBeforeUnmount, ref } from 'vue'
import { verifyFinishAPI, verifyStartAPI } from '@/api/system/user_lock'
import { AppConstLockMode } from '@/const/app'
import { useAppI18n } from '@/locales/index'
import { useAppStoreLock } from '@/store/modules/app/app-lock'
import { useAppStoreUserProfile } from '@/store/modules/user/user-profile'
import UnlockButton from './UnlockButton.vue'

defineOptions({
  name: 'WAppLockUnlockPanel',
})

/**
 * 与 `user-auth.ts` 的登录 OPAQUE 交换必须用同一个 server identifier；漂移的症状是
 * fallback 的 `finishLogin` 永远返回 undefined（客户端判定为口令错）。
 */
const opaqueServerIdentifier = 'walnut-admin'

const { t } = useAppI18n()
const appStoreLock = useAppStoreLock()
const userStoreProfile = useAppStoreUserProfile()

const isSecurity = computed(() => appStoreLock.getLockMode === AppConstLockMode.SECURITY)

const pwd = ref('')
const unlockError = ref('')
const submitting = ref(false)
const countdown = ref(0)

const showFallback = ref(false)
const loginPwd = ref('')
const fallbackError = ref('')

/**
 * E2E 稳定选择器要落在**真实 `<input>`** 上（`input-props` 才是它的落点）。
 * `InputHTMLAttributes` 没有 `data-*` 索引签名，按仓库既有写法做一次窄 cast。
 */
const lockPwdInputProps = { 'data-testid': 'lock-pwd-input', 'autocomplete': 'current-password' } as unknown as InputHTMLAttributes
const fallbackPwdInputProps = { 'data-testid': 'lock-fallback-input', 'autocomplete': 'current-password' } as unknown as InputHTMLAttributes

let countdownTimer: ReturnType<typeof setInterval> | undefined

function stopCountdown() {
  if (countdownTimer !== undefined) {
    clearInterval(countdownTimer)
    countdownTimer = undefined
  }
}

/**
 * 服务端 `meta.retryAfterSec` 的可视化倒计时。
 *
 * 退避期内提交按钮直接禁用；倒计时归零后**仍由服务端**判定是否放行（客户端时钟只做
 * 展示，不参与安全判定）。每次重新提交失败会重启倒计时（下一档更长）。
 */
function startCountdown(seconds: number | undefined) {
  stopCountdown()
  countdown.value = seconds !== undefined && seconds > 0 ? Math.ceil(seconds) : 0

  if (countdown.value === 0) {
    return
  }

  countdownTimer = setInterval(() => {
    countdown.value = Math.max(0, countdown.value - 1)
    if (countdown.value === 0) {
      stopCountdown()
    }
  }, 1000)
}

function applyResponseError(error: unknown, target: 'unlock' | 'fallback') {
  const err = error as IAppResponseError
  const message = err.msg ?? err.message ?? t('app.base.failure')
  const retryAfterSec = (err.meta as { retryAfterSec?: number } | undefined)?.retryAfterSec

  if (target === 'unlock') {
    unlockError.value = message
  }
  else {
    fallbackError.value = message
  }

  if (retryAfterSec !== undefined) {
    startCountdown(retryAfterSec)
  }
}

async function onUnlock() {
  if (!pwd.value || submitting.value || countdown.value > 0) {
    return
  }

  submitting.value = true
  unlockError.value = ''

  try {
    await appStoreLock.unLock(pwd.value)
  }
  catch (error) {
    // D4：停在本页显示红字 / 倒计时，不跳首页
    applyResponseError(error, 'unlock')
  }
  finally {
    submitting.value = false
  }
}

function toggleFallback() {
  showFallback.value = !showFallback.value
  fallbackError.value = ''
  loginPwd.value = ''
}

async function onFallbackSubmit() {
  if (!loginPwd.value || submitting.value || countdown.value > 0) {
    return
  }

  submitting.value = true
  fallbackError.value = ''

  try {
    const userName = userStoreProfile.getUserName
    if (!userName) {
      fallbackError.value = t('app.base.failure')
      return
    }

    // 方案①（Q8）：与登录同一套 OPAQUE 客户端序列，服务端落 `unlock` 命名空间状态、
    // 验证通过就地解锁且**不签发 token**。密码永不离开客户端。
    const { clientLoginState, startLoginRequest } = opaque.client.startLogin({ password: loginPwd.value })
    const loginResponse = await verifyStartAPI({ start: startLoginRequest })

    const loginResult = opaque.client.finishLogin({
      clientLoginState,
      loginResponse,
      password: loginPwd.value,
      identifiers: {
        client: userName,
        server: opaqueServerIdentifier,
      },
    })

    // OPAQUE 口令错在客户端就返回 undefined —— 不调 verify/finish，因此服务端计不到次。
    // 倒计时只能由服务端 meta 驱动，这里不伪造退避。
    if (!loginResult) {
      fallbackError.value = t('app.security.lock.fallback.pwdErr')
      return
    }

    if (loginResult.serverStaticPublicKey !== import.meta.env.VITE_SERVER_STATIC_PUBLIC_KEY) {
      fallbackError.value = t('app.base.failure')
      return
    }

    await verifyFinishAPI({ finish: loginResult.finishLoginRequest })
    await appStoreLock.logicAfterUnlock()
  }
  catch (error) {
    // 40115（设备未完成 MFA）由响应拦截器跳 `/mfa-verified`；D3 已把该路由加入锁屏
    // 守卫白名单。这里不再覆盖用户可见错误（页面马上要走了）。
    if (error instanceof Error && error.message === 'MFA Verified') {
      return
    }

    applyResponseError(error, 'fallback')
  }
  finally {
    submitting.value = false
  }
}

onBeforeUnmount(stopCountdown)
</script>

<template>
  <!-- default / idle：免密解锁按钮（与旧 UI 完全一致） -->
  <UnlockButton v-if="!isSecurity" />

  <!-- security：锁屏密码 / 登录口令兜底 -->
  <div
    v-else
    class="absolute left-1/2 top-1/4 z-20 w-[min(90vw,380px)] -translate-x-1/2"
    data-testid="lock-security-panel"
  >
    <n-card :bordered="false" class="bg-white/90 shadow-lg dark:bg-black/70">
      <template #header>
        {{ $t('app.intro.lock') }}
      </template>

      <div v-if="!showFallback" class="flex flex-col gap-y-3">
        <n-input
          v-model:value="pwd"
          type="password"
          show-password-on="click"
          :placeholder="$t('app.security.lock.pwd')"
          :input-props="lockPwdInputProps"
          :disabled="submitting"
          @keyup.enter="onUnlock"
        />

        <n-button
          type="primary"
          block
          data-testid="lock-unlock-submit"
          :loading="submitting"
          :disabled="!pwd || countdown > 0"
          @click="onUnlock"
        >
          {{ $t('app.security.lock.unlock') }}
        </n-button>

        <p v-if="unlockError" class="text-sm text-red-500" data-testid="lock-unlock-error">
          {{ unlockError }}
        </p>

        <p v-if="countdown > 0" class="text-sm text-orange-500" data-testid="lock-retry-countdown">
          {{ countdown }}s
        </p>

        <n-button text type="primary" data-testid="lock-forgot-link" @click="toggleFallback">
          {{ $t('app.security.lock.forgot') }}
        </n-button>
      </div>

      <div v-else class="flex flex-col gap-y-3" data-testid="lock-fallback-panel">
        <p class="text-sm font-medium">
          {{ $t('app.security.lock.fallback') }}
        </p>

        <n-input
          v-model:value="loginPwd"
          type="password"
          show-password-on="click"
          :placeholder="$t('app.security.opaque')"
          :input-props="fallbackPwdInputProps"
          :disabled="submitting"
          @keyup.enter="onFallbackSubmit"
        />

        <n-button
          type="primary"
          block
          data-testid="lock-fallback-submit"
          :loading="submitting"
          :disabled="!loginPwd || countdown > 0"
          @click="onFallbackSubmit"
        >
          {{ $t('app.security.lock.unlock') }}
        </n-button>

        <p v-if="fallbackError" class="text-sm text-red-500" data-testid="lock-fallback-error">
          {{ fallbackError }}
        </p>

        <p v-if="countdown > 0" class="text-sm text-orange-500" data-testid="lock-fallback-countdown">
          {{ countdown }}s
        </p>

        <!-- 方案②：也可以在另一台设备完整登录一次（按 lockCrossDevice 解锁） -->
        <p class="text-xs text-gray-400" data-testid="lock-fallback-hint">
          {{ $t('app.security.lock.fallback.hint') }}
        </p>

        <n-button text data-testid="lock-fallback-back" @click="toggleFallback">
          {{ $t('app.security.lock.fallback.back') }}
        </n-button>
      </div>
    </n-card>
  </div>
</template>
