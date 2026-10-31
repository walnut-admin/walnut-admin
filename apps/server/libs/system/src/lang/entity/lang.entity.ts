import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm'

/**
 * sys_lang —— MongoDB `sys_lang` 集合的 PostgreSQL 实体（phase2 4.4）。
 *
 * - lang 按 Q2 定案补 UNIQUE（Mongo 未声明但业务唯一）；取值域 = @walnut/contract 的 Locale。
 * - 表体量个位数，刻意不建 created_at 索引（phase2 4.4）。
 * - 两个 locale 计数 virtual 在 PG 侧改为子查询（phase2 5.2），不进实体。
 */
@Entity({ name: 'sys_lang' })
export class SysLangEntity {
  @PrimaryColumn({ type: 'uuid', name: 'id', default: () => 'gen_random_uuid()' })
  id: string

  @Index('uq_lang', { unique: true })
  @Column({ type: 'varchar', length: 16, name: 'lang' })
  lang: string

  @Column({ type: 'text', name: 'description', nullable: true })
  description: string | null

  // 属性名保持原样 `order`，列名避保留字（phase2 2.1）
  @Column({ type: 'integer', name: 'sort_order', nullable: true })
  order: number | null

  @Column({ type: 'boolean', name: 'status', default: true })
  status: boolean

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date
}
