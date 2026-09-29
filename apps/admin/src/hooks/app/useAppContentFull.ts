import { watchEffect } from 'vue'
import { useRouterQuery } from '@/hooks/web/useRouterQuery'
import { useAppStoreSettingDev } from '@/store/modules/setting/setting-dev'

export function useAppContentFull() {
  const appStoreSettingDev = useAppStoreSettingDev()
  const full = useRouterQuery('full')

  watchEffect(() => {
    if (full.value)
      appStoreSettingDev.toggleLayout(false)
  })
}
