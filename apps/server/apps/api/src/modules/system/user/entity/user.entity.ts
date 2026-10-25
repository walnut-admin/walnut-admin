import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm'

/**
 * sys_user —— MongoDB `sys_user` 集合的 PostgreSQL 实体（postgres-migration-phase2.md 4.1）。
 *
 * - 列名全部显式 `@Column({ name })`，与 phase2 文档逐列对齐，**不注册全局 SnakeNamingStrategy**
 *   （order/show/left 这类保留字改名 `sort_order` / `is_show` / `is_left` 策略表达不了，
 *   且隐式全局命名违反仓库纪律，见文档 2.1）。
 * - 主键默认值在 **DB 端**（migration DDL 的 DEFAULT gen_random_uuid()）；实体元数据里的
 *   `default: () => '...'` 只是与 DDL 同源的声明，插入不传 id 时该列以 DEFAULT 关键字下发，
 *   由数据库生成 v4，不做应用端 @PrimaryGeneratedColumn('uuid')（那会强制 v4）。
 * - 本批实体只建不注册（不进任何 TypeOrmModule.forFeature），运行时行为零变化。
 * - FK / CHECK / partial / trgm 索引的 DDL 真源在 `apps/api/migrations/`；
 *   实体侧只落 @Index 与 migration 对齐（synchronize:false 下作为未来 generate 的真源）。
 *   「对齐」的边界：`*_created_at DESC` 带排序方向的索引与 trgm GIN 一样是 migration-only
 *   （@Index 表达不了 DESC / 操作符类），generate 对账时这两类 diff 属预期，不许照
 *   generate 输出删 migration 侧索引。
 */
@Entity({ name: 'sys_user' })
export class SysUserEntity {
  @PrimaryColumn({ type: 'uuid', name: 'id', default: () => 'gen_random_uuid()' })
  id: string

  // 原 partial unique（$type: string 过滤）→ WHERE user_name IS NOT NULL，语义等价
  @Index('uq_user_name', { unique: true, where: '"user_name" IS NOT NULL' })
  @Column({ type: 'text', name: 'user_name', nullable: true })
  userName: string | null

  @Column({ type: 'text', name: 'nick_name', nullable: true })
  nickName: string | null

  // CHECK (age > 0) 由 migration 承担（schema 校验 int + positive）
  @Column({ type: 'integer', name: 'age', nullable: true })
  age: number | null

  // GB 标准（0/1/2/9），CHECK 枚举在 migration；DB 默认 9（UNDESCRIBED）
  @Column({ type: 'smallint', name: 'gender', default: 9 })
  gender: number

  @Column({ type: 'text', name: 'avatar', nullable: true })
  avatar: string | null

  @Column({ type: 'text', name: 'description', nullable: true })
  description: string | null

  @Column({ type: 'boolean', name: 'status', default: true })
  status: boolean

  // CHECK (IN ('switchable','combinable')) 在 migration
  @Column({ type: 'varchar', length: 16, name: 'role_mode', default: 'switchable' })
  roleMode: string

  // 松引用 vs FK：这里按 phase2 定案建 FK（ON DELETE SET NULL），DDL 在 migration；
  // 列可空 = 用户无当前角色
  @Index('idx_user_current_role')
  @Column({ type: 'uuid', name: 'current_role_id', nullable: true })
  currentRole: string | null

  @Column({ type: 'boolean', name: 'mfa_setup', default: false })
  mfaSetup: boolean

  // 原 roles: ObjectId[] 拆为关联表 sys_user_role（见 user-role.entity.ts）

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date

  // 由 UpdateDateColumn 维护（phase2 5.4：不用触发器；raw SQL UPDATE 必须显式 SET updated_at = now()）
  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date
}
