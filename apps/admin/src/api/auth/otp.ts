import type { AuthTokenPayload } from '@walnut/api-types'
import type { IRequestPayload } from '../request'
import { AuthRoutes } from '@walnut/contract'
import { AppAxios } from '@/utils/axios'

/**
 * @description auth with otp
 */
export function verifyWithOTPAPI(data: IRequestPayload.Auth.OTP.Verify) {
  return AppAxios.post<AuthTokenPayload>({
    url: AuthRoutes.OTP_VERIFY,
    data,
  })
}

/**
 * @description send verify code email
 */
export function sendWithOTPAPI(data: IRequestPayload.Auth.OTP.Send) {
  return AppAxios.post<boolean>({
    url: AuthRoutes.OTP_SEND,
    data,
  })
}
