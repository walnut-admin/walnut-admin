import type { IResponseData } from '../response'
import type { IStoreApp } from '@/store/types'
import { SystemEndpointRoutes } from '@walnut/contract'
import { AppAxios } from '@/utils/axios'

// get lock status
export function getLockStatusAPI() {
  return AppAxios.get<IResponseData.System.User.LockStatus>(
    {
      url: SystemEndpointRoutes.USER_LOCK_READ,
    },
  )
}

// lock
export function lockAPI(lockRoute: IStoreApp.LockRoute) {
  return AppAxios.patch<IResponseData.System.User.Lock>(
    {
      url: SystemEndpointRoutes.USER_LOCK,
      data: { lockRoute },
    },
  )
}

// unlock
export function unlockAPI() {
  return AppAxios.patch<IResponseData.System.User.Unlock>(
    {
      url: SystemEndpointRoutes.USER_LOCK_UNLOCK,
    },
  )
}
