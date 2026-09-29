import type { EffectScope } from 'vue'
import type { IStoreApp } from '@/store/types'
import { tryOnMounted } from '@vueuse/core'
import { useAppStorageSync } from '@walnut/client/persistent/storage/sync'
import { effectScope, onScopeDispose, watch } from 'vue'
import { AppConstPersistKey } from '@/const/persistent'
import { useAppStoreTab } from '@/store/modules/app/app-tab'
import { useAppStoreSettingDev } from '@/store/modules/setting/setting-dev'

export function useTabsPersistent() {
  let scope: EffectScope

  const appStoreTab = useAppStoreTab()
  const appStoreSettingDev = useAppStoreSettingDev()

  watch(
    () => appStoreSettingDev.getTabsPersistent,
    (v) => {
      if (v) {
        scope = effectScope()

        scope.run(() => {
          const _storaged_tabs = useAppStorageSync<IStoreApp.Tab.Item[]>(
            AppConstPersistKey.TABS,
            appStoreTab.tabs,
          )

          watch(
            () => appStoreTab.tabs,
            (v) => {
              _storaged_tabs.value = v
            },
            {
              deep: true,
            },
          )

          tryOnMounted(() => {
            if (_storaged_tabs.value?.length)
              appStoreTab.tabs = _storaged_tabs.value
          })

          onScopeDispose(() => {
            const key = Object.keys(localStorage).find(i =>
              i.includes(AppConstPersistKey.TABS),
            )

            key && localStorage.removeItem(key)
          })
        })
      }
      else {
        scope?.stop()
      }
    },
    {
      immediate: true,
    },
  )
}
