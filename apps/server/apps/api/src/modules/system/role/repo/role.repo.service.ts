import type { DataSource, EntityManager } from 'typeorm'
import type { ISysMenuAssembled } from '../../menu/dto/menu.dto'
import { Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'
import { WalnutPGConnectionName } from '@walnut-server/db'
import { WalnutAdminExceptionDataNotFound } from '@walnut-server/exceptions/base/404'

import { SysUserRoleEntity } from '@walnut-server/identity'
import { In } from 'typeorm'
import { assembleSysMenu } from '../../menu/dto/menu.dto'
import { SysMenuEntity } from '../../menu/entity/menu.entity'
import { SysRoleDeptEntity } from '../entity/role-dept.entity'
import { SysRoleMenuEntity } from '../entity/role-menu.entity'
import { SysRoleEntity } from '../entity/role.entity'

/** role 行 + junction 读出的 menus（uuid 数组；Mongo 版 menus 数组字段的 PG 形态） */
export interface ISysRolePopulatedRow extends SysRoleEntity {
  menus: string[]
}

/**
 * role 行 + junction 读出的 menus + sys_user_role 计数（Mongo 版 read 的 populate 形态）。
 * 二期批 2：read 同时带回 CUSTOM 档位的 `sys_role_dept` 部门清单（deptIds）。
 */
export interface ISysRoleWithUsersCount extends ISysRolePopulatedRow {
  usersCount: number
  deptIds: string[]
}

/** role 行 + menus + menusList（Mongo 版 populate virtual 的形态；菜单已组装回 meta） */
export interface ISysRoleWithPopulatedMenus extends ISysRolePopulatedRow {
  menusList: ISysMenuAssembled[]
}

/**
 * Role Repository Service
 *
 * Provides simple CRUD operations for cross-module access.
 * NO business logic - only data access.
 *
 * B5 迁移：Mongo model → PG 命名连接 DataSource。$in 批查改 In(uuid[])（phase3-plan §4）；
 * menusList（match meta.status=true）改 junction JOIN 组装，逐 role 查询的
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
   * @description 某角色当前绑定的全部 userId（P2-16 权限缓存失效的反查腿：
   * sys_user_role 按 role_id 点查，角色用户量级小，逐用户 pattern 清即可）
   */
  async findUserIdsByRoleId(roleId: string, em?: EntityManager): Promise<string[]> {
    const rows = await this.getManager(em).getRepository(SysUserRoleEntity).find({
      where: { roleId },
      select: { userId: true },
    })
    return rows.map(i => i.userId)
  }

  /**
   * @description 某用户当前实际绑定的 roleId 列表（P1-18 根修：权限计算以
   * `sys_user_role` 的实时 membership 为准，不信任 AT payload 自报的 roleIds /
   * currentRole；按 role_id 排序保证「首角色」回退确定）。
   */
  async findRoleIdsByUserId(userId: string, em?: EntityManager): Promise<string[]> {
    const rows = await this.getManager(em).getRepository(SysUserRoleEntity).find({
      where: { userId },
      select: { roleId: true },
      order: { roleId: 'ASC' },
    })
    return rows.map(i => i.roleId)
  }

  /**
   * @description 某角色 CUSTOM 档位的部门清单（sys_role_dept → dept_id 数组；
   * 数据权限二期批 1，解析器的 CUSTOM 分支）
   */
  async findDeptIdsByRoleId(roleId: string, em?: EntityManager): Promise<string[]> {
    const rows = await this.getRoleDeptRepository(em).find({
      where: { roleId },
      select: { deptId: true },
    })
    return rows.map(i => i.deptId)
  }

  /**
   * @description find role by id with usersCount + menus
   * （对齐 Mongo 版 readById().populate('usersCount') 的读出形态）
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
      }, 'users_count')
      .where('role.id = :id', { id })

    const { raw, entities } = await qb.getRawAndEntities()

    const role = entities[0]
    if (role === undefined) {
      throw new WalnutAdminExceptionDataNotFound()
    }

    const row = raw[0] as Record<string, unknown>

    return Object.assign(role, {
      menus: await this.findMenuIdsByRoleId(id, em),
      // 二期批 2：CUSTOM 档位的部门清单（角色编辑表单回显；非 CUSTOM 角色通常为空）
      deptIds: await this.findDeptIdsByRoleId(id, em),
      usersCount: Number(row.users_count ?? 0),
    })
  }

  /**
   * @description find roles by ids with populated menus
   *
   * 对齐 Mongo 版语义：先按 ids 批查、过滤 status=true 的角色，再逐 role populate
   * menusList（match meta.status=true → menu.status = true）。菜单行组装回
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
        menusList: menus.map(i => assembleSysMenu(i)),
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

  private getRoleDeptRepository(em?: EntityManager) {
    return this.getManager(em).getRepository(SysRoleDeptEntity)
  }

  private getMenuRepository(em?: EntityManager) {
    return this.getManager(em).getRepository(SysMenuEntity)
  }
}
