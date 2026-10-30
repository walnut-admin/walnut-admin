import { Entity, Index, PrimaryColumn } from 'typeorm'

/**
 * sys_role_dept —— 数据权限 CUSTOM 档位的部门清单（二期部门维度）。
 *
 * - PK (role_id, dept_id)：复合主键天然去重，兼服务 role → depts 反查。
 * - 双 FK 均 ON DELETE CASCADE（junction 随 role / dept 主行生灭），DDL 在
 *   `migrations/1793340000000-DataScopePhase2Dept.ts`。
 * - 语义：CUSTOM 只按清单内的部门过滤，**不递归子树**（与 RuoYi 一致；
 *   需要子树语义请用 DEPT_AND_CHILD）。清单为空 = 默认拒绝（SQL 恒假）。
 */
@Entity({ name: 'sys_role_dept' })
@Index('idx_role_dept_dept', ['deptId'])
export class SysRoleDeptEntity {
  @PrimaryColumn({ type: 'uuid', name: 'role_id' })
  roleId: string

  @PrimaryColumn({ type: 'uuid', name: 'dept_id' })
  deptId: string
}
