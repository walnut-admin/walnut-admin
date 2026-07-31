import type { RoleType } from './role'

/**
 * JWT access token payload — shared between frontend (decode) and backend (sign/verify).
 */
export interface IWalnutAdminAccessTokenPayload {
  sid?: string
  userName: string
  userId: string
  roleIds: string[]
  roleNames: RoleType[]
  currentRole: string
  roleMode: string
  currentRoleName: RoleType
  mfaSetup: boolean
  mfaVerified: boolean
  key?: string
  iat?: number
  exp?: number
}

/** Derived type: access token payload without crypto/time fields */
export type IWalnutAdminTokenUser = Omit<
  IWalnutAdminAccessTokenPayload,
  'key' | 'iat' | 'exp'
>

/** JWT refresh token payload */
export interface IWalnutAdminRefreshTokenPayload {
  sid: string
  jti: string
}
