import type { AppLogger, AppLoggerReadResponse } from '@walnut/api-types'
import { AppRoutes } from '@walnut/contract'
import { AppAxios } from '@/utils/axios'
import { BaseAPI } from '../base'

export const appLoggerAPI = new BaseAPI<AppLogger>({
  model: 'app',
  section: 'logger',
})

export function readAppLoggerMoreAPI(id: string, page: number) {
  return AppAxios.get<AppLoggerReadResponse>({
    url: `${AppRoutes.LOGGER}/${id}?page=${page}`,
  })
}
