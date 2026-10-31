import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm'

/**
 * app_key meta 的形状（对齐 schema 的 AppKeyMetaTypeRaw）：
 * 不同 type 的 key 形态完全不同（RSA 存 PEM 对、AES 存 keyB64+ivB64、JWT 存 secret，
 * 另有 bits/cipher），一列多型是 jsonb 的教科书场景（phase2 4.23 / 5.5）。
 */
export interface IAppKeyMeta {
  publicKeyPem?: string
  privateKeyPem?: string
  keyB64?: string
  ivB64?: string
  secret?: string
  bits?: number
  cipher?: string
}

/**
 * app_key —— MongoDB `app_key` 集合的 PostgreSQL 实体（phase2 4.23）。
 */
@Entity({ name: 'app_key' })
export class AppKeyEntity {
  @PrimaryColumn({ type: 'uuid', name: 'id', default: () => 'gen_random_uuid()' })
  id: string

  @Index('uq_key', { unique: true })
  @Column({ type: 'text', name: 'key' })
  key: string

  // CHECK (IN ('RSA_PAIR','AES_KEY_URL','JWT_AT','JWT_RT')) 在 migration
  @Column({ type: 'varchar', length: 16, name: 'type' })
  type: string

  // timestamp as version
  @Column({ type: 'integer', name: 'version' })
  version: number

  // CHECK (IN ('ACTIVE','DEPRECATED','DISABLED')) 在 migration；DDL 默认 'ACTIVE'
  @Index('idx_app_key_status')
  @Column({ type: 'varchar', length: 16, name: 'status', default: 'ACTIVE' })
  status: string

  @Column({ type: 'timestamptz', name: 'valid_start' })
  validStart: Date

  @Column({ type: 'timestamptz', name: 'valid_end', nullable: true })
  validEnd: Date | null

  @Column({ type: 'timestamptz', name: 'rotate_after', nullable: true })
  rotateAfter: Date | null

  @Column({ type: 'jsonb', name: 'meta', nullable: true })
  meta: IAppKeyMeta | null

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date
}
