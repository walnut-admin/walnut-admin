import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm'

/**
 * sys_dict_data —— MongoDB `sys_dict_data` 集合的 PostgreSQL 实体（phase2 4.7）。
 *
 * - idx_dict_data_type_order (type_id, sort_order)：按类型取数即排好序；
 *   复合前缀同时服务 type_id 上的 FK 查找（PG 的 FK 不自动建索引）。
 * - FK type_id → sys_dict_type ON DELETE CASCADE，DDL 在 migration。
 */
// @Index 数组按属性名取列：属性是 order（列 sort_order，避保留字），B3 注册实体时
// 首次暴露此笔误并修正（索引本体在 migration：idx_dict_data_type_order (type_id, sort_order)）
@Index('idx_dict_data_type_order', ['typeId', 'order'])
@Entity({ name: 'sys_dict_data' })
export class SysDictDataEntity {
  @PrimaryColumn({ type: 'uuid', name: 'id', default: () => 'gen_random_uuid()' })
  id: string

  @Column({ type: 'uuid', name: 'type_id' })
  typeId: string

  // i18n key 形态
  @Column({ type: 'text', name: 'label' })
  label: string

  @Column({ type: 'text', name: 'value' })
  value: string

  @Column({ type: 'integer', name: 'sort_order', default: 0 })
  order: number

  @Column({ type: 'boolean', name: 'status', default: true })
  status: boolean

  // naive ui tag 渲染类型；CHECK (IN ('primary','info','success','warning','error')) 在 migration
  @Column({ type: 'varchar', length: 8, name: 'tag_type', default: 'primary' })
  tagType: string

  @Column({ type: 'text', name: 'description', nullable: true })
  description: string | null

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date
}
