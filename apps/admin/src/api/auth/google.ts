import type { IRequestPayload } from '../request'
import type { IResponseData } from '../response'
import { AuthRoutes } from '@walnut/contract'
import { AppAxios } from '@/utils/axios'

/**
 * @description auth with google fed cm
 */
export function authWithGoogleAPI(data: IRequestPayload.Auth.Google) {
  return AppAxios.post<IResponseData.Auth.TokenPayload>({
    url: AuthRoutes.GOOGLE,
    data,
  })
}
