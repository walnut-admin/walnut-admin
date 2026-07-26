// app cron task name
export const WalnutAdminConstAppCronTaskNames = {
  APP_INIT_SETTINGS: 'AppInitSettingsTask',
  APP_ROTATE_KEY: 'AppRotateKeyTask',
  AUTH_STATE: 'AppAuthState',
  AUTH_MFA_SETUP: 'AppAuthMfaSetupTask',
  AUTH_DELETE_REFRESH: 'AppAuthDeleteRefreshTask',
  SYS_INIT_LOCALE_MESSAGES: 'SystemInitLocaleMessageTask',
  SYS_INIT_DEVICE_ID_LIST: 'SystemInitDeviceIdListTask',
  SYS_UPDATE_DEVICE_ACTIVE_STATUS: 'SystemUpdateDeviceActiveStatusTask',
} as const
