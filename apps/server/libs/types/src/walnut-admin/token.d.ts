import type { IWalnutAdminAccessTokenPayload as _AccessTokenPayload, IWalnutAdminRefreshTokenPayload as _RefreshTokenPayload } from '@walnut/contract'

// Re-declare as global for backward compatibility — canonical definitions in @walnut/contract/token
declare global {
  type IWalnutAdminAccessTokenPayload = _AccessTokenPayload
  type IWalnutAdminRefreshTokenPayload = _RefreshTokenPayload
  type IWalnutAdminTokenUser = Omit<IWalnutAdminAccessTokenPayload, 'key' | 'iat' | 'exp'>
}

export {}
