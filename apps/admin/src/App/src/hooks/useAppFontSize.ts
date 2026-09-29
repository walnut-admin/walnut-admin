import { watch } from 'vue'
import { useAppStoreUserPreference } from '@/store/modules/user/user-preference'

export function useAppFontSize() {
  const userStorePreference = useAppStoreUserPreference()

  watch(
    () => userStorePreference.getFontSize,
    (v) => {
      document.documentElement.style.fontSize = `${v}px`
    },
    {
      immediate: true,
    },
  )
}
