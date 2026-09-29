import type { RouteLocationRaw } from 'vue-router'
import { computed } from 'vue'
import { useAppRoute, useAppRouter } from '@/router/index'
import { useAppStoreSettingScope } from '@/store/modules/setting/setting-scope'

export function useRouterParam(path: string, defaultValue?: string) {
  const router = useAppRouter()
  const route = useAppRoute()
  const appSettingScope = useAppStoreSettingScope()

  const routeParam = computed({
    get() {
      if (appSettingScope.getRouterEnhanceWhiteListCondition(route))
        return route.params[path] || defaultValue

      return (route.meta?._resolvedParams ?? {})[path] || defaultValue
    },
    set(val) {
      router.replace({ ...router.currentRoute.value, params: { ...router.currentRoute.value.params, [path]: val || defaultValue } } as RouteLocationRaw)
    },
  })

  return routeParam
}
