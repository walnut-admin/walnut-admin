import type { AppMonitorUser } from '@walnut/api-types'
import { AppRoutes } from '@walnut/contract'
import { AppAxios } from '@/utils/axios'
import { BaseAPI } from '../../base'

export const monitorUserAPI = new BaseAPI<AppMonitorUser>({
  model: 'app',
  section: 'monitor/user',
})

export function forceQuitAPI(id: string) {
  return AppAxios.delete({
    url: `${AppRoutes.MONITOR_USER}/force-quit/${id}`,
  })
}
