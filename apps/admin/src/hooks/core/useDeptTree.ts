import type { SystemDeptTree } from '@walnut/api-types'
import { computed, onMounted, ref } from 'vue'
import { getDeptTreeAPI } from '@/api/system/dept'

/**
 * 部门树数据源（数据权限二期批 2）：角色表单的 CUSTOM 部门多选与用户表单的所属部门
 * 选择器共用。
 *
 * 缓存口径同 `useDict`：模块级缓存 + 并发请求合并 —— 同一页面两个表单/多次挂载只打
 * 一次 `/system/dept/tree`；部门树量级小（组织数据），会话内不主动失效（部门维护页
 * 本批不做，重新进入应用即重新拉取）。
 */
const deptTreeRef = ref<SystemDeptTree[]>([])

let pending: Promise<void> | null = null

export function useDeptTree() {
  const getDeptTree = computed(() => deptTreeRef.value)

  async function onInit() {
    if (deptTreeRef.value.length > 0) {
      return
    }

    pending ??= getDeptTreeAPI()
      .then((res) => {
        deptTreeRef.value = res
      })
      .finally(() => {
        pending = null
      })

    await pending
  }

  onMounted(onInit)

  return { getDeptTree, onInit }
}
