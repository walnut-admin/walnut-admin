/**
 * sys_role 实体 —— libs 解耦批 6 随身份内核下沉（user 的 `sys_user_role` junction
 * 读腿要 JOIN `sys_role`，实体作为身份内核的角色读模型入 `libs/identity`）。
 *
 * role 的 service / repo / DTO 已在 `libs/system/src/role`，只有 controller 留 app
 * （`apps/api/src/modules/system/role/role.controller.ts`）。本文件只做 re-export，
 * 保持既有 import 面不变；`data-scope.ts` / 恢复注册表拿到的是
 * 同一个类对象（drift spec 的 entity 身份对账不受影响）。
 */
export { SysRoleEntity } from '@walnut-server/identity'
