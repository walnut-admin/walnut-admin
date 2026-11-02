import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm'

/**
 * sys_locale —— MongoDB `sys_locale` 集合的 PostgreSQL 实体（phase2 4.5）。
 *
 * - (lang_id, key) 按 Q2/Q11 定案 UNIQUE：一语言一键一行。
 * - 全库唯一的 trgm GIN 索引（idx_locale_key_trgm，key gin_trgm_ops，Q9 定案）只落在
 *   migration —— TypeORM @Index 表达不了操作符类（gin_trgm_ops），无法两侧同形；
 *   实体侧的 idx_locale_key 只服务 key 前缀搜索。
 * - FK lang_id → sys_lang ON DELETE CASCADE，DDL 在 migration。
 */
@Index('uq_locale_lang_key', ['langId', 'key'], { unique: true })
@Entity({ name: 'sys_locale' })
export class SysLocaleEntity {
  @PrimaryColumn({ type: 'uuid', name: 'id', default: () => 'gen_random_uuid()' })
  id: string

  @Column({ type: 'uuid', name: 'lang_id' })
  langId: string

  // idx_locale_key 服务 key 检索（migration 同名列），必须挂在 key 上而非 lang_id
  // —— uq_locale_lang_key 最左前缀已覆盖 lang_id 检索
  @Index('idx_locale_key')
  @Column({ type: 'text', name: 'key' })
  key: string

  // NULL = 未翻译
  @Column({ type: 'text', name: 'value', nullable: true })
  value: string | null

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date
}
