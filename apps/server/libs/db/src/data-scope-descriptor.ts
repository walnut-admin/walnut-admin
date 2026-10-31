import type { WalnutAdminConstDataScopeMode } from '@walnut-server/const/app/dataScope'

/**
 * 数据权限**描述符类型真源**（libs 解耦批 1 从 apps/api/src/common/repository/data-scope.ts
 * 迁入）。只搬类型，不搬计算 —— 描述符的解析仍在 app（modules/system/data-scope/），
 * 聚合注册表（common/repository/data-scope.ts）import 这里的类型。
 *
 * 与本目录 data-scope-rls.ts 的关系：rls 管「描述符怎么写进事务 GUC」，本文件管
 * 「描述符长什么样」—— ALS 请求上下文、基类仓库、RLS 设置三方的公共词汇。
 */

/** 数据权限档位的字面量联合（六档 as const 的 keyof typeof 推导） */
export type IWalnutAdminDataScopeMode = typeof WalnutAdminConstDataScopeMode[keyof typeof WalnutAdminConstDataScopeMode]

/**
 * 解析后的数据权限描述符（二期）。
 *
 * - `deptIds`：部门维度档位（DEPT / DEPT_AND_CHILD / CUSTOM / DEPT_OR_SELF）的已解析
 *   部门 id 集合 —— DEPT_AND_CHILD 在此处已是子树展开后的结果（执行层不再递归）；
 * - `userIds`：DEPT_OR_SELF（或多角色并集里出现 SELF 腿）的本人集合；当前实现恒为
 *   `[当前 userId]`，字段保留是为了「并集语义」在执行层有显式落点。
 *
 * SELF 的「本人」仍由 ALS 的 userId 提供（描述符本身不重复携带，缓存按 userId 键）。
 */
export interface IWalnutAdminDataScopeDescriptor {
  mode: IWalnutAdminDataScopeMode
  userIds?: string[]
  deptIds?: string[]
}
