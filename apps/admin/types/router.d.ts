import type { SystemMenu, SystemMenuMeta } from '@walnut/api-types'
import type { Recordable } from 'easy-fns-ts'

export { }

declare module 'vue-router' {
  // 菜单 meta 的前端消费面：本地硬编码路由只写部分字段，全部按可选消费
  // （生成 SystemMenuMeta 全字段必填，是 server 响应形态，不能直接做 RouteMeta 基座）
  interface RouteMeta extends Partial<SystemMenuMeta>, Partial<Pick<SystemMenu, 'type' | 'title' | 'icon'>> {
    /**
     * @description this is an option that only works for routes hard-coded in front-end code
     * for those routes that do not need to fetch permissions from backend
     */
    _auth?: boolean

    /**
     * @description used for enhanced params, to temp save resolved params
     */
    _resolvedParams?: Recordable

    /**
     * @description used for enhanced querys, to temp save resolved querys
     */
    _resolvedQuerys?: Recordable
  }
}
