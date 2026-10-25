// app cron task name
export const WalnutAdminConstAppCronTaskNames = {
  APP_INIT_SETTINGS: 'AppInitSettingsTask',
  APP_ROTATE_KEY: 'AppRotateKeyTask',
  AUTH_STATE: 'AppAuthState',
  AUTH_MFA_SETUP: 'AppAuthMfaSetupTask',
  AUTH_DELETE_REFRESH: 'AppAuthDeleteRefreshTask',
  // PG 版过期 refresh token 物理清理（phase2 第 6 节 Q10-b：Nest schedule 交付物）
  AUTH_DELETE_REFRESH_PG_PURGE: 'AppAuthDeleteRefreshPgPurgeTask',
  SYS_INIT_LOCALE_MESSAGES: 'SystemInitLocaleMessageTask',
  SYS_INIT_DEVICE_ID_LIST: 'SystemInitDeviceIdListTask',
  SYS_UPDATE_DEVICE_ACTIVE_STATUS: 'SystemUpdateDeviceActiveStatusTask',
} as const
