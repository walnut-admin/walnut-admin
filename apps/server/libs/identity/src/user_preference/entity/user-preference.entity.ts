import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm'

/**
 * sys_user_preference —— MongoDB `sys_user_preference` 集合的 PostgreSQL 实体（phase2 4.14）。
 *
 * - user_id 按 Q2 定案补 UNIQUE（一用户一份偏好），uq_user_preference_user 同时服务 FK 查找。
 * - 各枚举 CHECK（fontSize / colorMode / CVD / layoutMode）在 migration，取值域核对自 schema const。
 * - FK user_id → sys_user ON DELETE CASCADE，DDL 在 migration。
 * - 属性名 `CVD` 保持原样（Mongo 字段名），列名小写 cvd。
 */
@Entity({ name: 'sys_user_preference' })
export class SysUserPreferenceEntity {
  @PrimaryColumn({ type: 'uuid', name: 'id', default: () => 'gen_random_uuid()' })
  id: string

  @Index('uq_user_preference_user', { unique: true })
  @Column({ type: 'uuid', name: 'user_id' })
  userId: string

  // CHECK (IN (10,12,14,16,20)) 在 migration
  @Column({ type: 'smallint', name: 'font_size', default: 14 })
  fontSize: number

  @Column({ type: 'boolean', name: 'dark', default: false })
  dark: boolean

  @Column({ type: 'boolean', name: 'reduced_motion', default: false })
  reducedMotion: boolean

  // CHECK (IN ('default','cafe','contrast','grayscale','grayscale-inverted','inverted')) 在 migration
  @Column({ type: 'varchar', length: 20, name: 'color_mode', default: 'default' })
  colorMode: string

  // 可空 = 未配置色觉辅助；CHECK 五值在 migration
  @Column({ type: 'varchar', length: 20, name: 'cvd', nullable: true })
  CVD: string | null

  // 取值域 = @walnut/contract 的 Locale（'zh_CN' / 'en_US'）
  @Column({ type: 'varchar', length: 16, name: 'locale', default: 'zh_CN' })
  locale: string

  // CHECK (IN ('left-menu','top-menu')) 在 migration
  @Column({ type: 'varchar', length: 16, name: 'layout_mode', default: 'left-menu' })
  layoutMode: string

  // 前端布局的自由状态袋 → jsonb 合理（phase2 5.5）；DDL 默认 '{}'
  @Column({ type: 'jsonb', name: 'layout', default: () => '\'{}\'::jsonb' })
  layout: Record<string, unknown>

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date
}
