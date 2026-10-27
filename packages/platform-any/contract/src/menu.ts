/**
 * Menu type constants — shared between frontend and backend.
 */

import type { Recordable, ValueOf } from 'easy-fns-ts'

/** Menu item type */
export const MenuType = {
  CATALOG: 'catalog',
  MENU: 'menu',
  ELEMENT: 'element',
} as const

/** Menu internal/external classification */
export const MenuTernal = {
  EXTERNAL: 'external',
  INTERNAL: 'internal',
  NONE: 'none',
} as const

/** Menu cache key strategy */
export const CacheKeyStrategy = {
  NAME: 'name',
  PATH: 'path',
  CUSTOM: 'custom',
} as const

/**
 * Menu meta wire shape（19 字段）—— 服务端 `assembleSysMenuMeta` 组装的出参形态
 * （缺省键回填 schema 默认值，出参恒为全量 19 键），admin 侧菜单管理与路由 meta
 * 消费同一形状。刻意为纯 interface：contract 禁止拖 class-validator 进前端包，
 * 服务端带校验/swagger 装饰器的元数据基座类（`SysMenuMetaDTOBase`）implements 它。
 */
export interface IWalnutAdminMenuMeta {
  order: number
  ternal: ValueOf<typeof MenuTernal>
  url: string
  show: boolean
  cache: boolean
  status: boolean
  affix: boolean
  permission: string
  menuActiveName: string
  menuActiveSameTab: boolean
  badge: string
  activeIcon: string
  position: boolean
  leaveTip: boolean
  maskUrl: boolean
  hijackRefresh: boolean
  watermark: Recordable
  transition: string
  cacheKeyStrategy: ValueOf<typeof CacheKeyStrategy>
}
