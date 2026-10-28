import type { SystemMenu, SystemMenuTree } from '@walnut/api-types'
import type { TreeNodeItem } from 'easy-fns-ts'
import { formatTree } from 'easy-fns-ts'
import { computed, onMounted, ref } from 'vue'
import { getMenuTreeAPI } from '@/api/system/menu'
import { useAppI18n } from '@/locales/index'

export function useMenuTree() {
  const { t } = useAppI18n()

  // 真源是 @walnut/api-types 生成别名（server SysMenuDTOTree 自带递归 children）
  const menuDataRef = ref<SystemMenuTree[]>([])
  const treeSelectDataRef = ref<SystemMenuTree[]>([])
  const menuActiveNamesOptions = ref<Pick<SystemMenu, 'title' | 'name'>[]>([])

  const getLeftMenu = computed((): TreeNodeItem<SystemMenuTree>[] => {
    return formatTree<SystemMenuTree>(menuDataRef.value, node => ({
      ...node,
      title: node.title ? t(node.title) : node.title,
    }))
  })

  const getTreeSelect = computed((): TreeNodeItem<SystemMenuTree>[] => {
    return formatTree<SystemMenuTree>(treeSelectDataRef.value, node => ({
      ...node,
      title: node.title ? t(node.title) : node.title,
    }))
  })

  const onInit = async () => {
    menuDataRef.value.length = 0
    treeSelectDataRef.value.length = 0
    menuActiveNamesOptions.value.length = 0

    const res = await getMenuTreeAPI()

    menuDataRef.value = res.fullTree
    treeSelectDataRef.value = res.treeWithoutTypeElement
    menuActiveNamesOptions.value = res.menuActiveNamesOptions
  }

  onMounted(onInit)

  return { getLeftMenu, getTreeSelect, menuActiveNamesOptions, onInit }
}
