export const WalnutAdminConstDecoratorFunctionalMetadataKey = {
  MAIN_KEY:
    'WALNUT_ADMIN_CONST_DECORATOR_METADATAKEY_MAIN_KEY',
  DETAIL_KEY: 'WALNUT_ADMIN_CONST_DECORATOR_METADATAKEY_DETAIL_KEY',
  // P1-17（2026-10-28）：未配置（缓存缺失 / 主键或明细键缺失）时默认关闭的端点语义。
  // 通用 functional guard 的历史口径是「缺省放行」，Google 登录需要显式 opt-in。
  DEFAULT_CLOSED: 'WALNUT_ADMIN_CONST_DECORATOR_METADATAKEY_DEFAULT_CLOSED',
} as const
