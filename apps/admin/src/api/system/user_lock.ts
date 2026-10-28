import type { SystemUserLockStatus } from '@walnut/api-types'
import type { IStoreApp } from '@/store/types'
import { SystemEndpointRoutes } from '@walnut/contract'
import { AppAxios } from '@/utils/axios'

// get lock status
export function getLockStatusAPI() {
  return AppAxios.get<SystemUserLockStatus>(
    {
      url: SystemEndpointRoutes.USER_LOCK_READ,
    },
  )
}

// lock
export function lockAPI(lockRoute: IStoreApp.LockRoute) {
  return AppAxios.patch<boolean>(
    {
      url: SystemEndpointRoutes.USER_LOCK,
      data: { lockRoute },
    },
  )
}

// unlock
export function unlockAPI() {
  return AppAxios.patch<boolean>(
    {
      url: SystemEndpointRoutes.USER_LOCK_UNLOCK,
    },
  )
}
