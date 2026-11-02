import type { IWalnutAdminConstRevokeRTType } from '@walnut-server/const/app/setting'

declare global {
  interface IWalnutAdminUserLogoutPayload {
    trigger: 'user-logout'
    deviceId: string
    sid: string
    ip: string
  }

  interface IWalnutAdminUserKickOtherPayload {
    trigger: 'user-kick-other'
    deviceId: string
    fingerprint: string
    isOnline: boolean
  }

  interface IWalnutAdminAdminKickPayload {
    trigger: 'admin-kick'
    deviceId: string
    fingerprint: string
    revokeReason?: IWalnutAdminConstRevokeRTType
    isOnline: boolean
  }

  interface IWalnutAdminSecurityPolicyPayload {
    trigger: 'security-policy'
    revokeReason: IWalnutAdminConstRevokeRTType
  }

  type IWalnutAdminSignoutPayload =
    | IWalnutAdminUserLogoutPayload
    | IWalnutAdminUserKickOtherPayload
    | IWalnutAdminAdminKickPayload
    | IWalnutAdminSecurityPolicyPayload
}

export {}
