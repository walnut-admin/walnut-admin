import type { SystemDictData, SystemDictType, SystemDictTypeWithDictData } from '@walnut/api-types'
import { SystemEndpointRoutes } from '@walnut/contract'
import { AppAxios } from '@/utils/axios'
import { BaseAPI } from '../base'

export const dictTypeAPI = new BaseAPI<SystemDictType>({
  model: 'system',
  section: 'dict/type',
})

export const dictDataAPI = new BaseAPI<SystemDictData>({
  model: 'system',
  section: 'dict/data',
})

// default all dict will cacahed for 10 minutes
export function getDictByTypeAPI(types: string | string[]) {
  return AppAxios.get<SystemDictTypeWithDictData[]>(
    {
      url: SystemEndpointRoutes.DICT_TYPE_S,
      params: { types },
      _throttle: 500,
      _cache: true,
    },
  )
}
