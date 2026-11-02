import type { SystemDevice, SystemLogAuth, SystemLogOperate, SystemLogOperateSnapshot } from '@walnut/api-types'
import { SystemRoutes } from '@walnut/contract'
import { AppAxios } from '@/utils/axios'
import { BaseAPI } from '../base'

export const logOperateAPI = new BaseAPI<SystemLogOperate>({
  model: 'system',
  section: 'log/operate',
})

export function getLogOperateSnapshotAPI(id: string) {
  return AppAxios.get<SystemLogOperateSnapshot>(
    {
      url: `${SystemRoutes.LOG_OPERATE}/${id}/snapshot`,
    },
  )
}

export function getLogOperateDeviceAPI(id: string) {
  return AppAxios.get<SystemDevice>(
    {
      url: `${SystemRoutes.LOG_OPERATE}/${id}/device`,
    },
  )
}

export const logAuthAPI = new BaseAPI<SystemLogAuth>({
  model: 'system',
  section: 'log/auth',
})
