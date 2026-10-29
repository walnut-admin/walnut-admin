import type { AppLogger, AppLoggerReadResponse } from '@walnut/api-types'
import { AppAxios } from '@/utils/axios'
import { BaseAPI } from '../base'

export const appLoggerAPI = new BaseAPI<AppLogger>({
  model: 'app',
  section: 'logger',
})

export function readAppLoggerMoreAPI(id: string, page: number) {
  return AppAxios.get<AppLoggerReadResponse>({
    url: `/app/logger/${id}?page=${page}`,
  })
}
