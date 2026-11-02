import { Column, Entity, Index, PrimaryColumn } from 'typeorm'

/**
 * shared_area —— MongoDB `shared_area` 集合的 PostgreSQL 实体（phase2 4.18 / 5.1）。
 *
 * - `timestamps: false` → **无时间列**（Q12 定案：不补审计列，补了全是 ETL 当刻时间）。
 * - 66.3 万行：pcode 不建 FK（Q6 定案，顶层省份 pcode='0' 是约定根值而非行引用，
 *   不为约束篡改数据集）；父子完整性由应用层删除校验 + ETL 孤儿/环检测兜底（phase2 5.1/7.3）。
 * - code 位数原判据是 1/2/4/6/9（varchar(9)）；**2026-10-25 勘误（Phase 4 ETL 实测）**：存量
 *   66.3 万行的 code 长度分布是 2/4/6/9/**12**（12 位村/居委会级占 93%），varchar(9) 装不下 ⇒
 *   放宽到 varchar(12)（pcode 同步；migration 与 phase2 4.18 勘误同批修正）。
 * - 整树/子树拉取用递归 CTE（PG 14+ CYCLE 环保护），日常路径保持 pcode 单层查询
 *   （idx_area_pcode 服务 + Redis 缓存策略不变，phase2 5.1）。
 */
@Entity({ name: 'shared_area' })
export class SharedAreaEntity {
  @PrimaryColumn({ type: 'uuid', name: 'id', default: () => 'gen_random_uuid()' })
  id: string

  @Index('uq_area_code', { unique: true })
  @Column({ type: 'varchar', length: 12, name: 'code' })
  code: string

  @Column({ type: 'text', name: 'name' })
  name: string

  @Index('idx_area_pcode')
  @Column({ type: 'varchar', length: 12, name: 'pcode' })
  pcode: string
}
