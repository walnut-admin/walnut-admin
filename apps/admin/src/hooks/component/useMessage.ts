import type { MessageType, NotificationPlacement } from 'naive-ui'
import { AppI18n } from '@/locales/index'
import { useAppStoreNaive } from '@/store/modules/app/app-naive'

export function useAppMessage() {
  return window.$message || {}
}

interface AppMessageOptions {
  type?: MessageType
  duration?: number
  closable?: boolean
  placement?: NotificationPlacement
}

/**
 * @description message usage
 */
export function AppMsg(msg: string, options: AppMessageOptions) {
  // LINK 启动期（bootstrap 的 sign 步骤）早于 naive-ui 的 message provider 挂载，
  // 此时 window.$message 还是 undefined。旧写法 useAppMessage() 返回 {} 再 .create()
  // 会抛 "create is not a function" 并**掩盖真正的错误**（实测：用户只看到这条
  // TypeError，看不到 40012 之类的真实失败原因）。这里降级成 console，保住真错误。
  const message = useAppMessage()
  if (typeof message.create !== 'function') {
    console.warn('[app-msg]', options?.type ?? 'info', msg)
    return
  }

  const appStoreNaive = useAppStoreNaive()

  appStoreNaive.setMsgPlacement(options?.placement ?? 'top')

  message.create(msg, {
    duration: options?.duration ?? 3000,
    closable: options?.closable ?? true,
    type: options.type,
  })
}

export function useAppMsgSuccess(msg?: string, options?: Omit<AppMessageOptions, 'type'>) {
  return AppMsg(msg ?? AppI18n().global?.t('app.base.operation.success'), {
    ...options,
    type: 'success',
  })
}

export function useAppMsgInfo(msg: string, options?: Omit<AppMessageOptions, 'type'>) {
  return AppMsg(msg, { ...options, type: 'info' })
}

export function useAppMsgWarning(msg: string, options?: Omit<AppMessageOptions, 'type'>) {
  return AppMsg(msg, { ...options, type: 'warning' })
}

export function useAppMsgError(msg: string, options?: Omit<AppMessageOptions, 'type'>) {
  return AppMsg(msg, { ...options, type: 'error' })
}
