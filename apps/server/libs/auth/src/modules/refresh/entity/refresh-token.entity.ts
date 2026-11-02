import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm'

/**
 * auth_refresh_token —— MongoDB `auth_refresh_token` 集合的 PostgreSQL 实体（phase2 4.24）。
 *
 * - 追加型大表：PK 默认 **uuidv7()**（phase2 3.3 定案）；`updatedAt: false` → 只有 created_at。
 * - user_id FK → sys_user ON DELETE CASCADE（用户彻底删除则其会话令牌随之失效，正确语义）。
 * - device_id 按**业务键** FK → sys_device(device_id) ON DELETE CASCADE（Q5 定案：设备被删
 *   则会话令牌随之清理）。两条 FK 的 DDL 都在 migration。
 * - idx_rt_expired (expired_at) 服务过期清理 purge job（Q10-b 定案纳入 Phase 3 交付物）。
 */
@Index('idx_rt_user', ['userId'])
// F-26：部分唯一索引（DDL 在 migration 1793370000000）—— 把「未撤销现役行恒恰一行」
// 这条不变量从应用层约定下沉到 DB。只收 revoked = false：revoke-and-insert 轮换的
// 历轮旧行都是 revoked = true，不参与索引；synchronize 关闭，索引真源是 migration。
@Index('uq_rt_active_device_user', ['userId', 'deviceId'], {
  unique: true,
  where: '"revoked" = false',
})
@Entity({ name: 'auth_refresh_token' })
export class AuthRefreshTokenEntity {
  @PrimaryColumn({ type: 'uuid', name: 'id', default: () => 'uuidv7()' })
  id: string

  @Index('uq_jti', { unique: true })
  @Column({ type: 'text', name: 'jti' })
  jti: string

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string

  @Index('idx_rt_device')
  @Column({ type: 'text', name: 'device_id' })
  deviceId: string

  @Column({ type: 'text', name: 'encrypted_token' })
  encryptedToken: string

  @Index('idx_rt_expired')
  @Column({ type: 'timestamptz', name: 'expired_at' })
  expiredAt: Date

  @Column({ type: 'boolean', name: 'revoked', default: false })
  revoked: boolean

  // 取值 = WalnutAdminConstRevokeRTType（含 RT 轮换的 'rotate'），CHECK 在 migration；可空 = 未撤销
  @Column({ type: 'varchar', length: 24, name: 'revoke_reason', nullable: true })
  revokeReason: string | null

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date
}
