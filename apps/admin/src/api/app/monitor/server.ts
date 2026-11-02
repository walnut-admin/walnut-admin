import type {
  AppMonitorServerBattery,
  AppMonitorServerCpu,
  AppMonitorServerDisk,
  AppMonitorServerMem,
  AppMonitorServerNetwork,
  AppMonitorServerOs,
  AppMonitorServerSystem,
  AppMonitorServerTime,
} from '@walnut/api-types'
import { AppRoutes } from '@walnut/contract'
import { AppAxios } from '@/utils/axios'

export function getCpuInfoAPI() {
  return AppAxios.get<AppMonitorServerCpu>({
    url: AppRoutes.MONITOR_SERVER_CPU,
  })
}

export function getMemInfoAPI() {
  return AppAxios.get<AppMonitorServerMem>({
    url: AppRoutes.MONITOR_SERVER_MEM,
  })
}

export function getOSInfoAPI() {
  return AppAxios.get<AppMonitorServerOs>({
    url: AppRoutes.MONITOR_SERVER_OS,
  })
}

export function getSysInfoAPI() {
  return AppAxios.get<AppMonitorServerSystem>(
    {
      url: AppRoutes.MONITOR_SERVER_SYS,
    },
  )
}

export function getDiskInfoAPI() {
  return AppAxios.get<AppMonitorServerDisk[]>({
    url: AppRoutes.MONITOR_SERVER_DISK,
  })
}

export function getBatteryInfoAPI() {
  return AppAxios.get<AppMonitorServerBattery>({
    url: AppRoutes.MONITOR_SERVER_BATTERY,
  })
}

export function getTimeInfoAPI() {
  return AppAxios.get<AppMonitorServerTime>({
    url: AppRoutes.MONITOR_SERVER_TIME,
  })
}

export function getNetworkInfoAPI() {
  return AppAxios.get<AppMonitorServerNetwork>(
    {
      url: AppRoutes.MONITOR_SERVER_NETWORK,
    },
  )
}
