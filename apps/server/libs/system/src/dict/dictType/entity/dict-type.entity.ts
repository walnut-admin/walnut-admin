import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm'

/**
 * sys_dict_type —— MongoDB `sys_dict_type` 集合的 PostgreSQL 实体（phase2 4.6）。
 */
@Entity({ name: 'sys_dict_type' })
export class SysDictTypeEntity {
  @PrimaryColumn({ type: 'uuid', name: 'id', default: () => 'gen_random_uuid()' })
  id: string

  // 实为 i18n key（seed dict.name.status）
  @Column({ type: 'text', name: 'name' })
  name: string

  @Index('uq_dict_type', { unique: true })
  @Column({ type: 'text', name: 'type' })
  type: string

  @Column({ type: 'boolean', name: 'status', default: true })
  status: boolean

  @Column({ type: 'text', name: 'description', nullable: true })
  description: string | null

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date
}
