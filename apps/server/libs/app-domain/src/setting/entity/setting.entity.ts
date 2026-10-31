import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm'

/**
 * app_setting —— MongoDB `app_setting` 集合的 PostgreSQL 实体（phase2 4.19）。
 *
 * - setting_value 保持 **text**（Q4 定案）：seed 里存过角色 id（app.default.role），
 *   内嵌 ObjectId 由 ETL 专项重写，不引入 typed 引用列。
 * - created_by（Q4 定案新增）：seed 实存 schema 未声明的字段，补列存证；
 *   松引用 sys_user（创建者可能被回收，Q3 同口径），不建 FK、不建索引。
 */
@Entity({ name: 'app_setting' })
export class AppSettingEntity {
  @PrimaryColumn({ type: 'uuid', name: 'id', default: () => 'gen_random_uuid()' })
  id: string

  @Column({ type: 'text', name: 'setting_name' })
  settingName: string

  @Index('uq_setting_key', { unique: true })
  @Column({ type: 'text', name: 'setting_key' })
  settingKey: string

  @Column({ type: 'text', name: 'setting_value' })
  settingValue: string

  // CHECK (IN ('auth','global','functional')) 在 migration
  @Column({ type: 'varchar', length: 16, name: 'setting_type' })
  settingType: string

  @Column({ type: 'text', name: 'remark', nullable: true })
  remark: string | null

  // 松引用，无索引
  @Column({ type: 'uuid', name: 'created_by', nullable: true })
  createdBy: string | null

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date
}
