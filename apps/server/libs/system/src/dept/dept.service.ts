import type { EntityManager } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { runAfterCommit } from '@walnut-server/db'
import { WalnutAdminExceptionBadRequest } from '@walnut-server/exceptions/base.exception'
import { WalnutAdminExceptionDataExists } from '@walnut-server/exceptions/base/400'

import { DataScopeService } from '../data-scope/data-scope.service'
import { SysDeptBasicRepository } from './dept.basic.repository'
import { SysDeptDTOCreateRequest, SysDeptDTOListRequest, SysDeptDTOUpdateRequest } from './dto/dept.dto'
import { SysDeptEntity } from './entity/dept.entity'

/** children 数组形态的树节点（出参经 DTO 序列化，内部只关心 id/parentId/sortOrder） */
type DeptTreeNode<T> = T & { children: DeptTreeNode<T>[] }

/**
 * 部门服务 —— CRUD + 树查询。
 *
 * 删除策略：**软删**（`deleteSoftById`，快照进 sys_deleted + 原行硬删），删除前做两道
 * 业务前置校验并回受控错误：
 * 1. 有子部门 → 不许删（子树处理在应用层，不做级联；FK `fk_dept_parent` RESTRICT 兜底）；
 * 2. 有职工 → 不许删（FK `fk_employee_dept` RESTRICT 兜底）。
 *
 * 更新时防环：父节点不得是自身或自身后代（递归 CTE 取子树后判交）。数据层另有查询侧
 * 的 `CYCLE` 环保护兜底 —— 前置校验负责「不制造环」，CYCLE 负责「历史脏数据查询不悬挂」。
 */
@Injectable()
export class SysDeptService {
  constructor(
    private readonly deptBasicRepo: SysDeptBasicRepository,
    private readonly dataScopeService: DataScopeService,
  ) {}

  /**
   * @description create dept (controller: create)
   *
   * F-25：与 delete 对齐事务口径 —— `deptCode` 查重是 check-then-write，事务外并发两笔
   * 同码创建会双双通过查重（uq_dept_code 是最后防线，但它只保证「不重」，落库侧会给
   * 出受控 40001 而不是业务语义的「先查后建」）。
   *
   * 这里**不锁**父行：新行在 INSERT 之前不存在，任何并发移动都不可能把新行卷进环里，
   * 加锁只会把同一父节点下的并发创建串行化（无收益）。
   */
  async create(dto: SysDeptDTOCreateRequest, em?: EntityManager) {
    await this.ensureCodeAvailable(dto.deptCode, em)

    if (dto.parentId !== null && dto.parentId !== undefined) {
      await this.ensureParentExists(dto.parentId, em)
    }

    return this.deptBasicRepo.create(dto, em)
  }

  /**
   * @description read dept by id (controller: read)
   */
  async read(id: string) {
    return this.deptBasicRepo.readById(id)
  }

  /**
   * @description update dept (controller: update)
   */
  async update(id: string, dto: SysDeptDTOUpdateRequest, em?: EntityManager) {
    const current = await this.deptBasicRepo.readById(id, em)

    if (dto.deptCode !== current.deptCode) {
      await this.ensureCodeAvailable(dto.deptCode, em)
    }

    // PUT 整体替换：parentId 缺省即 null（提升为根）；非 null 时做存在性 + 防环校验
    const parentId = dto.parentId ?? null

    if (parentId !== null) {
      if (parentId === id) {
        throw new WalnutAdminExceptionBadRequest({ errMsg: 'business.system.dept.parentCycle' })
      }

      // F-25 防环竞态：check-then-write 的读腿（存在性 + 子树判交）与写腿（update
      // parent_id）必须在同一把锁下 —— 否则两笔反向移动（A→B、B→A）各自读到「对方
      // 还不是我的子节点」后双双通过校验，把环写进库（查询侧 CYCLE 只能兜住读，兜不住
      // 落库的环数据）。事务内按 id 升序锁「被移动行 + 目标父行」，两笔反向移动因此
      // 串行：等锁者醒来读到的子树已包含胜者写下的新邻接关系 → 受控 40000。
      // 无活跃事务（如单测直调 service）时该方法退化为普通读，行为与修复前一致。
      await this.deptBasicRepo.lockByIdsForUpdate([id, parentId], em)

      await this.ensureParentExists(parentId, em)

      // 防环：目标父节点不得落在自身子树内（含自身，上面已单独拦）
      const subtree = await this.deptBasicRepo.findSubtreeById(id, undefined, em)
      if (subtree.some(row => row.id === parentId)) {
        throw new WalnutAdminExceptionBadRequest({ errMsg: 'business.system.dept.parentCycle' })
      }
    }

    // 显式列映射（PUT 语义）：可空列缺省即清空；sortOrder 缺省保持原值（可排序字段的
    // 「不传」没有业务含义，清成 0 只会让兄弟序意外漂移）
    const payload: Partial<SysDeptEntity> = {
      deptCode: dto.deptCode,
      deptName: dto.deptName,
      parentId,
      leader: dto.leader ?? null,
      phone: dto.phone ?? null,
      email: dto.email ?? null,
      status: dto.status,
    }
    if (typeof dto.sortOrder === 'number') {
      payload.sortOrder = dto.sortOrder
    }

    // 数据权限二期批 1：部门移动（parent_id 变更）改变旧/新祖先链的子树 ——
    // 旧祖先链必须在 update 前取（update 之后 parent_id 已指向新父）。
    // 旧父节点本身也必须进集合（findAncestorDeptIds 不含自身，而旧父的子树已丢节点）。
    const oldAncestorIds = parentId !== current.parentId && current.parentId !== null
      ? [current.parentId, ...(await this.deptBasicRepo.findAncestorDeptIds(current.parentId, em))]
      : []

    const updated = await this.deptBasicRepo.update(id, payload, em)

    if (parentId !== current.parentId) {
      await runAfterCommit(async () => {
        await this.dataScopeService.invalidateForDeptMove(id, oldAncestorIds)
      })
    }

    return updated
  }

