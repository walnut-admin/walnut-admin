import { Column, Entity, Index, PrimaryColumn } from 'typeorm'

/**
 * sys_deleted —— MongoDB `sys_deleted` 集合的 PostgreSQL 实体（phase2 4.17 / 5.3）。
 *
 * - 回收站快照表，追加型：PK 默认 **uuidv7()**；无 updated_at，时间列 deleted_at
 *   （原 createdAt 改名，保持可 NULL 对齐 schema，故用普通列而非 CreateDateColumn ——
 *   是否赋值由软删路径显式决定）。
 * - content 收 jsonb（原 stringify text）：快照本身就是合法 JSON，回收站预览/检索成为
 *   普通 SQL，恢复时取回即对象（phase2 5.3）。
 * - deleted_by 松引用（Q3 定案：删除者自己也可能被删，建 FK 会自锁）；log_operate_id 同为松引用。
 * - 恢复路径按 modelName 路由到显式注册表（Phase 3 后续批次的 repository 装配，phase2 5.3）。
 */
@Index('idx_deleted_model_at', ['modelName', 'deletedAt'])
@Entity({ name: 'sys_deleted' })
export class SysDeletedEntity {
  @PrimaryColumn({ type: 'uuid', name: 'id', default: () => 'uuidv7()' })
  id: string

  // 被删文档快照（jsonb）
  @Column({ type: 'jsonb', name: 'content' })
  content: Record<string, unknown>

  // 恢复路由键
  @Column({ type: 'text', name: 'model_name' })
  modelName: string

  // 纯记录字段，保留
  @Column({ type: 'text', name: 'collection_name' })
  collectionName: string

  // 被删文档原 id
  @Index('idx_deleted_id')
  @Column({ type: 'uuid', name: 'deleted_id' })
  deletedId: string

  // 松引用 sys_user（Q3）
  @Index('idx_deleted_by')
  @Column({ type: 'uuid', name: 'deleted_by' })
  deletedBy: string

  // 松引用
  @Column({ type: 'uuid', name: 'log_operate_id', nullable: true })
  logOperateId: string | null

  @Column({ type: 'timestamptz', name: 'deleted_at', nullable: true })
  deletedAt: Date | null
}
