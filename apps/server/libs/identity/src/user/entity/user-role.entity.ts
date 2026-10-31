import { Entity, Index, PrimaryColumn } from 'typeorm'

/**
 * sys_user_role —— sys_user.roles（ObjectId[]）拆出的关联表（phase2 4.1）。
 *
 * - PK (user_id, role_id)：复合主键天然去重，兼服务 user → roles 反查。
 * - 刻意**不保留** user.schema.ts 在 roles 数组上误声明的 multikey unique 语义
 *   （那等价于「一个角色全库只能赋给一个用户」，与多用户共享角色矛盾，phase2 4.1 勘误）。
 * - 双 FK（user_id / role_id）均 ON DELETE CASCADE，DDL 在 migration。
 */
@Entity({ name: 'sys_user_role' })
@Index('idx_role_id', ['roleId'])
export class SysUserRoleEntity {
  @PrimaryColumn({ type: 'uuid', name: 'user_id' })
  userId: string

  @PrimaryColumn({ type: 'uuid', name: 'role_id' })
  roleId: string
}
