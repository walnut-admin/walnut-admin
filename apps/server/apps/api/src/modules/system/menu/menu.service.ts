import type { EntityManager } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { runAfterCommit } from '@walnut-server/db'
import { SysLocaleSharedService } from '../locale/shared/locale.shared.service'
import {
  flattenSysMenuMeta,
  SysMenuDTOCreateRequest,
  SysMenuDTOListRequest,
  SysMenuDTOUpdateRequest,
} from './dto/menu.dto'
import { SysMenuEntity } from './entity/menu.entity'
import { SysMenuBasicRepository } from './menu.basic.repository'
import { SysMenuSharedService } from './shared/menu.shared.service'

@Injectable()
export class SysMenuService {
  constructor(
    private readonly menuBasicRepo: SysMenuBasicRepository,
    private readonly menuSharedService: SysMenuSharedService,
    private readonly localeSharedService: SysLocaleSharedService,
  ) { }

  /**
   * @description get full menu tree (delegate to shared)
   */
  async getMenuTreeAndTreeWithoutTypeElement() {
    return this.menuSharedService.getMenuTreeAndTreeWithoutTypeElement()
  }

  /**
   * P2-16（2026-10-28）：菜单写路径的全量失效 `AUTH:PERMISSIONS:*` 只作用于
   * **权限相关列变化**的 update 与 delete（F3 收窄）：
   * - create：新菜单尚未挂到任何角色，既有权权限串不变 —— 不失效；
   * - update：只有 permission（权限串本体）或 status（角色 menusList 的过滤判据）
   *   真的变了才失效；改 title/path/order 等不影响权限计算；
   * - delete：角色授权链断裂，全量清保留。
   * 取舍写明：菜单维度反查不现实，权限缓存是可由客户端重拉 `/auth/permissions`
   * 重建的派生数据，权限相关变更全清代价可接受。事务内调用推迟到提交后（回滚不误清）。
   */
  private async invalidatePermissionsCache() {
    await runAfterCommit(async () => {
      await this.menuSharedService.clearAllPermissionsCache()
    })
  }

  /** update 前比对：permission / status 两列是否真的变化（meta 未给时两键都不在） */
  private isPermissionAffectingUpdate(
    current: Partial<Pick<SysMenuEntity, 'permission' | 'status'>>,
    flattened: Partial<SysMenuEntity>,
  ): boolean {
    return (flattened.permission !== undefined && flattened.permission !== current.permission)
      || (flattened.status !== undefined && flattened.status !== current.status)
  }

  // base CRUD
  async create(dto: SysMenuDTOCreateRequest) {
    // meta 对象 → 19 个拍平列（B5；meta 缺省时零列，DB 默认值兜底）。
    // create 不失效权限缓存（F3）：新菜单未挂角色，既有权限串不变
    return this.menuBasicRepo.create(flattenSysMenuMeta(dto))
  }

  async read(id: string) {
    return this.menuBasicRepo.readById(id)
  }

  async update(id: string, dto: SysMenuDTOUpdateRequest) {
    // meta 给 出时 19 列全量产出（未给键回填 schema 默认值），对齐 Mongo 版整体替换
    // meta 子文档的语义；meta 未给 时 meta 列原样不动
    const current = await this.menuBasicRepo.readById(id)
    const flattened = flattenSysMenuMeta(dto)
    const updated = await this.menuBasicRepo.update(id, flattened)

    // F3：只有 permission / status 真变化才清全量（改标题/图标/排序不碰权限串）
    if (this.isPermissionAffectingUpdate(current, flattened)) {
      await this.invalidatePermissionsCache()
    }

    return updated
  }

  /**
   * B5 迁移：menu 本体已迁 PG，级联删 locale 也是 PG —— 单一 em 句柄贯通
   * （软删 menu + sys_deleted 快照 + 级联 locale 同一事务）。
   * title 为空的菜单没有对应 locale（key 非空列），跳过级联与 Mongo 版
   * 「按 undefined 键删除命中 0 行」的行为等价。
   */
  async delete(id: string, userId: string, cascade: number, em?: EntityManager) {
    const deletedMenu = await this.menuBasicRepo.deleteSoftById(id, userId, em)

    if (cascade === 1 && deletedMenu.title !== null) {
      // delete all locales with deleted menu title
      await this.localeSharedService.deleteByKey(deletedMenu.title, userId, em)
    }

    await this.invalidatePermissionsCache()

    return deletedMenu
  }

  async list(params: SysMenuDTOListRequest) {
    return this.menuBasicRepo.list(params)
  }
}
