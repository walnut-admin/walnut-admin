import type { SystemDeleted } from '@walnut/api-types'
import type { IRequestPayload } from '../request'
import { SystemEndpointRoutes } from '@walnut/contract'
import { AppAxios } from '@/utils/axios'
import { BaseAPI } from '../base'

export const deletedAPI = new BaseAPI<SystemDeleted>({
  model: 'system',
  section: 'deleted',
})

/**
 * @description recover for manage
 */
export function recoverAPI(data: IRequestPayload.System.Deleted.Recover) {
  return AppAxios.post<boolean>(
    {
      url: SystemEndpointRoutes.DELETED_RECOVER,
      data,
    },
  )
}
