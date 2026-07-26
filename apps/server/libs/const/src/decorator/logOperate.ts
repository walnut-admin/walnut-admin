import type { ValueOf } from 'easy-fns-ts'

export const WalnutAdminConstDecoratorLogOperateAction = {
  OTHER: 'OTHER',
  CREATE: 'CREATE',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
  DELETE_MANY: 'DELETE_MANY',
  IMPORT: 'IMPORT',
  EXPORT: 'EXPORT',
  CLEAR: 'CLEAR',
  REFRESH: 'REFRESH',
  AUTH: 'AUTH',
} as const

export type IWalnutAdminConstDecoratorLogOperateAction = ValueOf<
  typeof WalnutAdminConstDecoratorLogOperateAction
>

// <module>.<operation>
export const WalnutAdminConstDecoratorLogOperateType = {
  DELETED_RECOVER: 'deleted.recover',

  APP_MONITOR_USER_FORCE_QUIT: 'appMonitorUser.forceQuit',

  USER_UPDATE_PASSWORD: 'user.updatePassword',
  USER_CLEAR_PASSWORD: 'user.clearPassword',

  DEVICE_LOCK: 'device.lock',
  DEVICE_UNLOCK: 'device.unlock',
  DEVICE_BAN: 'device.ban',
  DEVICE_UNBAN: 'device.unban',

  APP_SETTING_REFRESH_CACHE: 'appSetting.refreshCache',

  AUTH_OPAQUE_CHANGE_PASSWORD: 'auth.opaque.changePassword',
}

export type IWalnutAdminConstDecoratorLogOperateType = ValueOf<
  typeof WalnutAdminConstDecoratorLogOperateType
>

export const WalnutAdminConstDecoratorLogOperateTitle = {
  USER: '用户',
  ROLE: '角色',
  MENU: '菜单',
  LANG: '语言',
  LOCALE: '国际化',
  DELETED: '软删除',
  DICT_TYPE: '字典类型',
  DICT_DATA: '字典数据',
  LOG_OPERATE: '操作日志',
  LOG_AUTH: '登录/注册日志',
  DEVICE: '设备',

  APP_SETTING: '应用设置',
  APP_CACHE: '应用缓存',
  APP_DEMO: '实例',

  APP_LOGGER: '应用日志',
  APP_MONITOR_USER: '用户监控',

  LOCK: '上锁',
  UNLOCK: '解锁',

  USER_PREFERENCE: '用户偏好',
  USER_PROFILE: '用户个人信息',

  AUTH_OPAQUE: 'OPAQUE 认证',
} as const

export type IWalnutAdminConstDecoratorLogOperateTitle = ValueOf<
  typeof WalnutAdminConstDecoratorLogOperateTitle
>
