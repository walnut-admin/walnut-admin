import type { SystemUser } from '@walnut/api-types'
import type { IRequestPayload } from '../request'
import { AuthRoutes } from '@walnut/contract'
import { AppAxios } from '@/utils/axios'
import { BaseAPI } from '../base'

export const userAPI = new BaseAPI<SystemUser>({
  model: 'system',
  section: 'user',
})

/**
 * @description clear password
 */
export function clearPasswordAPI(data: { id: string }) {
  return AppAxios.post<boolean>({
    url: AuthRoutes.OPAQUE_ADMIN_PASSWORD_CLEAR,
    data,
  })
}

/**
 * @description update password start
 */
export function updatePasswordStartAPI(data: IRequestPayload.Auth.Opaque.Admin.UpdatePasswordStart) {
  return AppAxios.post<string>({
    url: AuthRoutes.OPAQUE_ADMIN_PASSWORD_UPDATE_START,
    data,
  })
}

/**
 * @description update password finish
 */
export function updatePasswordFinishAPI(data: IRequestPayload.Auth.Opaque.Admin.UpdatePasswordFinish) {
  return AppAxios.post<boolean>({
    url: AuthRoutes.OPAQUE_ADMIN_PASSWORD_UPDATE_FINISH,
    data,
  })
}
