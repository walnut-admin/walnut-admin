import type { IResponseData } from '@/api/response'
import { AppRoutes } from '@walnut/contract'
import { AppAxios } from '@/utils/axios'

export function getCpuInfoAPI() {
  return AppAxios.get<IResponseData.App.Monitor.CPU>({
    url: AppRoutes.MONITOR_SERVER_CPU,
  })
}

export function getMemInfoAPI() {
  return AppAxios.get<IResponseData.App.Monitor.Mem>({
    url: AppRoutes.MONITOR_SERVER_MEM,
  })
}

export function getOSInfoAPI() {
  return AppAxios.get<IResponseData.App.Monitor.OS>({
    url: AppRoutes.MONITOR_SERVER_OS,
  })
}

export function getSysInfoAPI() {
  return AppAxios.get<IResponseData.App.Monitor.System>(
    {
      url: AppRoutes.MONITOR_SERVER_SYS,
    },
  )
}

export function getDiskInfoAPI() {
  return AppAxios.get<IResponseData.App.Monitor.Disk[]>({
    url: AppRoutes.MONITOR_SERVER_DISK,
  })
}

export function getBatteryInfoAPI() {
  return AppAxios.get<IResponseData.App.Monitor.Battery>({
    url: AppRoutes.MONITOR_SERVER_BATTERY,
  })
}

export function getTimeInfoAPI() {
  return AppAxios.get<IResponseData.App.Monitor.Time>({
    url: AppRoutes.MONITOR_SERVER_TIME,
  })
}

export function getNetworkInfoAPI() {
  return AppAxios.get<IResponseData.App.Monitor.Network>(
    {
      url: AppRoutes.MONITOR_SERVER_NETWORK,
    },
  )
}
