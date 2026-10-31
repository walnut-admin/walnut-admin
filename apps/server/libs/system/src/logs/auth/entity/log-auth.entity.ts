import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm'

/**
 * sys_log_auth —— MongoDB `sys_log_auth` 集合的 PostgreSQL 实体（phase2 4.15）。
 *
 * - 追加型大表：PK 默认 **uuidv7()**（DB 端，时间有序，写放大友好；phase2 3.3 定案）。
 * - 无 updated_at；时间列即 authenticated_at（原 createdAt 改名，NOT NULL DEFAULT now()）。
 * - user_id / device_id 一律**松引用**（Q3 定案：审计必须比被引用对象活得久），不建 FK，
 *   仅保留列 + 索引 + 快照列 user_name。
 */
@Index('idx_log_auth_at', ['authenticatedAt'])
@Entity({ name: 'sys_log_auth' })
export class SysLogAuthEntity {
  // DB 默认 uuidv7()：插入不传 id 时由数据库生成（v7 版本位可辨识），不做应用端生成
  @PrimaryColumn({ type: 'uuid', name: 'id', default: () => 'uuidv7()' })
  id: string

  @Column({ type: 'text', name: 'ip', nullable: true })
  ip: string | null

  @Column({ type: 'text', name: 'location', nullable: true })
  location: string | null

  @Column({ type: 'text', name: 'os', nullable: true })
  os: string | null

  @Column({ type: 'text', name: 'browser', nullable: true })
  browser: string | null

  // 松引用；登录失败时为 NULL
  @Index('idx_log_auth_user')
  @Column({ type: 'uuid', name: 'user_id', nullable: true })
  userId: string | null

  // 快照列，用户删除后日志仍可读
  @Column({ type: 'text', name: 'user_name', nullable: true })
  userName: string | null

  // 登录标识（email/phone）
  @Column({ type: 'text', name: 'identifier', nullable: true })
  identifier: string | null

  @Column({ type: 'boolean', name: 'success', default: false })
  success: boolean

  @Column({ type: 'text', name: 'msg', nullable: true })
  msg: string | null

  // CHECK (IN ('opaque','qrcode','otp','emailAddress','phoneNumber','github','gitee','googleFedCM'))
  // 在 migration，取值 = WalnutAdminConstDecoratorLogAuthType
  @Column({ type: 'varchar', length: 16, name: 'type' })
  type: string

  // 松引用
  @Index('idx_log_auth_device')
  @Column({ type: 'text', name: 'device_id', nullable: true })
  deviceId: string | null

  // 原 createdAt 改名；CreateDateColumn 应用端赋值 + DDL DEFAULT now() 兜底 raw SQL（phase2 5.4）
  @CreateDateColumn({ type: 'timestamptz', name: 'authenticated_at' })
  authenticatedAt: Date
}
