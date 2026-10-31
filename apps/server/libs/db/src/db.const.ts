/**
 * 模型名常量 —— 迁移后仍被 PG 通道消费：
 * - PG 版仓库骨架以它作软删快照的 `modelName` 路由键（pg-base.repository）；
 * - 回收站恢复注册表以它把快照路由回目标实体（libs/repository 的 recoverable.registry）。
 * （`WalnutDBConnectionName` / `WalnutDBCollectionName` 是 Mongo 连接与集合的名字，
 * Phase 5a 随 MongoDB 基础设施一并摘除。）
 */
export const WalnutModelName = {
  SYS_DELETED: 'SysDeleted',

  SYS_ROLE: 'SysRole',
  SYS_USER: 'SysUser',
  SYS_USER_OAUTH: 'SysUserOAuth',
  SYS_USER_PREFERENCE: 'SysUserPreference',
  SYS_USER_LOCK: 'SysUserLock',
  SYS_USER_DEVICE: 'SysUserDevice',
  SYS_USER_MFA: 'SysUserMfa',
  SYS_USER_IDENTITY: 'SysUserIdentity',
  SYS_MENU: 'SysMenu',
  SYS_LANG: 'SysLang',
  SYS_LOCALE: 'SysLocale',
  SYS_DEVICE: 'SysDevice',

  // 组织基础表（部门 / 岗位 / 职工）—— 数据权限二期部门维度的地基
  SYS_DEPT: 'SysDept',
  SYS_POST: 'SysPost',
  SYS_EMPLOYEE: 'SysEmployee',

  SYS_LOG_AUTH: 'SysLogAuth',
  SYS_LOG_OPERATE: 'SysLogOperate',

  SYS_DICT_DATA: 'SysDictData',
  SYS_DICT_TYPE: 'SysDictType',

  SHARED_AREA: 'SharedArea',

  APP_DEMO: 'AppDemo',
  APP_MONITOR_USER: 'AppMonitorUser',
  APP_SETTING: 'AppSetting',
  APP_ERROR: 'AppError',
  APP_KEY: 'AppKey',

  AUTH_REFRESH_TOKEN: 'AuthRefreshToken',
} as const

/** populate 出参键（回收站 read 的 user 等；PG 通道沿用同一键名） */
export const WalnutVirtualName = {
  USER: 'user',
  ROLES_LIST: 'roles_list',
  ROLES_COUNT: 'roles_count',
  DEVICE: 'device',
  MONITOR_USER: 'monitor_user',
  LOG_OPERATE: 'log_operate',
} as const
