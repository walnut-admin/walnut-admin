import type { AppKeyCurrent } from '@walnut/api-types'
import { AppRoutes } from '@walnut/contract'
import { AppAxios } from '@/utils/axios'

/**
 * @description get backend url key, used for request data encryption
 * 该调用点固定为 AES_KEY_URL 视图（响应只有 keyB64）
 */
export async function urlKeyAPI() {
  return await AppAxios.get<AppKeyCurrent>({
    url: AppRoutes.KEY_AES_URL,
  })
}
