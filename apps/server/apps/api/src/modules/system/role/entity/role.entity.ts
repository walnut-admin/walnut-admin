import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm'

/**
 * sys_role —— MongoDB `sys_role` 集合的 PostgreSQL 实体（phase2 4.2）。
 *
 * - role_name 按 phase2 定案收紧 NOT NULL（旧库 null 行由 ETL 预检拦截，phase2 7.3）。
 * - 属性名 `order` 保持原样，列名因 ORDER 是 SQL 关键字改名 `sort_order`（phase2 2.1）——
 *   这正是列名必须显式声明、不能用全局命名策略的根因之一。
 * - 原 menus: ObjectId[] 拆为关联表 sys_role_menu（见 role-menu.entity.ts）。
 */
@Entity({ name: 'sys_role' })
export class SysRoleEntity {
  @PrimaryColumn({ type: 'uuid', name: 'id', default: () => 'gen_random_uuid()' })
  id: string

  @Index('uq_role_name', { unique: true })
  @Column({ type: 'text', name: 'role_name' })
  roleName: string

  @Column({ type: 'text', name: 'description', nullable: true })
  description: string | null

  @Column({ type: 'integer', name: 'sort_order', nullable: true })
  order: number | null

  @Column({ type: 'boolean', name: 'status', default: true })
  status: boolean

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date
}
