import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm'

/**
 * sys_user_device —— MongoDB `sys_user_device` 集合的 PostgreSQL 实体（phase2 4.9）。
 *
 * - (user_id, device_id) 按 Q2 定案补 UNIQUE（Mongo 未声明）。
 * - device_id 按**业务键**建 FK → sys_device(device_id)（该列已 UNIQUE，FK 合法；Q5 定案），
 *   ON DELETE CASCADE；user_id → sys_user 同为 CASCADE。DDL 在 migration。
 */
@Index('uq_user_device', ['userId', 'deviceId'], { unique: true })
@Entity({ name: 'sys_user_device' })
export class SysUserDeviceEntity {
  @PrimaryColumn({ type: 'uuid', name: 'id', default: () => 'gen_random_uuid()' })
  id: string

  // 用户可改的显示名
  @Column({ type: 'text', name: 'device_name', nullable: true })
  deviceName: string | null

  @Column({ type: 'uuid', name: 'user_id' })
  userId: string

  @Index('idx_user_device_device')
  @Column({ type: 'text', name: 'device_id' })
  deviceId: string

  @Column({ type: 'boolean', name: 'link', default: false })
  link: boolean

  // CHECK (IN ('user','admin','system')) 在 migration
  @Column({ type: 'varchar', length: 8, name: 'link_type', default: 'system' })
  linkType: string

  @Column({ type: 'boolean', name: 'locked', default: false })
  locked: boolean

  @Column({ type: 'timestamptz', name: 'last_active_at', nullable: true })
  lastActiveAt: Date | null

  @Column({ type: 'boolean', name: 'trusted', default: false })
  trusted: boolean

  @Column({ type: 'timestamptz', name: 'trusted_expired_at', nullable: true })
  trustedExpiredAt: Date | null

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date
}
