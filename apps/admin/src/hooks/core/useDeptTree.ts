import type { SystemDeptTree } from '@walnut/api-types'
import type { IAppResponseError } from '@/utils/axios/types'
import { WalnutAdminConstAppResponseCode } from '@walnut/contract'
import { computed, onMounted, ref } from 'vue'
import { getDeptTreeAPI } from '@/api/system/dept'
import { useAppStoreUserPermission } from '@/store/modules/user/user-permission'

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

/** `GET /system/dept/tree` 的守卫权限点（服务端 dept 控制器按它判 40105） */
const DEPT_TREE_PERMISSION = 'system:dept:list'

/**
 * 40105 = 「菜单给了、`system:dept:list` 没给」的**正常拒绝**，不是运行时故障。
 *
 * 部门树是辅助依赖（表单里的选择器），拿不到就降级成空树。旧实现只 `await pending`、
 * 没有 catch ⇒ unhandled rejection 冒到 `main.ts` 的 `unhandledrejection` ⇒ 全屏
 * 「页面遇到无法恢复的错误」遮罩，整页交互被锁死（E2E J7b 的可执行复现）。
 * 这里按 `IAppResponseError.code` 精确识别（错误形态见 `@/utils/axios/types.d.ts`），
 * 只吞这一码；其它错误照旧抛给全局（拦截器已 toast，未捕获的才进致命遮罩）。
 */
function isNoPermissionError(error: unknown): boolean {
  return (
    (error as IAppResponseError | null)?.code ===
    WalnutAdminConstAppResponseCode.UNAUTHORIZED_NO_PERMISSION
  )
}

export function useDeptTree() {
  const userStorePermission = useAppStoreUserPermission()
  const getDeptTree = computed(() => deptTreeRef.value)

  async function onInit() {
    // 无 `system:dept:list` 时请求必然 40105：与 `useTableAPI` 的 list 门禁同一写法 ——
    // 先查权限、不发注定被拒的请求（也就不用吃一条无意义的「无权限」提示）。
    // 同时清掉模块级缓存：切角色后新角色没有该权限，旧角色的部门树不能继续展示。
    if (!userStorePermission.hasPermission(DEPT_TREE_PERMISSION)) {
      deptTreeRef.value = []
      return
    }

    if (deptTreeRef.value.length > 0) {
      return
    }

    pending ??= getDeptTreeAPI()
      .then((res) => {
        deptTreeRef.value = res
      })
      .catch((error: unknown) => {
        // 兜底「权限串与守卫缓存短暂漂移」：角色 / 菜单改动会清服务端权限缓存，旧 AT 在下一次
        // `/auth/permissions` 前仍带旧串（文档口径：缓存缺失直接 40105、无懒重建）。这种漂移
        // 同样只该退化成空树，不能把页面打进致命遮罩。
        if (!isNoPermissionError(error)) {
          throw error
        }

        deptTreeRef.value = []
      })
      .finally(() => {
        pending = null
      })

    await pending
  }

  onMounted(onInit)

  return { getDeptTree, onInit }
}
