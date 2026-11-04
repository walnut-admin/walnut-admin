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
        // 不发 `type`：服务端一定用 UA 算出的类型覆盖客户端传的值（device.service.ts:112-113、133-138），
        // 值域与「为什么在类型上是可选」的依据写在 request.d.ts 的 Deivce.InitialDeviceInfo。
      },
      // 这里必须是 `satisfies` 而不是 `as`：`as` 会短路整份请求面契约
      // （request.d.ts 的 Deivce.Initial，对齐 server 的 SysDeviceDTOInitialRequest），多带一个
      // `deviceName` 时 tsc 也照样零报错；`satisfies` 保留字段级 excess property 检查，
      // 前端再发 deviceName 立刻红，不必等服务端 whitelist 判 40099。
    } satisfies IRequestPayload.System.Deivce.Initial,
  })
}
