import type { AppMonitorUser } from '@walnut/api-types'
import { useEventListener } from '@vueuse/core'
import { useSharedDocumentVisibility } from '@walnut/client/hooks/vueuse/useDocumentVisibility'
import { watch } from 'vue'
import { useAppEnvProxy } from '@/hooks/app/useAppEnv'
import { AppRouter } from '@/router/index'
import { layoutConst } from '@/router/routes/builtin'

import { useAppStoreFingerprint } from '@/store/modules/app/app-fingerprint'

const appStoreFingerprint = useAppStoreFingerprint()

// /state 上报在未登录访客时 userId 为 null（生成 DTO 把 userId 标成必填 string，见 DESIGN-ISSUES），
// 按 wire 事实放宽
export function sendUserMonitorBeacon(data: Omit<Partial<AppMonitorUser>, 'userId'> & { userId?: string | null }) {
  const { httpUrl } = useAppEnvProxy()

  const blob = new Blob(
    [
      JSON.stringify({
        ...data,
        visitorId: appStoreFingerprint.getFingerprint,
      }),
    ],
    { type: 'application/json; charset=UTF-8' },
  )

  if (data.currentRouter === layoutConst.root.path)
    return

  navigator.sendBeacon(`${httpUrl}/app/monitor/user/state`, blob)
}

export function useAppUserMonitor() {
  const isVisible = useSharedDocumentVisibility()

  // route
  watch(
    () => AppRouter.currentRoute.value,
    (v) => {
      sendUserMonitorBeacon({
        currentRouter: v.fullPath,
        focus: true,
        left: false,
      })
    },
    {
      immediate: true,
    },
  )

  // hidden
  watch(
    () => isVisible.value,
    (v) => {
      sendUserMonitorBeacon({
        focus: v,
      })
    },
  )

  // close page
  useEventListener('beforeunload', () => {
    sendUserMonitorBeacon({
      left: true,
      focus: false,
    })
  })
}
