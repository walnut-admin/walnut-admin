import type { TreeNodeItem } from 'easy-fns-ts'
import type { ISysMenuAssembled } from './dto/menu.dto'
import type { SysMenuModelMeta } from './schema/menu.schema'

declare global {
  // B5：树形/路由相关全局类型的行载体从 Mongo 文档（ISysMenuDocument）换成 PG 组装行
  // （ISysMenuAssembled —— 拍平列 + meta 对象，主键 id）；字段形态一致，仅 id/pid/可空性
  // 随列型放开
  type IMenuTreeItem = TreeNodeItem<
    Partial<ISysMenuAssembled>
  >

  type IVueRouteItem = TreeNodeItem<
    Pick<Partial<ISysMenuAssembled>, 'name' | 'path' | 'component'> & { meta: Partial<SysMenuModelMeta> }
  >

  type ILayoutTabsItem = Pick<Partial<ISysMenuAssembled>, 'name' | 'path'> & { meta: Partial<ISysMenuAssembled> }

  type IIframeListItem = TreeNodeItem<
    Pick<Partial<ISysMenuAssembled>, 'name'> & Pick<SysMenuModelMeta, 'url' | 'cache'>
  >
}

export {}
