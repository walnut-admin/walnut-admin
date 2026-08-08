import type { IModels } from '../models'
import type { IResponseData } from '../response'
import { SystemEndpointRoutes } from '@walnut/contract'
import { AppAxios } from '@/utils/axios'
import { BaseAPI } from '../base'

export const dictTypeAPI = new BaseAPI<IModels.SystemDictType>({
  model: 'system',
  section: 'dict/type',
})

export const dictDataAPI = new BaseAPI<IModels.SystemDictType>({
  model: 'system',
  section: 'dict/data',
})

// default all dict will cacahed for 10 minutes
export function getDictByTypeAPI(types: string | string[]) {
  return AppAxios.get<IResponseData.System.Dict.MapDictValue[]>(
    {
      url: SystemEndpointRoutes.DICT_TYPE_S,
      params: { types },
      _throttle: 500,
      _cache: true,
    },
  )
}
