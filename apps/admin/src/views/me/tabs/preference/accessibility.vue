<script lang="ts" setup>
import type { IStoreUser } from '@/store/types'
import { fontSizeValues } from '@walnut/contract/preference'
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

// 字号可选值的单一真源是 @walnut/contract（server IsEnum + DB CHECK 同源），
// 滑杆的 min / max / marks 全部由 fontSizeValues 派生，别再手写刻度。
const fontSizeMarks = Object.fromEntries(fontSizeValues.map(value => [value, `${value}px`]))
const fontSizeMin = Math.min(...fontSizeValues)
const fontSizeMax = Math.max(...fontSizeValues)

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
        min: fontSizeMin,
        max: fontSizeMax,
        marks: fontSizeMarks,
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
