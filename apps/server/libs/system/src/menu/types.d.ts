import type { IWalnutAdminMenuMeta } from '@walnut/contract/menu'
import type { TreeNodeItem } from 'easy-fns-ts'
import type { ISysMenuAssembled } from './dto/menu.dto'

declare global {
  // B5：树形/路由相关全局类型的行载体从 Mongo 文档（ISysMenuDocument）换成 PG 组装行
  // （ISysMenuAssembled —— 拍平列 + meta 对象，主键 id）；字段形态一致，仅 id/pid/可空性
  // 随列型放开。meta 形状从 @walnut/contract 的纯 interface 取（批 4 起 schema/ 并入
  // dto/，带装饰器的基座类不再跨模块裸引，wire 契约统一走 contract）
  type IMenuTreeItem = TreeNodeItem<
    Partial<ISysMenuAssembled>
  >

  type IVueRouteItem = TreeNodeItem<
    Pick<Partial<ISysMenuAssembled>, 'name' | 'path' | 'component'> & { meta: Partial<IWalnutAdminMenuMeta> }
  >

  type ILayoutTabsItem = Pick<Partial<ISysMenuAssembled>, 'name' | 'path'> & { meta: Partial<ISysMenuAssembled> }

  type IIframeListItem = TreeNodeItem<
    Pick<Partial<ISysMenuAssembled>, 'name'> & Pick<IWalnutAdminMenuMeta, 'url' | 'cache'>
  >
}

export {}
