import { Entity, Index, PrimaryColumn } from 'typeorm'

/**
 * sys_role_menu —— sys_role.menus（ObjectId[]）拆出的关联表（phase2 4.2）。
 *
 * - PK (role_id, menu_id)：复合主键去重 + 服务 role → menus 反查。
 * - 同 sys_user_role：不保留 role.schema.ts 对 menus 数组误声明的 multikey unique
 *   （「一个菜单只能属于一个角色」与多角色共享菜单的授权模型冲突，phase2 4.2 勘误）。
 * - 双 FK 均 ON DELETE CASCADE，DDL 在 migration。
 */
@Entity({ name: 'sys_role_menu' })
@Index('idx_menu_id', ['menuId'])
export class SysRoleMenuEntity {
  @PrimaryColumn({ type: 'uuid', name: 'role_id' })
  roleId: string

  @PrimaryColumn({ type: 'uuid', name: 'menu_id' })
  menuId: string
}
