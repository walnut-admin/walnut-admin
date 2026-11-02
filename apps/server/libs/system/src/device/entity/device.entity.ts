import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm'

/** location_history 数组元素的形状（对齐 SharedIpLocationHistoryDTO） */
export interface IDeviceLocationHistoryItem {
  ip: string
  location?: Record<string, unknown> | null
  timestamp: number
}

/**
 * sys_device —— MongoDB `sys_device` 集合的 PostgreSQL 实体（phase2 4.8）。
 *
 * - device_id 是客户端指纹，作为**被引用业务键**（Q5 定案）：user_device / auth_refresh_token
 *   按它建 FK，因此两列都必须 UNIQUE。
 * - device_info / hardware_info / location_info / location_history 四列 jsonb 整存（Q8 定案）；
 *   sr / vp / geo 已从 jsonb 拆成数值列（可索引可计算）。
 * - ip 保持 text 不收窄（Q8：日志侧存在占位串兼容诉求）。
 * - 属性名 `private` 保持原样（PG 非保留字，可原名）。
 */
@Entity({ name: 'sys_device' })
export class SysDeviceEntity {
  @PrimaryColumn({ type: 'uuid', name: 'id', default: () => 'gen_random_uuid()' })
  id: string

  @Index('uq_device_name', { unique: true })
  @Column({ type: 'text', name: 'device_name' })
  deviceName: string

  @Index('uq_device_id', { unique: true })
  @Column({ type: 'text', name: 'device_id' })
  deviceId: string

  // UA 结构化对象（browser/engine/os/cpu/device 子对象），整体读写
  @Column({ type: 'jsonb', name: 'device_info' })
  deviceInfo: Record<string, unknown>

  @Column({ type: 'jsonb', name: 'hardware_info', nullable: true })
  hardwareInfo: Record<string, unknown> | null

  // 国家/省/市结构体，getLocationString() 整体取用
  @Column({ type: 'jsonb', name: 'location_info', nullable: true })
  locationInfo: Record<string, unknown> | null

  // 上限 5 条的 IP-定位历史，整体覆盖写；DDL 默认 '[]'::jsonb
  @Column({ type: 'jsonb', name: 'location_history', default: () => '\'[]\'::jsonb' })
  locationHistory: IDeviceLocationHistoryItem[]

  // sr.height / sr.width 拍平（数值列可能进统计）
  @Column({ type: 'integer', name: 'sr_height', nullable: true })
  srHeight: number | null

  @Column({ type: 'integer', name: 'sr_width', nullable: true })
  srWidth: number | null

  // vp.height / vp.width 拍平
  @Column({ type: 'integer', name: 'vp_height', nullable: true })
  vpHeight: number | null

  @Column({ type: 'integer', name: 'vp_width', nullable: true })
  vpWidth: number | null

  @Column({ type: 'text', name: 'ip', nullable: true })
  ip: string | null

  // 纯字符串数组 → text[]（元素 homogeneous，非 jsonb 数组，phase2 5.5）
  @Column({ type: 'text', name: 'ip_history', array: true })
  ipHistory: string[]

  @Column({ type: 'boolean', name: 'active', default: false })
  active: boolean

  @Column({ type: 'boolean', name: 'locked', default: false })
  locked: boolean

  @Column({ type: 'boolean', name: 'banned', default: false })
  banned: boolean

  @Column({ type: 'boolean', name: 'private', default: false })
  private: boolean

  // 拍板-5（设备追踪 P0 批）：cron 只打 stale 标记、**不再物理删行**。
  // 删行会让「cookie 还在、行没了」退化成 DeviceGuard 的 40605 死胡同，也会让
  // banned / locked 随行一起消失（= 等 cron 删行就能重置换掉封禁）。stale 只表示
  // 「这行没有真实浏览器活动」（原 cron 的删除口径），**不参与鉴权** —— DeviceGuard
  // 不读它；重新 initial 时写回 false。
  @Column({ type: 'boolean', name: 'stale', default: false })
  stale: boolean

  // geoLocation 拍平为经纬度两列；double precision（Q8 定案：本期不上 PostGIS）
  @Column({ type: 'double precision', name: 'geo_longitude', nullable: true })
  geoLongitude: number | null

  @Column({ type: 'double precision', name: 'geo_latitude', nullable: true })
  geoLatitude: number | null

  // CHECK (risk_score BETWEEN 0 AND 100) 在 migration
  @Column({ type: 'smallint', name: 'risk_score', default: 0 })
  riskScore: number

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date
}
