import type { DataSource, EntityManager } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { WalnutDBModelName, WalnutPGConnectionName } from '@walnut-server/db'

import { WalnutAdminCommonPgBaseRepository } from '@/common/repository/pg-base.repository'
import { SharedAreaEntity } from './entity/area.entity'

/** 递归 CTE 单行出参（含深度与环标记；raw 查询直出，不映射进实体） */
export interface ISharedAreaSubtreeRow {
  code: string
  name: string
  pcode: string
  depth: number
  isCycle: boolean
}

/**
 * children 数组形态的树节点 —— 与 Mongo 版 `SharedAreaSchema.virtual('children')`
 * populate 出的数组形态一致（节点 = { name, code, pcode } + children；本表查询沿袭
 * Mongo 版 `.select('-_id name code pcode')` 投影，不带 uuid 主键）。
 */
export interface ISharedAreaTreeNode {
  name: string
  code: string
  pcode: string
  children: ISharedAreaTreeNode[]
}

/**
 * B4 迁移（repo 层，area 模块原先无 repo、service 直持 model —— 随迁移补齐，模板同
 * error/basic.repository）。基类用 PG 版 `WalnutAdminCommonPgBaseRepository`。
 *
 * 查询模式对照 Mongo 版逐一对齐（phase2 5.1「日常路径保持单层查询」）—— Mongo 版实际
 * 只有两种取数：按 code 点查一层、按 pcode 查一层子节点（children/parent virtual 只是
 * populate 形态，service 从未整树加载，Redis 缓存按 pcode 粒度）：
 * - findByCode：`WHERE code=$1` —— uq_area_code 唯一索引点查；
 * - findChildrenByPcode：`WHERE pcode=$1 ORDER BY code` —— idx_area_pcode 服务，命中
 *   省内/市内数行到数千行（街道/村级），ORDER BY code 对命中集合内存排序；
 * - findSubtreeByCode：整子树/限深拉取（children virtual 的 PG 等价能力），递归 CTE +
 *   `CYCLE code SET is_cycle USING path`（PG 14+ 环保护兜底）—— 每层展开是一次
 *   idx_area_pcode 索引扫描（工作表机制），锚点是 uq_area_code 点查；从省 code 出发
 *   整子树最坏数万行，限深参数可止住向下展开（phase2 5.1 性能判据）。
 *
 * 本表无通用 list/搜索入口（Mongo 版即无），基类 list 保留但不承载业务查询；
 * 66 万行量级下不做全表加载，树查询一律按需（code 起点 + 可选深度）。
 *
 * 实现说明：`WITH RECURSIVE ... CYCLE` 是 TypeORM QueryBuilder 没有表达式形态的 PG
 * 方言结构，故用参数化原生 SQL（固定语句文本 + 绑定参数，无任何值拼接）—— 与
 * phase3-plan §6「不写原生 SQL 字符串拼接」的意图一致（防的是动态拼接值注入）。
 */
@Injectable()
export class SharedAreaBasicRepository extends WalnutAdminCommonPgBaseRepository<SharedAreaEntity> {
  constructor(
    @InjectDataSource(WalnutPGConnectionName)
    dataSource: DataSource,
  ) {
    super(SharedAreaEntity, WalnutDBModelName.SHARED_AREA, dataSource)
  }

  /**
   * @description 按唯一 code 点查一层（对齐 Mongo 版 findOne({code}).select('-_id name code pcode')；
   * Mongo 投影剔除 _id，PG 侧对齐口径为带 uuid 主键 id —— B1 起「PG 响应以 id 为唯一标识」，
   * 与 findChildrenByPcode 的 TypeORM find 恒带 PK 行为保持一致）
   */
  public async findByCode(code: string, em?: EntityManager): Promise<SharedAreaEntity | null> {
    return this.getManager(em)
      .getRepository(SharedAreaEntity)
      .findOne({ where: { code }, select: { id: true, name: true, code: true, pcode: true } })
  }

  /**
   * @description 按 pcode 查一层子节点（对齐 Mongo 版 find({pcode}).select('-_id name code pcode').lean()；
   * 输出确定性排序 ORDER BY code，对应 phase2 5.1 日常路径 SQL）
   *
   * B 段 API 回归修复（HTTP 全链 spec 抓出的迁移回归）：Mongo 版走 `.lean()` 返回普通
   * 对象，PG 版 `find()` 返回实体实例 —— 全局 ClassSerializerInterceptor
   * （excludeExtraneousValues: true）会把无 @Expose 的实体剥成 `{}`，缓存未命中的冷路径
   * 经 controller 出站时整层丢字段（热路径因 Redis JSON 往返侥幸幸存，故 service 层
   * int-spec 不可见）。这里投影回 `{ name, code, pcode }` 普通对象，与 Mongo lean 版
   * 逐字段对齐（本就不带 uuid 主键，见 ISharedAreaTreeNode 注释）。
   */
  public async findChildrenByPcode(pcode: string, em?: EntityManager): Promise<SharedAreaEntity[]> {
    const rows = await this.getManager(em)
      .getRepository(SharedAreaEntity)
      .find({ where: { pcode }, select: { name: true, code: true, pcode: true }, order: { code: 'ASC' } })
    return rows.map(({ name, code, pcode: parentPcode }) => ({ name, code, pcode: parentPcode }) as SharedAreaEntity)
  }

