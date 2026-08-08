import type { IResponseData } from '../response'
import { AppRoutes } from '@walnut/contract'
import { AppAxios } from '@/utils/axios'

/**
 * @description get backend url key, used for request data encryption
 */
export async function urlKeyAPI() {
  return await AppAxios.get<IResponseData.App.Key.Current>({
    url: AppRoutes.KEY_AES_URL,
  })
}
