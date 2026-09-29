<script lang="ts" setup>
import type { SelectMixedOption } from 'naive-ui/es/select/src/interface'
import type { IStoreUser } from '@/store/types'
import { computed, ref } from 'vue'
import { updatePreferenceBasicAPI } from '@/api/system/user_preference'
import { useForm } from '@/components/UI/Form'
import { useAppMsgSuccess } from '@/hooks/component/useMessage'
import { useAppI18n } from '@/locales/index'
import { useAppStoreAdapter } from '@/store/modules/app/app-adapter'
import { useAppStoreLocale } from '@/store/modules/app/app-locale'
import { useAppStoreUserPreference } from '@/store/modules/user/user-preference'

defineOptions({
  name: 'WMeTabPreferenceBasic',
  defaultView: false,
})

const userStorePreference = useAppStoreUserPreference()
const appStoreLocale = useAppStoreLocale()
const appStoreAdapter = useAppStoreAdapter()

const { t } = useAppI18n()

const loading = ref(false)

const [register] = useForm<IStoreUser.Preference.Basic>({
  inline: true,
  labelPlacement: appStoreAdapter.isMobile ? 'top' : 'left',
  labelAlign: appStoreAdapter.isMobile ? 'left' : 'right',
  labelWidth: 120,

  disabled: computed(() => loading.value),
  schemas: [
    {
      type: 'Base:Select',
      formProp: {
        path: 'locale',
        label: computed(() => t('app.base.language')),
      },
      componentProp: {
        options: computed(() => appStoreLocale.getLangList) as unknown as SelectMixedOption[],
      },
    },
    {
      type: 'Base:Button',
      componentProp: {
        textProp: () => t('app.base.save'),
        type: 'primary',
        loading: computed(() => loading.value),
        disabled: computed(() => loading.value),
        debounce: 500,
        onClick: async () => {
          loading.value = true

          try {
            await updatePreferenceBasicAPI(userStorePreference.basic)
            useAppMsgSuccess()
          }
          finally {
            loading.value = false
          }
        },
      },
    },
  ],
})
</script>

<template>
  <div class="w-2/5 max-lg:w-full">
    <WForm :model="userStorePreference.basic" @hook="register" />
  </div>
</template>
