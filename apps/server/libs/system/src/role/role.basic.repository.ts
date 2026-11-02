import type { IWalnutAdminRequestList } from '@walnut-server/list'
import type { DataSource, EntityManager, SelectQueryBuilder } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'

import { WalnutModelName, WalnutPGConnectionName } from '@walnut-server/db'
import { SysUserRoleEntity } from '@walnut-server/identity'
import { applyPgListQuery, buildPgListQueryOptions, WALNUT_PG_LIST_TOTAL_ALIAS, WalnutAdminCommonPgBaseRepository } from '@walnut-server/repository'
import { SysRoleDeptEntity } from './entity/role-dept.entity'
import { SysRoleMenuEntity } from './entity/role-menu.entity'
import { SysRoleEntity } from './entity/role.entity'

/**
 * role 列表行：实体列 + Mongo 版 $lookup/$size 注入的 usersCount
 * （sys_user_role 关联表计数；B7a 起 junction 实体已注册，子查询走实体引用）。
 */
export interface ISysRoleListRow extends SysRoleEntity {
  usersCount: number
}

/**
 * B5 迁移模板（repo 层）：类名与文件名保持不变（DI token 不动），基类换成 PG 版。
 *
 * Mongo 版的差异只在 menus 数组字段：PG 侧拆为 sys_role_menu 关联表（phase2 4.2）——
 * - create：角色行落库后按 dto.menus 写 junction 行（缺省 = 空数组，对齐 Mongo 数组默认值）；
 * - update：dto.menus 未给 时 junction 原样不动（对齐 Mongo 版逐字段赋值语义）；给了则
 *   整组替换（delete + insert，同 em 即同一事务，对齐 Mongo $set 整组覆盖）。
 * 响应行的 menus 以 uuid 数组并回（字段名与 Mongo 版一致，元素从 ObjectId hex 变 uuid）。
 *
 * 二期批 2：`deptIds`（CUSTOM 档位的 sys_role_dept 部门清单）与 menus 同一手法 ——
 * create 缺省写空、update 未给不动 / 给了整组替换。清单对非 CUSTOM 角色无执行语义，
 * 但**不主动清空**：档位切回 CUSTOM 时保留上次的勾选（RuoYi 同口径）。
 */
@Injectable()
export class SysRoleBasicRepository extends WalnutAdminCommonPgBaseRepository<SysRoleEntity> {
  constructor(
    @InjectDataSource(WalnutPGConnectionName)
    dataSource: DataSource,
  ) {
    super(SysRoleEntity, WalnutModelName.SYS_ROLE, dataSource)
  }

  public async create(
    dto: Partial<SysRoleEntity> & { menus?: string[], deptIds?: string[] },
    em?: EntityManager,
  ): Promise<SysRoleEntity & { menus: string[], deptIds: string[] }> {
    const { menus, deptIds, ...roleData } = dto

    const created = await super.create(roleData, em)
    await this.replaceMenus(created.id, menus ?? [], em)
    await this.replaceDepts(created.id, deptIds ?? [], em)

    return Object.assign(created, { menus: menus ?? [], deptIds: deptIds ?? [] })
  }

  public async update(
    id: string,
    dto: Partial<SysRoleEntity> & { menus?: string[], deptIds?: string[] },
    em?: EntityManager,
  ): Promise<SysRoleEntity & { menus?: string[], deptIds?: string[] }> {
    const { menus, deptIds, ...roleData } = dto

    const updated = await super.update(id, roleData, em)

    if (menus !== undefined) {
      await this.replaceMenus(id, menus, em)
      Object.assign(updated, { menus })
    }

    if (deptIds !== undefined) {
      await this.replaceDepts(id, deptIds, em)
      Object.assign(updated, { deptIds })
    }

    return updated
  }

  /**
   * @description Base list（附 sys_user_role 计数）。customize 钩子占位以保持与基类签名
   * 兼容（计数在覆写内以子查询实现），传入即忽略。
   */
  public async list<T>(
    params: IWalnutAdminRequestList<T>,
    _customize?: (qb: SelectQueryBuilder<SysRoleEntity>) => void,
    em?: EntityManager,
  ): Promise<{ data: ISysRoleListRow[], total: number }> {
    const qb = this.getManager(em)
      .createQueryBuilder(SysRoleEntity, 'entity')

    applyPgListQuery(qb, 'entity', buildPgListQueryOptions<T>(params))

    // 对齐 Mongo 版 $lookup(sys_user) + $size：junction 计数子查询（B7a：P3-3 ——
    // SysUserRoleEntity 已注册，裸表名换实体引用，表名同源不变）
    qb.addSelect((sub) => {
      return sub
        .select('count(*)::int')
        .from(SysUserRoleEntity, 'user_role')
        .where('user_role.role_id = entity.id')
    }, 'users_count')

    qb.addSelect(`COUNT(*) OVER()`, WALNUT_PG_LIST_TOTAL_ALIAS)

    const { raw, entities } = await qb.getRawAndEntities()

    const firstRaw = raw[0] as Record<string, unknown> | undefined
    const total = Number(firstRaw?.[WALNUT_PG_LIST_TOTAL_ALIAS] ?? 0)

    // 无 JOIN 单表查询，raw 与 entities 逐行对齐；计数列不在实体映射里，按行并回
    const data = entities.map((entity, index) => {
      const row = raw[index] as Record<string, unknown> | undefined

      return Object.assign(entity, {
        usersCount: Number(row?.users_count ?? 0),
      })
    })

    return { data, total }
  }

  /**
   * junction 整组替换：先删后插，同 em 下与角色行写入同事务。PK (role_id, menu_id)
   * 即去重（DTO 层另有 ArrayUnique 拦输入重复）。
   */
  private async replaceMenus(roleId: string, menuIds: string[], em?: EntityManager) {
    const manager = this.getManager(em)
    const repository = manager.getRepository(SysRoleMenuEntity)

    await repository.delete({ roleId })

    if (menuIds.length > 0) {
      await repository.insert(menuIds.map(menuId => ({ roleId, menuId })))
    }
  }

  /**
   * CUSTOM 部门清单整组替换（sys_role_dept 复合 PK 去重；DTO 层 ArrayUnique 拦输入重复）。
   * 与 replaceMenus 同事务语义 —— update 路径由 role.controller 的 @WalnutTx 保证。
   */
  private async replaceDepts(roleId: string, deptIds: string[], em?: EntityManager) {
    const manager = this.getManager(em)
    const repository = manager.getRepository(SysRoleDeptEntity)

    await repository.delete({ roleId })

    if (deptIds.length > 0) {
      await repository.insert(deptIds.map(deptId => ({ roleId, deptId })))
    }
  }
}
