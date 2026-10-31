import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm'

/**
 * sys_post —— 岗位（平表，无树、无自引用）。
 *
 * - `post_code` 是业务唯一键（`uq_post_code`）；`post_name` 不做库级唯一。
 * - 职工通过 `sys_employee.post_id` 引用本表（RESTRICT：有职工的岗位不许删，
 *   应用层先给受控错误，FK 是最后防线）。
 * - `idx_post_status` 服务「只列启用岗位」的取数（岗位下拉 / 职工表单）。
 * - `status` 的 CHECK（enabled/disabled）在 migration。
 */
@Index('uq_post_code', ['postCode'], { unique: true })
@Index('idx_post_status', ['status'])
@Entity({ name: 'sys_post' })
export class SysPostEntity {
  @PrimaryColumn({ type: 'uuid', name: 'id', default: () => 'gen_random_uuid()' })
  id: string

  // 业务键：全库唯一（uq_post_code）
  @Column({ type: 'varchar', length: 64, name: 'post_code' })
  postCode: string

  @Column({ type: 'text', name: 'post_name' })
  postName: string

  @Column({ type: 'integer', name: 'sort_order', default: 0 })
  sortOrder: number

  // CHECK (IN ('enabled', 'disabled')) 在 migration
  @Column({ type: 'varchar', length: 16, name: 'status', default: 'enabled' })
  status: string

  @Column({ type: 'text', name: 'remark', nullable: true })
  remark: string | null

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date
}
