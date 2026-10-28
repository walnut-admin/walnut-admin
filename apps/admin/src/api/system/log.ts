import type { SystemDevice, SystemLogAuth, SystemLogOperate, SystemLogOperateSnapshot } from '@walnut/api-types'
import { AppAxios } from '@/utils/axios'
import { BaseAPI } from '../base'

export const logOperateAPI = new BaseAPI<SystemLogOperate>({
  model: 'system',
  section: 'log/operate',
})

export function getLogOperateSnapshotAPI(id: string) {
  return AppAxios.get<SystemLogOperateSnapshot>(
    {
      url: `/system/log/operate/${id}/snapshot`,
    },
  )
}

export function getLogOperateDeviceAPI(id: string) {
  return AppAxios.get<SystemDevice>(
    {
      url: `/system/log/operate/${id}/device`,
    },
  )
}

export const logAuthAPI = new BaseAPI<SystemLogAuth>({
  model: 'system',
  section: 'log/auth',
})
