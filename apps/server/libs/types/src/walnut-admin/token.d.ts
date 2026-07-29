import { WalnutAdminConstRoleMode } from '@walnut-server/const/role'
import type { RoleType, IWalnutAdminConstRoleMode } from '@walnut/contract'

declare global {
  interface IWalnutAdminAccessTokenPayload {
    sid?: string

    userName: string
    userId: string
    roleIds: string[]
    roleNames: RoleType[]
    currentRole: string
    roleMode: IWalnutAdminConstRoleMode
    currentRoleName: RoleType
    mfaSetup: boolean
    mfaVerified: boolean

    key?: string
    iat?: number
    exp?: number
  }

  type IWalnutAdminTokenUser = Omit<
    IWalnutAdminAccessTokenPayload,
    'key' | 'iat' | 'exp'
  >

  interface IWalnutAdminRefreshTokenPayload {
    sid: string
    jti: string
  }
}

export {}