  /**
   * @description delete dept (controller: delete) —— 软删进回收站
   */
  async delete(id: string, userId: string, em?: EntityManager) {
    await this.deptBasicRepo.readById(id, em)

    if (await this.deptBasicRepo.countChildren(id, em) > 0) {
      throw new WalnutAdminExceptionBadRequest({ errMsg: 'business.system.dept.hasChildren' })
    }

    if (await this.deptBasicRepo.countEmployees(id, em) > 0) {
      throw new WalnutAdminExceptionBadRequest({ errMsg: 'business.system.dept.hasEmployees' })
    }

    // 数据权限二期批 1：删除后 CTE 已查不到该子树，必须在删除前取 id 集合
    const subtreeIds = await this.deptBasicRepo.findDeptIdsInSubtree(id, em)

    const deleted = await this.deptBasicRepo.deleteSoftById(id, userId, em)

    await runAfterCommit(async () => {
      await this.dataScopeService.invalidateForDeptIds(subtreeIds)
    })

    return deleted
  }

  /**
   * @description list depts (controller: list)
   */
  async list(params: SysDeptDTOListRequest) {
    return this.deptBasicRepo.list(params)
  }

  /**
   * @description full dept tree (controller: tree) —— 单次全量取数 + 内存建树
   * （部门量级小，与菜单树同款克制实现；子树查询走递归 CTE，见 subtree）
   */
  async tree() {
    const rows = await this.deptBasicRepo.findAllOrdered()
    return this.buildTree(rows)
  }

  /**
   * @description children of one parent (controller: children)；parentId 缺省 = 根层
   */
  async children(parentId: string | null) {
    return this.deptBasicRepo.findChildrenByParentId(parentId)
  }

  /**
   * @description subtree of one dept (controller: subtree) —— 递归 CTE + CYCLE，
   * 出参是带 children 的树（根即目标部门）
   */
  async subtree(id: string, maxDepth?: number) {
    await this.deptBasicRepo.readById(id)

    const rows = await this.deptBasicRepo.findSubtreeById(id, { maxDepth })
    return this.buildTree(rows)[0]
  }

  /**
   * @description 部门编码重复 → 40001（DB 的 uq_dept_code 是最后防线）
   */
  private async ensureCodeAvailable(deptCode: string, em?: EntityManager) {
    const existed = await this.deptBasicRepo.findByCode(deptCode, em)
    if (existed !== null) {
      throw new WalnutAdminExceptionDataExists()
    }
  }

  private async ensureParentExists(parentId: string, em?: EntityManager) {
    const parent = await this.deptBasicRepo.findById(parentId, em)
    if (parent === null) {
      throw new WalnutAdminExceptionBadRequest({ errMsg: 'business.system.dept.parentNotFound' })
    }
  }

  /**
   * @description 邻接表行 → children 数组树。输入按 (sortOrder, createdAt) 预排序，
   * 兄弟顺序随插入序保留；parentId 不在结果集内的节点（含父为 null）即森林的根。
   * 环组件（成员互为父子）没有自然根，按首见提升为根并剪掉回边 —— CYCLE 兜底路径
   * 保证输出可序列化、不丢行、不悬挂。
   */
  private buildTree<T extends { id: string, parentId: string | null }>(rows: T[]): DeptTreeNode<T>[] {
    const nodes = new Map<string, DeptTreeNode<T>>()
    for (const row of rows) {
      if (!nodes.has(row.id)) {
        nodes.set(row.id, { ...row, children: [] })
      }
    }

    const roots: DeptTreeNode<T>[] = []
    for (const node of nodes.values()) {
      const parent = node.parentId === null ? undefined : nodes.get(node.parentId)
      if (parent !== undefined) {
        parent.children.push(node)
      }
      else {
        roots.push(node)
      }
    }

    // 环兜底：从根不可达的节点按首见提升，行走时剪掉指向已可达节点的回边
    const reachable = new Set<string>()
    const walk = (node: DeptTreeNode<T>) => {
      reachable.add(node.id)
      node.children = node.children.filter((child) => {
        if (reachable.has(child.id)) {
          return false
        }
        walk(child)
        return true
      })
    }
    roots.forEach(walk)

    for (const node of nodes.values()) {
      if (!reachable.has(node.id)) {
        roots.push(node)
        walk(node)
      }
    }

    return roots
  }
}
