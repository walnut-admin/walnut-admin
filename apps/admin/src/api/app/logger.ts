import type { AppLogger } from '@walnut/api-types'
import { AppAxios } from '@/utils/axios'
import { BaseAPI } from '../base'

/**
 * `GET /app/logger/:filePath?page=n`（读日志内容）的响应 —— 与 list 行（AppLogger）不同形，
 * server 无 swagger schema（logger.service read 手工返回），这里按 wire 事实声明。
 */
export interface AppLoggerReadResponse {
  fileName: string
  filePath: string
  fileContent: string[]
}

export const appLoggerAPI = new BaseAPI<AppLogger>({
  model: 'app',
  section: 'logger',
})

export function readAppLoggerMoreAPI(id: string, page: number) {
  return AppAxios.get<AppLoggerReadResponse>({
    url: `/app/logger/${id}?page=${page}`,
  })
}
