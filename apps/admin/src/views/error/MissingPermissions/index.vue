<script lang="ts" setup>
import { useAppMessage } from '@/hooks/component/useMessage'
import { useAppI18n } from '@/locales/index'
import { useAppStoreUserAuth } from '@/store/modules/user/user-auth'

defineOptions({
  name: 'AppErrorMissingPermissions',
})

const userStoreAuth = useAppStoreUserAuth()

const { t } = useAppI18n()

function onContactAdmin() {
  useAppMessage().warning(t('app.base.wip'))
}

async function onGoToAuth() {
  await userStoreAuth.Signout()
}
</script>

<template>
  <div class="max-w-4xl min-w-[280px] w-full flex items-center justify-center">
    <n-result
      status="warning"
      :title="$t('app.base.missingPermissions')"
    >
      <template #footer>
        <div class="flex flex-row flex-nowrap items-center justify-center gap-x-2">
          <n-button type="info" @click="onGoToAuth">
            {{ $t('app.base.back') }}
          </n-button>

          <n-button type="warning" @click="onContactAdmin">
            {{ $t('app.base.contactAdmin') }}
          </n-button>
        </div>
      </template>
    </n-result>
  </div>
</template>
