import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm'

/** demo_object 的形状（对齐 schema 的 DemoObject：{o1,o2,o3} 演示 Mixed → jsonb） */
export interface IDemoObject {
  o1?: string
  o2?: number
  o3?: boolean
}

/**
 * app_demo —— MongoDB `app_demo` 集合的 PostgreSQL 实体（phase2 4.20）。
 *
 * 演示表，职责就是展示各字段形态在 PG 的落法：
 * 字符串数组 → text[]、枚举数组 → smallint[]、uuid 引用 → uuid/uuid[]、Mixed → jsonb。
 * - demoMongoId 改列名 demo_uuid（演示用引用形态，属性名保持原样）。
 * - 各数组列 NOT NULL 无 DB 默认（对齐文档）：应用侧必须显式给值。
 */
@Entity({ name: 'app_demo' })
export class AppDemoEntity {
  @PrimaryColumn({ type: 'uuid', name: 'id', default: () => 'gen_random_uuid()' })
  id: string

  @Index('uq_demo_string', { unique: true })
  @Column({ type: 'text', name: 'demo_string', nullable: true })
  demoString: string | null

  @Index('uq_demo_phone_number', { unique: true })
  @Column({ type: 'text', name: 'demo_phone_number', nullable: true })
  demoPhoneNumber: string | null

  @Column({ type: 'text', name: 'demo_string_array', array: true })
  demoStringArray: string[]

  @Column({ type: 'integer', name: 'demo_number', nullable: true })
  demoNumber: number | null

  @Column({ type: 'integer', name: 'demo_number_array', array: true })
  demoNumberArray: number[]

  @Column({ type: 'boolean', name: 'demo_boolean', default: false })
  demoBoolean: boolean

  @Column({ type: 'boolean', name: 'demo_boolean_array', array: true })
  demoBooleanArray: boolean[]

  @Column({ type: 'timestamptz', name: 'demo_date', nullable: true })
  demoDate: Date | null

  @Column({ type: 'timestamptz', name: 'demo_date_array', array: true })
  demoDateArray: Date[]

  // CHECK (IN (1,2,3,4)) 在 migration；DB 默认 1
  @Column({ type: 'smallint', name: 'demo_enum', default: 1 })
  demoEnum: number

  @Column({ type: 'smallint', name: 'demo_enum_array', array: true })
  demoEnumArray: number[]

  @Column({ type: 'uuid', name: 'demo_uuid', nullable: true })
  demoMongoId: string | null

  @Column({ type: 'uuid', name: 'demo_uuid_array', array: true })
  demoMongoIdArray: string[]

  @Column({ type: 'jsonb', name: 'demo_object', nullable: true })
  demoObject: IDemoObject | null

  // 数据权限一期（docs/plans/data-scope-design.md §4）：示范 owner 列。
  // 松引用 sys_user.id（不建 FK，对齐 phase2 审计列口径）；基类 create 对注册实体
  // 自动填充（见 common/repository/data-scope.ts），SELF/CUSTOM 的过滤列即本列。
  // 与 migration 的 partial index 同形（WHERE created_by IS NOT NULL），防未来 generate 漂移。
  @Index('idx_demo_created_by', { where: '"created_by" IS NOT NULL' })
  @Column({ type: 'uuid', name: 'created_by', nullable: true })
  createdBy: string | null

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date
}
