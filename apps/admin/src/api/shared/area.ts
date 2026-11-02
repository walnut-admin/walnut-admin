import type { SharedArea } from '@walnut/api-types'
import type { TreeNodeItem } from 'easy-fns-ts'
import { SharedRoutes } from '@walnut/contract'
import { AppAxios } from '@/utils/axios'

// get area children by pcode, default will return province info
export function getAreaChildrenByPcodeAPI(pcode?: string) {
  return AppAxios.get<SharedArea[]>(
    {
      url: SharedRoutes.AREA_CHILDREN,
      params: {
        pcode,
      },
      _cache: true,
    },
  )
}

// area feedback, single
export function getAreaFeedbackByCodeAPI(codes?: string | string[]) {
  return AppAxios.get<TreeNodeItem<SharedArea>[]>({
    url: SharedRoutes.AREA_FEEDBACK,
    params: {
      codes,
    },
  })
}
