import type { DataSource, EntityManager, SelectQueryBuilder } from 'typeorm'
import type { IWalnutAdminRequestList } from '@/common/dto/list.dto'
import { Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'

import { WalnutModelName, WalnutPGConnectionName } from '@walnut-server/db'
import { WalnutAdminCommonPgBaseRepository } from '@/common/repository/pg-base.repository'
import {
  applyPgListQuery,
  buildPgListQueryOptions,
  WALNUT_PG_LIST_TOTAL_ALIAS,
} from '@/common/repository/pg-list.builder'
import { SysUserRoleEntity } from './entity/user-role.entity'
import { SysUserEntity } from './entity/user.entity'

/**
 * user 行 + junction 读出的 roles（uuid 数组；Mongo 版 roles 数组字段的 PG 形态）
 */
export interface ISysUserWithRoles extends SysUserEntity {
  roles: string[]
}

/**
 * user 列表行：实体列 + Mongo 版 $lookup/$size 注入的 roles_count
 * （sys_user_role junction 计数；对照 Mongo 版 list 的 $addFields）
 */
export interface ISysUserListRow extends SysUserEntity {
  roles_count: number
}

/**
 * B7a 迁移模板（repo 层）：类名与文件名保持不变（DI token 不动），基类换成 PG 版。
 *
 * Mongo 版的差异只在 roles 数组字段：PG 侧拆为 sys_user_role 关联表（phase2 4.1）——
 * - create：用户行落库后按 dto.roles 写 junction 行（缺省 = 空数组，对齐 Mongo 数组默认值）；
 * - update：dto.roles 未给 时 junction 原样不动（对齐 Mongo 版逐字段赋值语义）；给了则
 *   整组替换（delete + insert，同 em 即同一事务，对齐 Mongo $set 整组覆盖）。
 * 响应行的 roles 以 uuid 数组并回（字段名与 Mongo 版一致，元素从 ObjectId hex 变 uuid）。
 * roles_list / roles_count 的组装在 SysUserRepositoryService
 * （跨模块读腿同走一个入口，见 repo/user.repo.service.ts）。
 */
@Injectable()
export class SysUserBasicRepository extends WalnutAdminCommonPgBaseRepository<SysUserEntity> {
  constructor(
    @InjectDataSource(WalnutPGConnectionName)
    dataSource: DataSource,
  ) {
    super(SysUserEntity, WalnutModelName.SYS_USER, dataSource)
  }

  public async create(dto: Partial<SysUserEntity> & { roles?: string[] }, em?: EntityManager): Promise<ISysUserWithRoles> {
    const { roles, ...userData } = dto

    const created = await super.create(userData, em)

    const finalRoles = roles ?? []
    await this.replaceRoles(created.id, finalRoles, em)

    return Object.assign(created, { roles: finalRoles })
  }

  public async update(
    id: string,
    dto: Partial<SysUserEntity> & { roles?: string[] },
    em?: EntityManager,
  ): Promise<SysUserEntity & { roles?: string[] }> {
    const { roles, ...userData } = dto

    const updated = await super.update(id, userData, em)

    if (roles === undefined) {
      return updated
    }

    await this.replaceRoles(id, roles, em)
    return Object.assign(updated, { roles })
  }

  /**
   * @description Base list（附 sys_user_role 计数子查询）。customize 钩子占位以保持与
   * 基类签名兼容（计数在覆写内实现），传入即忽略。
   */
  public async list<T>(
    params: IWalnutAdminRequestList<T>,
    _customize?: (qb: SelectQueryBuilder<SysUserEntity>) => void,
    em?: EntityManager,
  ): Promise<{ data: ISysUserListRow[], total: number }> {
    const qb = this.getManager(em)
      .createQueryBuilder(SysUserEntity, 'entity')

    applyPgListQuery(qb, 'entity', buildPgListQueryOptions<T>(params))

    // 对齐 Mongo 版 $lookup(sys_role) + $size：junction 计数子查询
    qb.addSelect((sub) => {
      return sub
        .select('count(*)::int')
        .from(SysUserRoleEntity, 'user_role')
        .where('user_role.user_id = entity.id')
    }, 'roles_count')

    qb.addSelect(`COUNT(*) OVER()`, WALNUT_PG_LIST_TOTAL_ALIAS)

    const { raw, entities } = await qb.getRawAndEntities()

    const firstRaw = raw[0] as Record<string, unknown> | undefined
    const total = Number(firstRaw?.[WALNUT_PG_LIST_TOTAL_ALIAS] ?? 0)

    // 无 JOIN 单表查询，raw 与 entities 逐行对齐；计数列不在实体映射里，按行并回
    const data = entities.map((entity, index) => {
      const row = raw[index] as Record<string, unknown> | undefined

      return Object.assign(entity, {
        roles_count: Number(row?.roles_count ?? 0),
      })
    })

    return { data, total }
  }

  /**
   * junction 整组替换：先删后插，同 em 下与用户行写入同事务。PK (user_id, role_id)
   * 即去重（DTO 层另有去重口径）。
   */
  private async replaceRoles(userId: string, roleIds: string[], em?: EntityManager) {
    const manager = this.getManager(em)
    const repository = manager.getRepository(SysUserRoleEntity)

    await repository.delete({ userId })

    if (roleIds.length > 0) {
      await repository.insert(roleIds.map(roleId => ({ userId, roleId })))
    }
  }
}
