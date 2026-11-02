import type { AppMonitorCache } from '@walnut/api-types'
import { BaseAPI } from '../../base'

export const monitorCacheAPI = new BaseAPI<AppMonitorCache>({
  model: 'app',
  section: 'monitor/cache',
})
