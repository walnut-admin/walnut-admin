/**
 * 模型名常量 —— 迁移后仍被 PG 通道消费：
 * - PG 版仓库骨架以它作软删快照的 `modelName` 路由键（pg-base.repository）；
 * - 回收站恢复注册表以它把快照路由回目标实体（recover-registry.ts）。
 * （`WalnutDBConnectionName` / `WalnutDBCollectionName` 是 Mongo 连接与集合的名字，
 * Phase 5a 随 MongoDB 基础设施一并摘除。）
 */
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

/** populate 出参键（回收站 read 的 populated_user 等；PG 通道沿用同一键名） */
export const WalnutDBVirtualName = {
  USER: 'populated_user',
  ROLES_LIST: 'populated_roles_list',
  ROLES_COUNT: 'populated_roles_count',
  DEVICE: 'populated_device',
  MONITOR_USER: 'populated_monitor_user',
  LOG_OPERATE: 'populated_log_operate',
} as const
