import { useSharedPreferredReducedMotion } from '@walnut/client/hooks/vueuse/usePreferredReducedMotion'
import { watch, watchEffect } from 'vue'
import { useAppStoreUserPreference } from '@/store/modules/user/user-preference'

export function useAppReducedMotion() {
  const userStorePreference = useAppStoreUserPreference()
  const isReducedMotion = useSharedPreferredReducedMotion()

  watch(
    () => userStorePreference.getReducedMotion,
    (v) => {
      document.documentElement.setAttribute('reduced-motion', `${v}`)
    },
    {
      immediate: true,
    },
  )

  watchEffect(() => {
    userStorePreference.accessibility.reducedMotion = isReducedMotion.value
  })
}
