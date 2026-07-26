import type { IWalnutAdminConstRole, IWalnutAdminConstRoleMode } from '@walnut/const/role/index'

declare global {
  interface IWalnutAdminAccessTokenPayload {
    sid?: string

    userName: string
    userId: string
    roleIds: string[]
    roleNames: IWalnutAdminConstRole[]
    currentRole: string
    roleMode: IWalnutAdminConstRoleMode
    currentRoleName: IWalnutAdminConstRole
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
