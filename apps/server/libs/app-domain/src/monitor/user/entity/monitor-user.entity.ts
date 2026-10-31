import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm'

/**
 * app_monitor_user —— MongoDB `app_monitor_user` 集合的 PostgreSQL 实体（phase2 4.21）。
 *
 * - 时间戳改名为 first_visit_at / last_active_at（无 created_at / updated_at），
 *   分别用 CreateDateColumn / UpdateDateColumn（改名映射）。
 * - visitor_id 按 Q2 定案补 UNIQUE（一访客一行）。
 * - user_id / device_id 松引用（访客监测独立于用户/设备生命周期），不建 FK。
 * - 属性名 `left` 保持原样，列名避保留字（LEFT）改名 is_left（phase2 2.1）。
 * - focus 的 DDL 默认按文档 false 落（schema 里是 default true，差异已在交付报告登记）。
 */
@Entity({ name: 'app_monitor_user' })
export class AppMonitorUserEntity {
  @PrimaryColumn({ type: 'uuid', name: 'id', default: () => 'gen_random_uuid()' })
  id: string

  @Index('uq_monitor_visitor', { unique: true })
  @Column({ type: 'text', name: 'visitor_id' })
  visitorId: string

  // 松引用
  @Index('idx_monitor_user')
  @Column({ type: 'uuid', name: 'user_id', nullable: true })
  userId: string | null

  // 松引用
  @Index('idx_monitor_device')
  @Column({ type: 'text', name: 'device_id', nullable: true })
  deviceId: string | null

  @Column({ type: 'boolean', name: 'auth', default: false })
  auth: boolean

  @Column({ type: 'boolean', name: 'focus', default: false })
  focus: boolean

  @Column({ type: 'boolean', name: 'is_left', default: false })
  left: boolean

  @Column({ type: 'text', name: 'current_router', nullable: true })
  currentRouter: string | null

  @CreateDateColumn({ type: 'timestamptz', name: 'first_visit_at' })
  firstVisitAt: Date

  @UpdateDateColumn({ type: 'timestamptz', name: 'last_active_at' })
  lastActiveAt: Date
}
