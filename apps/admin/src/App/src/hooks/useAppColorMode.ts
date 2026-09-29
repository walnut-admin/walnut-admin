import { watch } from 'vue'
import { useAppStoreUserPreference } from '@/store/modules/user/user-preference'

export function useAppColorMode() {
  const userStorePreference = useAppStoreUserPreference()

  watch(
    () => userStorePreference.getColorMode,
    (v) => {
      document.documentElement.setAttribute('color-mode', v)
    },
    {
      immediate: true,
    },
  )
}
