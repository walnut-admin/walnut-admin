import type { EffectScope } from 'vue'
import { useEventListener } from '@vueuse/core'
import { toggleLocalRefreshFlag } from '@walnut/client/hooks/core/useLocalRefresh'
import { effectScope, watch } from 'vue'
import { useAppRouter } from '@/router/index'
import { useAppStoreSettingScope } from '@/store/modules/setting/setting-scope'

export function useAppHijackF5() {
  let scope: EffectScope

  const appSettingScope = useAppStoreSettingScope()
  const { currentRoute } = useAppRouter()

  watch(
    () => appSettingScope.getHijackRefreshStatus,
    (v) => {
      if (v) {
        scope = effectScope()
        scope.run(() => {
          useEventListener('keydown', async (e) => {
            if (appSettingScope.getHijackRefresh(currentRoute.value) && e.key === 'F5') {
              e.preventDefault()
              toggleLocalRefreshFlag()
            }
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
