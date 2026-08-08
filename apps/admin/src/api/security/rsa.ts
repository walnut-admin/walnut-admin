import { SecurityRoutes } from '@walnut/contract'
import { AppAxios } from '@/utils/axios'

/**
 * @description get backend rsa public key, used for request data encryption
 */
export async function rsaPublicKeyAPI() {
  return await AppAxios.get<string>({
    url: SecurityRoutes.RSA_PUBLIC_KEY,
  })
}
