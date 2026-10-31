/**
 * sys_role 实体 —— libs 解耦批 6 随身份内核下沉（user 的 `sys_user_role` junction
 * 读腿要 JOIN `sys_role`，实体作为身份内核的角色读模型入 `libs/identity`）。
 *
 * role 模块（service / repo / controller / DTO）仍在 app，本文件只做 re-export，
 * 保持 app 侧既有 import 面不变；`data-scope.ts` / `recover-registry` 拿到的是
 * 同一个类对象（drift spec 的 entity 身份对账不受影响）。
 */
export { SysRoleEntity } from '@walnut-server/identity'
