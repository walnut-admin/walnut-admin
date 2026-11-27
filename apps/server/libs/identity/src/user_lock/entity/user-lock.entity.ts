import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm'

/** 锁屏路由：{name?, query?, params?}，query/params 是任意路由参数对象 → jsonb 整存 */
export interface IUserLockRoute {
  name?: string
  query?: Record<string, unknown>
  params?: Record<string, unknown>
}

/**
 * sys_user_lock —— MongoDB `sys_user_lock` 集合的 PostgreSQL 实体（phase2 4.11）。
 *
 * - user_id 按 Q2 定案补 UNIQUE（一用户一锁配置），uq_user_lock_user 同时服务 FK 查找。
 * - FK user_id → sys_user ON DELETE CASCADE，DDL 在 migration。
 * - lockPwdHash 的 bcrypt pre-save 逻辑迁到 service 层（phase2 4.11 备注，后续批次）。
 */
@Entity({ name: 'sys_user_lock' })
export class SysUserLockEntity {
  @PrimaryColumn({ type: 'uuid', name: 'id', default: () => 'gen_random_uuid()' })
  id: string

  @Index('uq_user_lock_user', { unique: true })
  @Column({ type: 'uuid', name: 'user_id' })
  userId: string

  @Column({ type: 'jsonb', name: 'lock_route', default: () => "'{}'::jsonb" })
  lockRoute: IUserLockRoute

  // bcrypt hash
  @Column({ type: 'text', name: 'lock_pwd_hash', nullable: true })
  lockPwdHash: string | null

  // CHECK (IN ('default','idle','security')) 在 migration
  @Column({ type: 'varchar', length: 8, name: 'lock_mode', default: 'default' })
  lockMode: string

  @Column({ type: 'integer', name: 'lock_idle_sec', default: 600 })
  lockIdleSec: number

  @Column({ type: 'integer', name: 'lock_security_sec', default: 60 })
  lockSecuritySec: number

  @Column({ type: 'boolean', name: 'lock_cross_device', default: true })
  lockCrossDevice: boolean

  // L1（2026-11-27）：锁屏密码计次 / 退避 / 最近变更（DDL 在 1793400000000-UserLockPwdAttempts）
  // 连续失败次数：security 密码解锁与 fallback OPAQUE 验证共用一套计数，成功即清零
  @Column({ type: 'integer', name: 'lock_pwd_fail_count', default: 0 })
  lockPwdFailCount: number

  // 退避截止时间：非空且晚于 now() ⇒ 一律拒绝（与密码对错无关，避免计时侧信道）
  @Column({ type: 'timestamptz', name: 'lock_pwd_locked_until', nullable: true })
  lockPwdLockedUntil: Date | null

  // 最近设置/变更锁屏密码的时间（审计 + UI 展示；bcrypt cost 不在列里）
  @Column({ type: 'timestamptz', name: 'lock_pwd_updated_at', nullable: true })
  lockPwdUpdatedAt: Date | null

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date
}
