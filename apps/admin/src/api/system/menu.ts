import type { SystemMenu } from '@walnut/api-types'
import type { IResponseData } from '../response'
import { SystemEndpointRoutes } from '@walnut/contract'
import { AppAxios } from '@/utils/axios'
import { BaseAPI } from '../base'

// menu 是 OpenAPI codegen 一期第一个走通全链的模块：T 直连 @walnut/api-types 的生成别名
// （server SysMenuDTOSafe 的 wire 真源），手写 IModels.SystemMenu 不再作为本模块的契约。
export const menuAPI = new BaseAPI<SystemMenu>({
  model: 'system',
  section: 'menu',
})

// get tree data for menu page
export function getMenuTreeAPI() {
  return AppAxios.get<IResponseData.System.Menu.Tree>(
    {
      url: SystemEndpointRoutes.MENU_TREE,
    },
  )
}
