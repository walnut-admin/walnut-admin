import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm'

/**
 * sys_employee —— 职工（人事记录）的 PostgreSQL 实体。
 *
 * **与登录账号 sys_user 分离**：职工可以暂无账号（人事录入先于开号），
 * 绑定关系是 `user_id` 的**唯一可空松引用**：
 * - `uq_employee_user`（partial，WHERE user_id IS NOT NULL）保证「一号一职工」；
 * - **不建 FK**（对齐 phase2 2.4-3 的审计 / 松引用口径）：账号彻底删除不应级联销毁
 *   人事记录 —— 职工档案比登录能力活得久。
 * - 离职（status=resigned）**不自动删账号、不自动解绑**：账号生命周期由账号侧管理
 *   （禁用 / 删除走 sys_user 的既有通道），职工状态只反映人事事实。
 *
 * 部门 / 岗位引用：
 * - `dept_id` NOT NULL + FK RESTRICT：有职工的部门不许删（FK 是最后防线，应用层先给受控错误）；
 * - `post_id` 可空 + FK RESTRICT：未定岗职工存 NULL；有职工的岗位不许删。
 * - 本批是**单岗直挂**（一职工一岗），不建 sys_employee_post junction；多岗诉求出现时
 *   再加关联表（选型说明见交付报告）。
 */
@Index('uq_employee_no', ['employeeNo'], { unique: true })
@Index('uq_employee_user', ['userId'], { unique: true, where: '"user_id" IS NOT NULL' })
@Index('idx_employee_dept', ['deptId'])
@Index('idx_employee_post', ['postId'], { where: '"post_id" IS NOT NULL' })
@Entity({ name: 'sys_employee' })
export class SysEmployeeEntity {
  @PrimaryColumn({ type: 'uuid', name: 'id', default: () => 'gen_random_uuid()' })
  id: string

  // 业务键：工号全库唯一（uq_employee_no）
  @Column({ type: 'varchar', length: 64, name: 'employee_no' })
  employeeNo: string

  @Column({ type: 'text', name: 'employee_name' })
  employeeName: string

  // FK → sys_dept(id) ON DELETE RESTRICT（DDL 在 migration）
  @Column({ type: 'uuid', name: 'dept_id' })
  deptId: string

  // FK → sys_post(id) ON DELETE RESTRICT；未定岗为 NULL
  @Column({ type: 'uuid', name: 'post_id', nullable: true })
  postId: string | null

  // 松引用 sys_user(id)（不建 FK）：partial unique 保证「一号一职工」，账号删除不级联
  @Column({ type: 'uuid', name: 'user_id', nullable: true })
  userId: string | null

  // 入职时间（timestamptz 与全仓时间列同型；日期展示由前端取日期部分）
  @Column({ type: 'timestamptz', name: 'entry_date' })
  entryDate: Date

  // CHECK (IN ('probation', 'active', 'resigned')) 在 migration
  @Column({ type: 'varchar', length: 16, name: 'status', default: 'active' })
  status: string

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date
}
