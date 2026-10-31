import type { DataSource, EntityManager } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { WalnutModelName, WalnutPGConnectionName, withWalnutSystemManager } from '@walnut-server/db'
import { WalnutAdminCommonPgBaseRepository } from '@walnut-server/repository'

import { IsNull } from 'typeorm'
import { SysEmployeeEntity } from '../employee/entity/employee.entity'
import { SysDeptEntity } from './entity/dept.entity'

/** 递归 CTE 单行出参（含深度与环标记；raw 查询直出，不映射进实体） */
export interface ISysDeptSubtreeRow {
  id: string
  parentId: string | null
  deptCode: string
  deptName: string
  leader: string | null
  phone: string | null
  email: string | null
  sortOrder: number
  status: string
  depth: number
  isCycle: boolean
}

/**
 * 部门基础仓库 —— 邻接表树的 PG 查询能力（对齐 area.basic.repository 的手法）：
 *
 * - 日常路径：按 parent 查一层（`findChildrenByParentId`，根节点 parentId=null 走
 *   `IS NULL`）—— `idx_dept_parent` 是 partial index，根节点查询走 seq scan（部门表量级小，
 *   与 area 的顶层省份同口径）；
 * - 子树 / 整树：`findSubtreeById` 走 `WITH RECURSIVE ... CYCLE`（PG 14+ 环保护兜底），
 *   每层展开是一次 `idx_dept_parent` 索引扫描；成环数据由 `is_cycle` 标记并终止，
 *   查询永不悬挂（数据质量第一道防线是应用层的前置校验：parent 不得是自身/后代）；
 * - 引用计数：`countEmployeesByDeptId` 供删除前的前置校验（FK RESTRICT 是最后防线）。
 *
 * 实现说明（同 area 批）：`WITH RECURSIVE ... CYCLE` 是 TypeORM QueryBuilder 没有表达式
 * 形态的 PG 方言结构，用**固定语句文本 + 绑定参数**的原生 SQL（无任何值拼接）。
 */
@Injectable()
export class SysDeptBasicRepository extends WalnutAdminCommonPgBaseRepository<SysDeptEntity> {
  constructor(
    @InjectDataSource(WalnutPGConnectionName)
    dataSource: DataSource,
  ) {
    super(SysDeptEntity, WalnutModelName.SYS_DEPT, dataSource)
  }

  /**
   * @description 按业务键点查（uq_dept_code）
   */
  public async findByCode(deptCode: string, em?: EntityManager): Promise<SysDeptEntity | null> {
    return this.getManager(em).getRepository(SysDeptEntity).findOne({ where: { deptCode } })
  }

  /**
   * @description 主键点查（查无返回 null；基类 readById 对查无抛 404，这里的调用方
   * 要把「父节点不存在」翻译成受控 400，所以不能借 readById 的抛错）
   */
  public async findById(id: string, em?: EntityManager): Promise<SysDeptEntity | null> {
    return this.getManager(em).getRepository(SysDeptEntity).findOne({ where: { id } })
  }

  /**
   * @description 按父节点查一层（根节点传 null → parent_id IS NULL），兄弟按 sortOrder 排
   */
  public async findChildrenByParentId(parentId: string | null, em?: EntityManager): Promise<SysDeptEntity[]> {
    return this.getManager(em).getRepository(SysDeptEntity).find({
      where: parentId === null ? { parentId: IsNull() } : { parentId },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    })
  }

  /**
   * @description 全量取数（树端点用；部门量级小，菜单树同款「单次查询 + 内存建树」）
   */
  public async findAllOrdered(em?: EntityManager): Promise<SysDeptEntity[]> {
    return this.getManager(em).getRepository(SysDeptEntity).find({
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    })
  }

