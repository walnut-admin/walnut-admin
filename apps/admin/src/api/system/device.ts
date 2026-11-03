import type { SystemDevice, SystemDeviceHistoryUser, SystemDeviceInitialResponse, SystemUser } from '@walnut/api-types'
import type { IRequestPayload } from '../request'
import { getCPUCoreCount, getGPUArchitecture, getIsInIncognitoMode, getMemoryGB } from '@walnut/client/browser/shared'
import { SystemEndpointRoutes, SystemRoutes } from '@walnut/contract'
import { AppAxios } from '@/utils/axios'
import { BaseAPI } from '../base'

export const deviceAPI = new BaseAPI<SystemDevice>({
  model: 'system',
  section: 'device',
})

export function getDeviceCurrentActiveUserAPI(id: string) {
  return AppAxios.get<SystemUser>(
    {
      url: `${SystemRoutes.DEVICE}/${id}/current-active-user`,
    },
  )
}

export function getDeviceHistoryUsersAPI(id: string) {
  return AppAxios.get<SystemDeviceHistoryUser[]>(
    {
      url: `${SystemRoutes.DEVICE}/${id}/history-users`,
    },
  )
}

export function lockDeviceAPI(id: string) {
  return AppAxios.patch<boolean>(
    {
      url: `${SystemRoutes.DEVICE}/${id}/lock`,
    },
  )
}

export function unlockDeviceAPI(id: string) {
  return AppAxios.patch<boolean>(
    {
      url: `${SystemRoutes.DEVICE}/${id}/unlock`,
    },
  )
}

export function banDeviceAPI(id: string) {
  return AppAxios.patch<boolean>(
    {
      url: `${SystemRoutes.DEVICE}/${id}/ban`,
    },
  )
}

export function unbanDeviceAPI(id: string) {
  return AppAxios.patch<boolean>(
    {
      url: `${SystemRoutes.DEVICE}/${id}/unban`,
    },
  )
}

/**
 * @description initial device
 */
export async function initialDeviceAPI() {
  const isPrivate = await getIsInIncognitoMode()

  return AppAxios.post<SystemDeviceInitialResponse>({
    url: SystemEndpointRoutes.DEVICE_INITIAL,
    data: {
      // 批次 11 / P4：不再发 `deviceName` —— B5 起设备名由服务端生成（`<类型>_<8hex>`），
      // 这里再发只会被 wire 白名单判成 40099。
      private: isPrivate,
      sr: {
        width: window.screen.width,
        height: window.screen.height,
      },
      vp: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
      hardwareInfo: {
        cpuCores: getCPUCoreCount(),
        memory: getMemoryGB(),
        gpu: await getGPUArchitecture(),
      },
      deviceInfo: {
        // @ts-expect-error https://developer.mozilla.org/zh-CN/docs/Web/API/NetworkInformation/effectiveType
        netType: navigator.connection?.effectiveType,
        platform: navigator.platform,
      },
    // B5 / P4：deviceName 已由服务端生成，请求面不再带。
    //
    // 这里仍然是 `as` 而不是 `satisfies`：实测 `satisfies` 会立刻暴露两处**预存在**的类型松动
    // （device.ts:83 的 unknown→number、:86 的 deviceInfo 缺 type），它们是本次改造之前就有的，
    // 要修得先动 payload 的构造来源，属另一批。已知代价：`as` 会吞掉 Omit 守卫，
    // 多带 deviceName 时 tsc 不报错（实测），只能靠服务端 40099 兜住 —— 记为 P3 待修。
    } as IRequestPayload.System.Deivce.Initial,
  })
}
