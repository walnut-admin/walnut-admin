import type { SystemDeptTree } from '@walnut/api-types'
import { SystemEndpointRoutes } from '@walnut/contract'
import { AppAxios } from '@/utils/axios'

// dept 只暴露树读取（数据权限二期批 2：角色 CUSTOM 部门勾选 + 用户所属部门选择器）。
// 部门管理页本批不做 —— 写路径继续走 server 的 system/dept CRUD。
export function getDeptTreeAPI() {
  return AppAxios.get<SystemDeptTree[]>({
    url: SystemEndpointRoutes.DEPT_TREE,
  })
}
