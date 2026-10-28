import type { AppMonitorUser } from '@walnut/api-types'
import { AppAxios } from '@/utils/axios'
import { BaseAPI } from '../../base'

export const monitorUserAPI = new BaseAPI<AppMonitorUser>({
  model: 'app',
  section: 'monitor/user',
})

export function forceQuitAPI(id: string) {
  return AppAxios.delete({
    url: `/app/monitor/user/force-quit/${id}`,
  })
}
