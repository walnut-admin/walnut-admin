import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm'

/**
 * sys_user_oauth —— MongoDB `sys_user_oauth` 集合的 PostgreSQL 实体（phase2 4.13）。
 *
 * - (provider, provider_id) 复合唯一（schema.index 声明）：同一外部账号只能绑定一个用户。
 * - schema.index 里的 { userId: 1, enabled: 1 } 引用了不存在的 enabled 字段（实际是 status），
 *   是 Mongo 侧死索引，**不迁移**（phase2 4.13 勘误；旧库摘除属 Phase 4 顺手项）。
 * - FK user_id → sys_user ON DELETE CASCADE，DDL 在 migration。
 */
@Index('uq_oauth', ['provider', 'providerId'], { unique: true })
@Entity({ name: 'sys_user_oauth' })
export class SysUserOauthEntity {
  @PrimaryColumn({ type: 'uuid', name: 'id', default: () => 'gen_random_uuid()' })
  id: string

  @Index('idx_oauth_user')
  @Column({ type: 'uuid', name: 'user_id' })
  userId: string

  // CHECK (IN ('google-one-tap','gitee','github')) 在 migration
  @Column({ type: 'varchar', length: 16, name: 'provider' })
  provider: string

  @Column({ type: 'text', name: 'provider_id' })
  providerId: string

  @Column({ type: 'boolean', name: 'status', default: true })
  status: boolean

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date
}
