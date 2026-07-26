export const WalnutDBConnectionName = 'WalnutPrimaryConnectionDatabase'

export const WalnutDBCollectionName = {
  ROLE: 'sys_role',
  USER: 'sys_user',
  USER_OAUTH: 'sys_user_oauth',
  USER_PREFERENCE: 'sys_user_preference',
  USER_LOCK: 'sys_user_lock',
  USER_DEVICE: 'sys_user_device',
  USER_MFA: 'sys_user_mfa',
  USER_IDENTITY: 'sys_user_identity',
  MENU: 'sys_menu',
  LANG: 'sys_lang',
  LOCALE: 'sys_locale',
  DELETED: 'sys_deleted',
  DEVICE: 'sys_device',

  LOG_OPERATE: 'sys_log_operate',
  LOG_AUTH: 'sys_log_auth',

  DICT_TYPE: 'sys_dict_type',
  DICT_DATA: 'sys_dict_data',

  SHARED_AREA: 'shared_area',

  APP_SETTING: 'app_setting',
  APP_DEMO: 'app_demo',
  APP_MONITOR_USER: 'app_monitor_user',
  APP_ERROR: 'app_error',
  APP_KEY: 'app_key',

  AUTH_REFRESH_TOKEN: 'auth_refresh_token',
} as const

export const WalnutDBModelName = {
  SYS_DELETED: 'SysDeletedModel',

  SYS_ROLE: 'SysRoleModel',
  SYS_USER: 'SysUserModel',
  SYS_USER_OAUTH: 'SysUserOAuthModel',
  SYS_USER_PREFERENCE: 'SysUserPreferenceModel',
  SYS_USER_LOCK: 'SysUserLockModel',
  SYS_USER_DEVICE: 'SysUserDeviceModel',
  SYS_USER_MFA: 'SysUserMfaModel',
  SYS_USER_IDENTITY: 'SysUserIdentityModel',
  SYS_MENU: 'SysMenuModel',
  SYS_LANG: 'SysLangModel',
  SYS_LOCALE: 'SysLocaleModel',
  SYS_DEVICE: 'SysDeviceModel',

  SYS_LOG_AUTH: 'SysLogAuthModel',
  SYS_LOG_OPERATE: 'SysLogOperateModel',

  SYS_DICT_DATA: 'SysDictDataModel',
  SYS_DICT_TYPE: 'SysDictTypeModel',

  SHARED_AREA: 'SharedAreaModel',

  APP_DEMO: 'AppDemoModel',
  APP_MONITOR_USER: 'AppMonitorUserModel',
  APP_SETTING: 'AppSettingModel',
  APP_ERROR: 'AppErrorModel',
  APP_KEY: 'AppKeyModel',

  AUTH_REFRESH_TOKEN: 'AuthRefreshTokenModel',
} as const

export const WalnutDBVirtualName = {
  USER: 'populated_user',
  ROLES_LIST: 'populated_roles_list',
  ROLES_COUNT: 'populated_roles_count',
  DEVICE: 'populated_device',
  MONITOR_USER: 'populated_monitor_user',
  LOG_OPERATE: 'populated_log_operate',
} as const
