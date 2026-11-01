import type { AuthTokenPayload } from '@walnut/api-types'
import type { IRequestPayload } from '../request'
import { AuthRoutes } from '@walnut/contract'
import { AppAxios } from '@/utils/axios'

/**
 * @description opaque login start
 */
export function opaqueLoginStartAPI(data: IRequestPayload.Auth.Opaque.Login.Start) {
  return AppAxios.post<string>({
    url: AuthRoutes.OPAQUE_USER_LOGIN_START,
    data,
  })
}

/**
 * @description opaque login finish
 */
export function opaqueLoginFinishAPI(data: IRequestPayload.Auth.Opaque.Login.Finish) {
  return AppAxios.post<AuthTokenPayload>({
    url: AuthRoutes.OPAQUE_USER_LOGIN_FINISH,
    data,
  })
}

/**
 * @description opaque login client error
 */
export function opaqueLoginClientErrorAPI(data: IRequestPayload.Auth.Opaque.Login.ClientError) {
  return AppAxios.post<boolean>({
    url: AuthRoutes.OPAQUE_USER_LOGIN_CLIENT_ERROR,
    data,
  })
}

/**
 * @description opaque change password start
 */
export function opaqueChangePasswordStartAPI(data: IRequestPayload.Auth.Opaque.Register.Start) {
  return AppAxios.post<string>({
    url: AuthRoutes.OPAQUE_USER_CHANGE_PASSWORD_START,
    data,
  })
}

/**
 * @description opaque change password finish
 */
export function opaqueChangePasswordFinishAPI(data: IRequestPayload.Auth.Opaque.Register.Finish) {
  return AppAxios.post<boolean>({
    url: AuthRoutes.OPAQUE_USER_CHANGE_PASSWORD_FINISH,
    data,
  })
}
