<script lang="ts" setup>
import type { IStoreUser } from '@/store/types'
import { computed, ref } from 'vue'
import { updateAccessibilityPreferenceAPI } from '@/api/system/user_preference'
import { useForm } from '@/components/UI/Form'
import { AppConstColorMode, AppConstCVD } from '@/const/app'
import { useAppMsgSuccess } from '@/hooks/component/useMessage'
import { useAppI18n } from '@/locales/index'
import { useAppStoreAdapter } from '@/store/modules/app/app-adapter'
import { useAppStoreUserPreference } from '@/store/modules/user/user-preference'

defineOptions({
  name: 'WMeTabPreferenceAccessibility',
  defaultView: false,
})

const userStorePreference = useAppStoreUserPreference()
const appStoreAdapter = useAppStoreAdapter()
const { t } = useAppI18n()

const loading = ref(false)

const [register] = useForm<IStoreUser.Preference.Accessibility>({
  inline: true,
  labelPlacement: appStoreAdapter.isMobile ? 'top' : 'left',
  labelAlign: appStoreAdapter.isMobile ? 'left' : 'right',
  labelWidth: 120,

  disabled: computed(() => loading.value),
  schemas: [
    {
      type: 'Raw:Slider',
      formProp: {
        path: 'fontSize',
      },
      componentProp: {
        step: 'mark',
        min: 12,
        max: 20,
        marks: {
          12: '12px',
          14: '14px',
          16: '16px',
          18: '18px',
          20: '20px',
        },
      },
    },
    {
      type: 'Base:Switch',
      formProp: {
        path: 'reducedMotion',
      },
      componentProp: {},
    },
    {
      type: 'Base:Select',
      formProp: {
        path: 'colorMode',
      },
      componentProp: {
        options: Object.values(AppConstColorMode).map(i => ({
          value: i,
          label: i,
        })),
      },
    },
    {
      type: 'Base:Select',
      formProp: {
        path: 'CVD',
      },
      componentProp: {
        options: Object.values(AppConstCVD).map(i => ({
          value: i,
          label: i,
        })),
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
            await updateAccessibilityPreferenceAPI(userStorePreference.accessibility)
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
    <WForm :model="userStorePreference.accessibility" @hook="register" />
  </div>
</template>
