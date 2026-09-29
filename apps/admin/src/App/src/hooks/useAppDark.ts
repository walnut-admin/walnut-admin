import { watch } from 'vue'
import { isDark } from '@/hooks/app/useAppDark'
import { useAppStoreUserPreference } from '@/store/modules/user/user-preference'

export function useAppDark() {
  const userStorePreference = useAppStoreUserPreference()

  watch(
    () => userStorePreference.getIsDark,
    (v) => {
      isDark.value = v
    },
    {
      immediate: true,
    },
  )
}