  /**
   * @description 以 code 为根的整子树 / 限深子树，递归 CTE + CYCLE 环保护兜底
   * （phase2 5.1 草图）。maxDepth 缺省 undefined 即整子树；给定 N 时只展开到第 N 层
   * （深度 0..N，递归项在边界深度不再向下走）。成环数据由 CYCLE 子句标记 is_cycle 并
   * 终止 —— 查询永不悬挂（数据质量第一道防线是 ETL 环检测，SQL 兜底是第二道）。
   */
  public async findSubtreeByCode(
    code: string,
    options?: { maxDepth?: number },
    em?: EntityManager,
  ): Promise<ISharedAreaSubtreeRow[]> {
    const maxDepth = options?.maxDepth

    // 递归项带 WHERE s.depth < $2：边界深度不再向下展开（整子树时无此谓词）
    const sql = maxDepth === undefined
      ? `WITH RECURSIVE subtree AS (
          SELECT code, name, pcode, 0 AS depth
          FROM shared_area
          WHERE code = $1
          UNION ALL
          SELECT a.code, a.name, a.pcode, s.depth + 1
          FROM shared_area a
          JOIN subtree s ON a.pcode = s.code
        ) CYCLE code SET is_cycle USING path
        SELECT code, name, pcode, depth, is_cycle FROM subtree`
      : `WITH RECURSIVE subtree AS (
          SELECT code, name, pcode, 0 AS depth
          FROM shared_area
          WHERE code = $1
          UNION ALL
          SELECT a.code, a.name, a.pcode, s.depth + 1
          FROM shared_area a
          JOIN subtree s ON a.pcode = s.code
          WHERE s.depth < $2
        ) CYCLE code SET is_cycle USING path
        SELECT code, name, pcode, depth, is_cycle FROM subtree`

    const parameters = maxDepth === undefined ? [code] : [code, maxDepth]

    const raw = await this.getManager(em).query<Array<Record<string, unknown>>>(sql, parameters)

    // pg 驱动回 bigint（depth 计数）与 boolean：统一收敛为 number / boolean
    return raw.map(row => ({
      code: row.code as string,
      name: row.name as string,
      pcode: row.pcode as string,
      depth: Number(row.depth),
      isCycle: row.is_cycle === true,
    }))
  }

  /**
   * @description 把 CTE 平铺行组装成 children 数组形态的树（children virtual populate
   * 的等价出参）。输入须是 findSubtreeByCode 的产物：按 code 去重（CYCLE 兜底产生的
   * 重复 code 首见为准），pcode 不在结果集内的节点即该森林的根。成环组件没有自然根
   * （成员互为父子），按首见顺序提升为根 —— 环兜底路径保证不悬挂、不丢行、不炸。
   */
  public assembleSubtree(rows: ISharedAreaSubtreeRow[]): ISharedAreaTreeNode[] {
    const nodes = new Map<string, ISharedAreaTreeNode>()
    for (const row of rows) {
      if (!nodes.has(row.code)) {
        nodes.set(row.code, { name: row.name, code: row.code, pcode: row.pcode, children: [] })
      }
    }

    const roots: ISharedAreaTreeNode[] = []

    for (const node of nodes.values()) {
      const parent = nodes.get(node.pcode)
      if (parent && node.code !== node.pcode) {
        parent.children.push(node)
      }
      else {
        roots.push(node)
      }
    }

    // 环组件提升：从根不可达的节点（互为父子的环成员）按首见顺序并回根集合；
    // 行走时剪掉指向已可达节点的回边 —— 环兜底路径保证输出无环、可序列化
    if (roots.length > 0 || nodes.size > 0) {
      const reachable = new Set<string>()
      const walk = (node: ISharedAreaTreeNode) => {
        reachable.add(node.code)
        node.children = node.children.filter((child) => {
          if (reachable.has(child.code)) {
            return false
          }
          walk(child)
          return true
        })
      }
      roots.forEach(walk)

      for (const node of nodes.values()) {
        if (!reachable.has(node.code)) {
          roots.push(node)
          walk(node)
        }
      }
    }

    // 与 findChildrenByPcode 同一口径：同级按 code 排序，输出确定
    const sortLevel = (level: ISharedAreaTreeNode[]) => {
      level.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
      level.forEach((node) => {
        if (node.children.length > 0) {
          sortLevel(node.children)
        }
      })
    }
    sortLevel(roots)

    return roots
  }
}
