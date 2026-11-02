import type { AppMonitorUser } from '@walnut/api-types'
import { useEventListener } from '@vueuse/core'
import { useSharedDocumentVisibility } from '@walnut/client/hooks/vueuse/useDocumentVisibility'
import { watch } from 'vue'
import { useAppEnvProxy } from '@/hooks/app/useAppEnv'
import { AppRouter } from '@/router/index'
import { layoutConst } from '@/router/routes/builtin'

import { useAppStoreFingerprint } from '@/store/modules/app/app-fingerprint'
import { useAppStoreUserAuth } from '@/store/modules/user/user-auth'
import { isDev } from '@/utils/constant/vue'

const appStoreFingerprint = useAppStoreFingerprint()

/**
 * @description 用户在线状态心跳（`POST /app/monitor/user/state`）
 *
 * payload 侧：未登录访客时 userId 为 null（生成 DTO 把 userId 标成必填 string，见 DESIGN-ISSUES），
 * 按 wire 事实放宽；该字段服务端现在只作兼容接收，身份一律以 AT 的验签结果为准。
 *
 * F-47（安全纵深，服务端在批次 4-B 落地）：该端点是**匿名心跳**（Sign / JWT / CAP / Device
 * 四个守卫全 Free），因此不再采信请求体里自报的 `userId` —— 只有携带**验签通过**的
 * `Authorization: Bearer <AT>` 时才把 userId 关联到这一行，否则一律当匿名处理。
 *
 * 所以心跳必须带上 AT：原先的 `navigator.sendBeacon` **带不了自定义头**，上线后会表现为
 * 「登录态心跳不再关联用户」（在线监控用户列 / sys_user_device 联动缺数据）。这里改
 * `fetch` + `keepalive: true`：keepalive 让请求在**页面卸载后仍然继续发**，语义与
 * sendBeacon 等价（含 `beforeunload` 那次 `left: true` 上报）。
 *
 * 失败一律静默（仅 dev 下一条 `console.debug`）：心跳是旁观性上报，不能打断路由切换 /
 * 页面卸载，也不该给用户弹提示。
 */
export function sendUserMonitorBeacon(data: Omit<Partial<AppMonitorUser>, 'userId'> & { userId?: string | null }) {
  const { httpUrl } = useAppEnvProxy()

  if (data.currentRouter === layoutConst.root.path)
    return

  // 只读：AT 就在 pinia state 里（启动时从持久化载入过一次），卸载期同步读取不触发 I/O，
  // 因此 beforeunload 里也一定读得到（未登录 / 已登出时为 null ⇒ 匿名心跳，服务端照常更新 focus/left）
  const token = useAppStoreUserAuth().getAccessToken

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }

  if (token)
    headers.Authorization = `Bearer ${token}`

  void fetch(`${httpUrl}/app/monitor/user/state`, {
    method: 'POST',
    // 与 sendBeacon 语义对齐：请求在页面卸载 / 销毁后仍会被发出
    keepalive: true,
    // sendBeacon 恒带 cookie（credentials mode = include），fetch 默认只同源带 —— 显式对齐
    credentials: 'include',
    headers,
    body: JSON.stringify({
      ...data,
      visitorId: appStoreFingerprint.getFingerprint,
    }),
  }).catch((error: unknown) => {
    if (isDev())
      console.debug('[monitor] user state beacon failed', error)
  })
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
