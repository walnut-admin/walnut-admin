import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm'

/**
 * sys_dept —— 部门（组织架构树）的 PostgreSQL 实体。
 *
 * - 邻接表形态：`parent_id` 自引用（根节点 NULL），子树查询走递归 CTE
 *   （`dept.basic.repository.ts` 的 `findSubtreeById`，`CYCLE` 环保护），
 *   不做 ancestors 逗号路径串（area 批定案：移动部门无级联写放大）。
 * - 自引用 FK `fk_dept_parent` ON DELETE **RESTRICT**（对齐 sys_menu.pid 的 Q6 定案）：
 *   有子部门不许删，应用层先给受控错误，FK 是最后防线。
 * - `dept_code` 是业务唯一键（`uq_dept_code`），`dept_name` 不做库级唯一（同名部门可在
 *   不同父节点下成立）。
 * - `idx_dept_parent` 是 partial index（WHERE parent_id IS NOT NULL，对齐 idx_menu_pid）：
 *   根节点不进索引。
 * - `status` 的 CHECK（enabled/disabled）在 migration；列默认与实体的 `default` 同源。
 */
@Index('uq_dept_code', ['deptCode'], { unique: true })
@Index('idx_dept_parent', ['parentId'], { where: '"parent_id" IS NOT NULL' })
@Entity({ name: 'sys_dept' })
export class SysDeptEntity {
  @PrimaryColumn({ type: 'uuid', name: 'id', default: () => 'gen_random_uuid()' })
  id: string

  // 根节点 parent_id=NULL；自引用 FK 与 partial index 形态见类注释
  @Column({ type: 'uuid', name: 'parent_id', nullable: true })
  parentId: string | null

  // 业务键：全库唯一（uq_dept_code）
  @Column({ type: 'varchar', length: 64, name: 'dept_code' })
  deptCode: string

  @Column({ type: 'text', name: 'dept_name' })
  deptName: string

  @Column({ type: 'text', name: 'leader', nullable: true })
  leader: string | null

  @Column({ type: 'text', name: 'phone', nullable: true })
  phone: string | null

  @Column({ type: 'text', name: 'email', nullable: true })
  email: string | null

  // 同层级展示顺序（树内兄弟排序；DB 默认 0）
  @Column({ type: 'integer', name: 'sort_order', default: 0 })
  sortOrder: number

  // CHECK (IN ('enabled', 'disabled')) 在 migration
  @Column({ type: 'varchar', length: 16, name: 'status', default: 'enabled' })
  status: string

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date
}
