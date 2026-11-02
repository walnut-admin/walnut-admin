import type { AuthMfaAvailableMethod, AuthMfaTotpBind, AuthMfaTotpGenerate, AuthMfaWebauthnAuthenticateOptions, AuthMfaWebauthnRegisterOptions, AuthTokenPayload } from '@walnut/api-types'
import type { IRequestPayload } from '../request'
import { AuthRoutes, SystemEndpointRoutes } from '@walnut/contract'
import { AppAxios } from '@/utils/axios'

/**
 * @description get mfa status
 */
export function authMfaStatusAPI() {
  return AppAxios.get<AuthMfaAvailableMethod[]>({
    url: AuthRoutes.MFA_STATUS,
  })
}

/**
 * @description verify mfa status
 */
export function authMfaVerifyAPI(trusted: boolean) {
  return AppAxios.post<AuthTokenPayload>({
    url: AuthRoutes.MFA_VERIFY,
    data: {
      trusted,
    },
  })
}

/**
 * @description generate totp
 */
export function authMfaTotpGenerateAPI(data: IRequestPayload.Auth.MFA.Totp.Generate) {
  return AppAxios.post<AuthMfaTotpGenerate>({
    url: SystemEndpointRoutes.USER_MFA_TOTP_GENERATE,
    data,
  })
}

/**
 * @description verify totp
 */
export function authMfaTotpVerifyAPI(data: IRequestPayload.Auth.MFA.Totp.Verify) {
  return AppAxios.post<AuthTokenPayload>({
    url: SystemEndpointRoutes.USER_MFA_TOTP_VERIFY,
    data,
  })
}

/**
 * @description bind totp
 */
export function authMfaTotpBindAPI(data: IRequestPayload.Auth.MFA.Totp.Bind) {
  return AppAxios.post<AuthMfaTotpBind>({
    url: SystemEndpointRoutes.USER_MFA_TOTP_BIND,
    data,
  })
}

/**
 * @description unbind totp
 */
export function authMfaTotpUnbindAPI() {
  return AppAxios.delete<boolean>({
    url: SystemEndpointRoutes.USER_MFA_TOTP_UNBIND,
  })
}

/**
 * @description update totp status
 */
export function authMfaTotpUpdateStatusAPI(status: boolean) {
  return AppAxios.put<boolean>({
    url: SystemEndpointRoutes.USER_MFA_TOTP_STATUS,
    data: {
      status,
    },
  })
}

/**
 * @description get webauthn register options
 */
export function authMfaWebauthnRegisterOptionsAPI(data: IRequestPayload.Auth.MFA.Webauthn.RegisterOptions) {
  return AppAxios.post<AuthMfaWebauthnRegisterOptions>({
    url: SystemEndpointRoutes.USER_MFA_WEBAUTHN_REGISTER_OPTIONS,
    data,
  })
}

/**
 * @description verify webauthn register
 */
export function authMfaWebauthnRegisterVerifyAPI(data: IRequestPayload.Auth.MFA.Webauthn.RegisterVerify) {
  return AppAxios.post<boolean>({
    url: SystemEndpointRoutes.USER_MFA_WEBAUTHN_REGISTER_VERIFY,
    data,
  })
}

/**
 * @description get webauthn authenticate options
 */
export function authMfaWebauthnAuthenticateOptionsAPI() {
  return AppAxios.post<AuthMfaWebauthnAuthenticateOptions>({
    url: SystemEndpointRoutes.USER_MFA_WEBAUTHN_AUTHENTICATE_OPTIONS,
  })
}

/**
 * @description verify webauthn authenticate
 */
export function authMfaWebauthnAuthenticateVerifyAPI(data: IRequestPayload.Auth.MFA.Webauthn.AuthenticateVerify) {
  return AppAxios.post<AuthTokenPayload>({
    url: SystemEndpointRoutes.USER_MFA_WEBAUTHN_AUTHENTICATE_VERIFY,
    data,
  })
}
