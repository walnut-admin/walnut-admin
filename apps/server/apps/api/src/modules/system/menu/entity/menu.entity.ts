import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm'

/**
 * sys_menu —— MongoDB `sys_menu` 集合的 PostgreSQL 实体（phase2 4.3）。
 *
 * - meta 的 19 个字段已定案**拍平为独立列**（Q1）：status 是 role populate 的过滤条件、
 *   order 是排序键，拍平才能落约束与索引；出参组装回 meta 对象由后续业务批次处理。
 * - 保留字改名：meta.order → sort_order、meta.show → is_show（属性名保持 `order` / `show`）。
 * - pid 可空（根节点 pid=NULL，seed 里根节点文档没有 pid 键）；自引用 FK
 *   ON DELETE RESTRICT（Q6 定案：防误删静默扩面，子树处理在应用层），DDL 在 migration。
 * - idx_menu_pid 是 partial index（WHERE pid IS NOT NULL），实体与 migration 两侧同形。
 */
// partial unique（WHERE name IS NOT NULL）—— TypeORM 1.x 的 Index(name, options)
// 类级形态不带列会踩运行时坑（options 被当列函数），列显式给出
@Index('uq_menu_name', ['name'], { unique: true, where: '"name" IS NOT NULL' })
@Index('idx_menu_pid', ['pid'], { where: '"pid" IS NOT NULL' })
// 属性名是 order（列名 sort_order，ORDER 是保留字改名）—— Index 数组用属性名
@Index('idx_menu_status_sort_order', ['status', 'order'])
@Entity({ name: 'sys_menu' })
export class SysMenuEntity {
  @PrimaryColumn({ type: 'uuid', name: 'id', default: () => 'gen_random_uuid()' })
  id: string

  @Column({ type: 'uuid', name: 'pid', nullable: true })
  pid: string | null

  // CHECK (IN ('catalog','menu','element')) 在 migration
  @Column({ type: 'varchar', length: 8, name: 'type', default: 'catalog' })
  type: string

  @Column({ type: 'text', name: 'path', nullable: true })
  path: string | null

  @Column({ type: 'text', name: 'name', nullable: true })
  name: string | null

  @Column({ type: 'text', name: 'component', nullable: true })
  component: string | null

  // i18n key 形态
  @Column({ type: 'text', name: 'title', nullable: true })
  title: string | null

  @Column({ type: 'text', name: 'icon', nullable: true })
  icon: string | null

  // ===== 以下 19 列为原 meta 的拍平（phase2 4.3）=====

  @Column({ type: 'integer', name: 'sort_order', nullable: true })
  order: number | null

  // CHECK (IN ('none','internal','external')) 在 migration
  @Column({ type: 'varchar', length: 8, name: 'ternal', default: 'none' })
  ternal: string

  @Column({ type: 'text', name: 'url', nullable: true })
  url: string | null

  // 原 meta.show（SHOW 是 SQL 关键字 → is_show）
  @Column({ type: 'boolean', name: 'is_show', default: true })
  show: boolean

  @Column({ type: 'boolean', name: 'cache', default: false })
  cache: boolean

  // role.virtual 的 match 字段，进复合索引 idx_menu_status_sort_order
  @Column({ type: 'boolean', name: 'status', default: true })
  status: boolean

  @Column({ type: 'boolean', name: 'affix', default: false })
  affix: boolean

  // `*:*:*` 形态
  @Column({ type: 'text', name: 'permission', nullable: true })
  permission: string | null

  @Column({ type: 'text', name: 'menu_active_name', nullable: true })
  menuActiveName: string | null

  @Column({ type: 'boolean', name: 'menu_active_same_tab', default: false })
  menuActiveSameTab: boolean

  @Column({ type: 'text', name: 'badge', nullable: true })
  badge: string | null

  @Column({ type: 'text', name: 'active_icon', nullable: true })
  activeIcon: string | null

  @Column({ type: 'boolean', name: 'position', default: false })
  position: boolean

  @Column({ type: 'boolean', name: 'leave_tip', default: false })
  leaveTip: boolean

  @Column({ type: 'boolean', name: 'mask_url', default: false })
  maskUrl: boolean

  @Column({ type: 'boolean', name: 'hijack_refresh', default: false })
  hijackRefresh: boolean

  // 自由配置对象，前端透传 → jsonb 合理（phase2 5.5）
  @Column({ type: 'jsonb', name: 'watermark', nullable: true })
  watermark: Record<string, unknown> | null

  @Column({ type: 'varchar', length: 32, name: 'transition', default: 'fade' })
  transition: string

  // CHECK (IN ('name','path')) 在 migration；可空 = 未配置
  @Column({ type: 'varchar', length: 8, name: 'cache_key_strategy', nullable: true })
  cacheKeyStrategy: string | null

  // ===== meta 拍平结束 =====

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date
}