  /**
   * @description 以 id 为根的整子树 / 限深子树（含根），递归 CTE + CYCLE 环保护兜底。
   * maxDepth 缺省 undefined 即整子树；给定 N 时只展开到第 N 层（深度 0..N）。
   */
  public async findSubtreeById(
    id: string,
    options?: { maxDepth?: number },
    em?: EntityManager,
  ): Promise<ISysDeptSubtreeRow[]> {
    const maxDepth = options?.maxDepth

    const baseColumns = `d.id, d.parent_id, d.dept_code, d.dept_name, d.leader, d.phone, d.email, d.sort_order, d.status, d.created_at`
    const recursiveWhere = maxDepth === undefined ? '' : 'WHERE s.depth < $2'

    const sql = `WITH RECURSIVE subtree AS (
        SELECT ${baseColumns}, 0 AS depth
        FROM sys_dept d
        WHERE d.id = $1
        UNION ALL
        SELECT ${baseColumns}, s.depth + 1
        FROM sys_dept d
        JOIN subtree s ON d.parent_id = s.id
        ${recursiveWhere}
      ) CYCLE id SET is_cycle USING path
      SELECT id, parent_id, dept_code, dept_name, leader, phone, email, sort_order, status, depth, is_cycle
      FROM subtree
      ORDER BY depth ASC, sort_order ASC, created_at ASC`

    const parameters = maxDepth === undefined ? [id] : [id, maxDepth]

    const raw = await this.getManager(em).query<Array<Record<string, unknown>>>(sql, parameters)

    // pg 驱动回 bigint（depth 计数）与 boolean：统一收敛为 number / boolean
    return raw.map(row => ({
      id: row.id as string,
      parentId: (row.parent_id as string | null) ?? null,
      deptCode: row.dept_code as string,
      deptName: row.dept_name as string,
      leader: (row.leader as string | null) ?? null,
      phone: (row.phone as string | null) ?? null,
      email: (row.email as string | null) ?? null,
      sortOrder: Number(row.sort_order),
      status: row.status as string,
      depth: Number(row.depth),
      isCycle: row.is_cycle === true,
    }))
  }

  /**
   * @description 以 id 为根的子树 dept id 集合（含自身）—— 数据权限 DEPT_AND_CHILD /
   * DEPT_OR_SELF 的取数入口（复用 findSubtreeById 的递归 CTE + CYCLE 兜底）
   */
  public async findDeptIdsInSubtree(id: string, em?: EntityManager): Promise<string[]> {
    const rows = await this.findSubtreeById(id, undefined, em)
    return [...new Set(rows.map(row => row.id))]
  }

  /**
   * @description 祖先链 dept id（自 parent 向上到根，不含自身；CYCLE 环保护）——
   * 部门移动后的缓存失效反查：祖先链用户的 DEPT_AND_CHILD 子树发生了变化
   * （子树内用户自己的 subtree 不变，真正受影响的是祖先侧）。
   */
  public async findAncestorDeptIds(id: string, em?: EntityManager): Promise<string[]> {
    const sql = `WITH RECURSIVE ancestors AS (
        SELECT d.id, d.parent_id
        FROM sys_dept d
        WHERE d.id = $1
        UNION ALL
        SELECT d.id, d.parent_id
        FROM sys_dept d
        JOIN ancestors a ON d.id = a.parent_id
      ) CYCLE id SET is_cycle USING path
      SELECT id FROM ancestors WHERE id <> $1`

    const raw = await this.getManager(em).query<Array<{ id: string }>>(sql, [id])
    return [...new Set(raw.map(row => row.id))]
  }

  /**
   * @description 有子部门计数（删除前置校验用；FK RESTRICT 是最后防线）
   */
  public async countChildren(id: string, em?: EntityManager): Promise<number> {
    return this.getManager(em).getRepository(SysDeptEntity).count({ where: { parentId: id } })
  }

  /**
   * @description 有职工计数（删除前置校验用）。跨表只读计数：employee 模块依赖
   * dept/post 模块（模块图单向无环），所以这里反向计数走实体仓库而非注入 employee 模块。
   */
  public async countEmployees(deptId: string, em?: EntityManager): Promise<number> {
    return withWalnutSystemManager(this.dataSource, em, async manager =>
      // eslint-disable-next-line no-restricted-syntax -- 删除前置计数必须全库口径（见上方注释）；这里已显式走 system 事务
      manager.getRepository(SysEmployeeEntity).count({ where: { deptId } }))
  }
}
