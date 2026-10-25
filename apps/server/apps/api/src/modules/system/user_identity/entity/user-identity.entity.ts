import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm'

/**
 * sys_user_identity —— MongoDB `sys_user_identity` 集合的 PostgreSQL 实体（phase2 4.10）。
 *
 * - (user_id, type, purpose) 复合唯一（schema.index 声明）；(type, value_hash) 服务登录查找路径。
 * - value 是 AES-256-GCM 密文：对齐 schema 的 `select: false` 语义由后续 repository 层处理
 *   （查询默认不选该列），实体本身无法表达。
 * - FK user_id → sys_user ON DELETE CASCADE，DDL 在 migration。
 */
@Index('uq_identity', ['userId', 'type', 'purpose'], { unique: true })
@Entity({ name: 'sys_user_identity' })
export class SysUserIdentityEntity {
  @PrimaryColumn({ type: 'uuid', name: 'id', default: () => 'gen_random_uuid()' })
  id: string

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string

  // CHECK (IN ('phoneNumber','emailAddress','idCard','password')) 在 migration
  @Column({ type: 'varchar', length: 16, name: 'type' })
  type: string

  // CHECK (IN ('login','security')) 在 migration
  @Column({ type: 'varchar', length: 8, name: 'purpose' })
  purpose: string

  // AES-256-GCM 密文
  @Column({ type: 'text', name: 'value' })
  value: string

  // HMAC-SHA256，查找键
  @Index('idx_identity_type_hash', ['type', 'valueHash'])
  @Column({ type: 'text', name: 'value_hash' })
  valueHash: string

  // 展示用掩码
  @Column({ type: 'text', name: 'masked_value' })
  maskedValue: string

  @Column({ type: 'boolean', name: 'verified', default: false })
  verified: boolean

  @Column({ type: 'timestamptz', name: 'verified_at', nullable: true })
  verifiedAt: Date | null

  @Column({ type: 'boolean', name: 'is_primary', default: true })
  isPrimary: boolean

  @Column({ type: 'boolean', name: 'status', default: true })
  status: boolean

  // schema 注释明说「为未来预留的自由 JSON」→ jsonb 合理；DDL 默认 '{}'
  @Column({ type: 'jsonb', name: 'metadata', default: () => '\'{}\'::jsonb' })
  metadata: Record<string, unknown>

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date
}
