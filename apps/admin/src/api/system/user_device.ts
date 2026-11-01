import type { SystemUserDeviceListItem } from '@walnut/api-types'
import type { BaseListResponse } from '@walnut/contract'
import type { IRequestPayload } from '../request'
import { SystemEndpointRoutes } from '@walnut/contract'
import { AppAxios } from '@/utils/axios'

/**
 * @description list user's devices
 */
export function listUserDevicesAPI() {
  return AppAxios.get<BaseListResponse<SystemUserDeviceListItem>>({
    url: SystemEndpointRoutes.USER_DEVICE_LIST,
  })
}

/**
 * @description update user device name
 */
export function updateUserDeviceNameAPI(data: IRequestPayload.System.UserDevice.UpdateName) {
  return AppAxios.put<boolean>({
    url: `${SystemEndpointRoutes.USER_DEVICE_UPDATE_NAME}/${data.deviceId}`,
    data: {
      deviceName: data.deviceName,
    },
  })
}

/**
 * @description force quit user device
 */
export function forceQuitUserDeviceAPI(data: IRequestPayload.System.UserDevice.ForceQuit) {
  return AppAxios.delete<boolean>({
    url: `${SystemEndpointRoutes.USER_DEVICE_FORCE_QUIT}/${data.deviceId}`,
  })
}

/**
 * @description lock user device
 */
export function lockUserDeviceAPI(data: IRequestPayload.System.UserDevice.Lock) {
  return AppAxios.put<boolean>({
    url: `${SystemEndpointRoutes.USER_DEVICE_LOCK}/${data.deviceId}`,
  })
}

/**
 * @description unlock user device
 */
export function unlockUserDeviceAPI(data: IRequestPayload.System.UserDevice.Unlock) {
  return AppAxios.put<boolean>({
    url: `${SystemEndpointRoutes.USER_DEVICE_UNLOCK}/${data.deviceId}`,
  })
}
