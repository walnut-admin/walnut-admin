import type { IResponseData } from '../response'
import { SharedRoutes } from '@walnut/contract'
import { AppAxios } from '@/utils/axios'

/**
 * @description get ali oss sts token from backend
 */
export function getAliSTSTokenAPI() {
  return AppAxios.get<IResponseData.Shared.AliStsToken>(
    {
      url: SharedRoutes.ALI_STS,
      _autoDecryptResponseData: ['accessKeyId', 'accessKeySecret', 'stsToken'],
    },
  )
}
