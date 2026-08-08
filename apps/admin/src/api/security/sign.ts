import type { IResponseData } from '../response'
import { SecurityRoutes } from '@walnut/contract'
import { AppAxios } from '@/utils/axios'

/**
 * @description sign initial
 */
export async function signInitialAPI(rsaPubKey: string, force = false) {
  return await AppAxios.post({
    url: SecurityRoutes.SIGN_INITIAL,
    data: {
      rsaPubKey,
      force,
    },
  })
}

/**
 * @description sign aes key
 */
export async function signAesKeyAPI() {
  return await AppAxios.post<IResponseData.Security.Sign.AesKey>({
    url: SecurityRoutes.SIGN_AES_KEY,
    _autoDecryptResponseData: ['aesKey'],
  })
}
