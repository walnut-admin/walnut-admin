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

  // 数据权限一期（docs/plans/data-scope-design.md §4）：1=ALL 2=SELF 3=CUSTOM。
  // 值集与 libs/const/src/app/dataScope.ts 同源；CHECK ck_role_data_scope 在 migration，
  // DEFAULT 1 保证数据权限上线不缩小既有角色的可见面（root 由迁移显式回填 1）。
  @Column({ type: 'smallint', name: 'data_scope', default: 1 })
  dataScope: number

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date
}
