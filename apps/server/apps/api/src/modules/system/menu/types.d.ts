import type { TreeNodeItem } from 'easy-fns-ts'
import type { ISysMenuDocument, SysMenuModelMeta } from './schema/menu.schema'

declare global {
  type IMenuTreeItem = TreeNodeItem<
    Partial<ISysMenuDocument>
  >

  type IVueRouteItem = TreeNodeItem<
    Pick<Partial<ISysMenuDocument>, 'name' | 'path' | 'component'> & { meta: Partial<ISysMenuDocument> }
  >

  type ILayoutTabsItem = Pick<Partial<ISysMenuDocument>, 'name' | 'path'> & { meta: Partial<ISysMenuDocument> }

  type IIframeListItem = TreeNodeItem<
    Pick<Partial<ISysMenuDocument>, 'name'> & Pick<SysMenuModelMeta, 'url' | 'cache'>
  >
}

export {}
