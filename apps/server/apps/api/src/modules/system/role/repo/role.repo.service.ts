import type { DataSource, EntityManager } from 'typeorm'
import type { ISysMenuAssembled } from '../../menu/dto/menu.dto'
import { Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'
import { WalnutAdminExceptionDataNotFound } from '@walnut-server/exceptions/base/404'

import { In } from 'typeorm'
import { assembleSysMenu } from '../../menu/dto/menu.dto'
import { SysMenuEntity } from '../../menu/entity/menu.entity'
import { SysUserRoleEntity } from '../../user/entity/user-role.entity'
import { SysRoleMenuEntity } from '../entity/role-menu.entity'
import { SysRoleEntity } from '../entity/role.entity'

/** role 行 + junction 读出的 menus（uuid 数组；Mongo 版 menus 数组字段的 PG 形态） */
export interface ISysRolePopulatedRow extends SysRoleEntity {
  menus: string[]
}

/** role 行 + junction 读出的 menus + sys_user_role 计数（Mongo 版 read 的 populate 形态） */
export interface ISysRoleWithUsersCount extends ISysRolePopulatedRow {
  populated_usersCount: number
}

/** role 行 + menus + populated_menusList（Mongo 版 populate virtual 的形态；菜单已组装回 meta） */
export interface ISysRoleWithPopulatedMenus extends ISysRolePopulatedRow {
  populated_menusList: ISysMenuAssembled[]
}

/**
 * Role Repository Service
 *
 * Provides simple CRUD operations for cross-module access.
 * NO business logic - only data access.
 *
 * B5 迁移：Mongo model → PG 命名连接 DataSource。$in 批查改 In(uuid[])（phase3-plan §4）；
 * populated_menusList（match meta.status=true）改 junction JOIN 组装，逐 role 查询的
 * 形态与 Mongo 版 populate 循环一致。
 */
@Injectable()
export class SysRoleRepoService {
  constructor(
    @InjectDataSource(WalnutPGConnectionName)
    private readonly dataSource: DataSource,
  ) {}

  /**
   * @description find role by id
   */
  async findById(id: string, em?: EntityManager) {
    return this.getRoleRepository(em).findOne({ where: { id } })
  }

  /**
   * @description find roles by ids（$in → In(uuid[])）
   */
  async findByIds(ids: string[], em?: EntityManager) {
    if (ids.length === 0) {
      return []
    }

    return this.getRoleRepository(em).find({ where: { id: In(ids) } })
  }

  /**
   * @description find role's menu ids（junction 行 → uuid 数组；对齐 Mongo 版 menus 数组）
   */
  async findMenuIdsByRoleId(roleId: string, em?: EntityManager) {
    const rows = await this.getRoleMenuRepository(em).find({ where: { roleId } })
    return rows.map(i => i.menuId)
  }

  /**
   * @description find role by id with populated_usersCount + menus
   * （对齐 Mongo 版 readById().populate('populated_usersCount') 的读出形态）
   */
  async findByIdWithUsersCount(id: string, em?: EntityManager): Promise<ISysRoleWithUsersCount> {
    const qb = this.getManager(em)
      .createQueryBuilder(SysRoleEntity, 'role')
      .addSelect((sub) => {
        // sys_user_role 关联表计数（B7a：junction 实体已随 user 迁移注册，P3-3 ——
        // 裸表名换成实体引用，表名同源不变）
        return sub
          .select('count(*)::int')
          .from(SysUserRoleEntity, 'user_role')
          .where('user_role.role_id = role.id')
      }, 'populated_users_count')
      .where('role.id = :id', { id })

    const { raw, entities } = await qb.getRawAndEntities()

    const role = entities[0]
    if (role === undefined) {
      throw new WalnutAdminExceptionDataNotFound()
    }

    const row = raw[0] as Record<string, unknown>

    return Object.assign(role, {
      menus: await this.findMenuIdsByRoleId(id, em),
      populated_usersCount: Number(row.populated_users_count ?? 0),
    })
  }

  /**
   * @description find roles by ids with populated menus
   *
   * 对齐 Mongo 版语义：先按 ids 批查、过滤 status=true 的角色，再逐 role populate
   * populated_menusList（match meta.status=true → menu.status = true）。菜单行组装回
   * meta 对象（ISysMenuAssembled），供 menu.shared 的路由/权限链路直接消费。
   */
  async findRolesWithPopulatedMenus(roleIds: string[], em?: EntityManager): Promise<ISysRoleWithPopulatedMenus[]> {
    if (roleIds.length === 0) {
      return []
    }

    const roles = await this.findByIds(roleIds, em)

    const rolesStatusOK = roles.filter(i => i !== null && i.status)

    const populatedRoles: ISysRoleWithPopulatedMenus[] = []
    for (const role of rolesStatusOK) {
      const menus = await this.findPopulatedMenusByRoleId(role.id, em)

      populatedRoles.push(Object.assign(role, {
        menus: await this.findMenuIdsByRoleId(role.id, em),
        populated_menusList: menus.map(i => assembleSysMenu(i)),
      }))
    }

    return populatedRoles
  }

  /**
   * 某 role 的启用菜单（对齐 Mongo 版 populate 的 match { 'meta.status': true }；
   * meta.status 拍平为 status 列，idx_menu_status_sort_order 服务过滤）
   */
  private async findPopulatedMenusByRoleId(roleId: string, em?: EntityManager): Promise<SysMenuEntity[]> {
    return this.getMenuRepository(em)
      .createQueryBuilder('menu')
      .innerJoin(SysRoleMenuEntity, 'role_menu', 'role_menu.menuId = menu.id')
      .where('role_menu.roleId = :roleId', { roleId })
      .andWhere('menu.status = :status', { status: true })
      .getMany()
  }

  private getManager(em?: EntityManager) {
    return em ?? this.dataSource.manager
  }

  private getRoleRepository(em?: EntityManager) {
    return this.getManager(em).getRepository(SysRoleEntity)
  }

  private getRoleMenuRepository(em?: EntityManager) {
    return this.getManager(em).getRepository(SysRoleMenuEntity)
  }

  private getMenuRepository(em?: EntityManager) {
    return this.getManager(em).getRepository(SysMenuEntity)
  }
}
