import type { AuthTokenPayload } from '@walnut/api-types'
import type { IRequestPayload } from '../request'
import { AuthRoutes } from '@walnut/contract'
import { AppAxios } from '@/utils/axios'

/**
 * @description auth with google fed cm
 */
export function authWithGoogleAPI(data: IRequestPayload.Auth.Google) {
  return AppAxios.post<AuthTokenPayload>({
    url: AuthRoutes.GOOGLE,
    data,
  })
}
