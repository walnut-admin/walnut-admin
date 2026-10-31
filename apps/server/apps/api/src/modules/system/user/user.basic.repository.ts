import type { IWalnutAdminRequestList } from '@walnut-server/list'
import type { DataSource, EntityManager, EntityTarget, ObjectLiteral, SelectQueryBuilder } from 'typeorm'
import { Injectable } from '@nestjs/common'
import { InjectDataSource } from '@nestjs/typeorm'

import { WalnutModelName, WalnutPGConnectionName } from '@walnut-server/db'
import { WalnutAdminCommonPgBaseRepository } from '@/common/repository/pg-base.repository'
import {
  applyPgListQuery,
  buildPgListQueryOptions,
  WALNUT_PG_LIST_TOTAL_ALIAS,
} from '@/common/repository/pg-list.builder'
import { SysUserDeviceEntity } from '../user_device/entity/user-device.entity'
import { SysUserIdentityEntity } from '../user_identity/entity/user-identity.entity'
import { SysUserLockEntity } from '../user_lock/entity/user-lock.entity'
import { SysUserMfaEntity } from '../user_mfa/entity/user-mfa.entity'
import { SysUserOauthEntity } from '../user_oauth/entity/user-oauth.entity'
import { SysUserPreferenceEntity } from '../user_preference/entity/user-preference.entity'
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

    if (roles !== undefined) {
      // P1-18（2026-10-28）：junction 整组替换后 current_role_id 必须仍在新集合内。
      // 旧现状只替换 junction，被移出的角色仍留在 current_role_id（SWITCH 用户登录后
      // 继续按已移出的角色取权限）。这里与 AT payload 的组装口径对齐：current 失效 →
      // 新集合首角色；空集合 → null（列可空 = 无当前角色）。
      const current = await this.readById(id, em)
      if (current.currentRole === null || !roles.includes(current.currentRole)) {
        (userData as Partial<SysUserEntity>).currentRole = roles[0] ?? null
      }
    }

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
    // 数据权限三期：注册实体的读路径必须进事务（withScopedManager 负责自动事务 +
    // RLS set_config），覆写 list 与基类同口径。
    return this.withScopedManager(em, async (manager) => {
      const qb = manager
        .createQueryBuilder(SysUserEntity, 'entity')

      applyPgListQuery(qb, 'entity', buildPgListQueryOptions<T>(params))

      // 数据权限：sys_user 已注册（SELF = 本人账号行），覆写 list 必须显式注入
      this.applyDataScope(qb, 'entity')

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
    }, { readOnly: true })
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

  /**
   * P2-18 / P2-22（2026-10-28 / 2026-10-29）：删除用户时先给**外围行**各落一份回收站快照。
   *
   * 为什么必须在这里做：外围表（identity / oauth / preference / user_device / mfa / lock）的
   * FK 全部 `ON DELETE CASCADE`，主行一删就被静默带走，而软删快照此前只存主行 ——
   * 恢复用户后没有口令 identity（无法登录）、没有偏好（前端布局丢失）。快照与主行
   * 删除同一 em（controller 有 @WalnutTx），回滚时快照一并回滚。
   *
   * 注意 identity / mfa 的密文列是 `select: false`，必须显式 addSelect，否则快照缺列，
   * 恢复时 NOT NULL 违约、或密文丢失导致凭据不可用。
   */
  private async snapshotPeripheralRows(userId: string, deletedBy: string, em?: EntityManager) {
    const manager = this.getManager(em)

    const snapshotRows = async <T extends ObjectLiteral>(modelName: string, entityTarget: EntityTarget<T>, rows: T[]) => {
      if (rows.length === 0) {
        return
      }

      const collectionName = this.dataSource.getMetadata(entityTarget).tableName
      for (const row of rows) {
        await this.deletedRepoService.createSoftDelete({
          content: { ...row },
          modelName,
          collectionName,
          deletedId: (row as T & { id: string }).id,
          deletedBy,
        }, em)
      }
    }

    const identities = await manager.getRepository(SysUserIdentityEntity)
      .createQueryBuilder('entity')
      .addSelect('entity.value')
      .where('entity.userId = :userId', { userId })
      .getMany()

    const preferences = await manager.getRepository(SysUserPreferenceEntity).find({ where: { userId } })

    const userDevices = await manager.getRepository(SysUserDeviceEntity).find({ where: { userId } })

    const mfaRows = await manager.getRepository(SysUserMfaEntity)
      .createQueryBuilder('entity')
      .addSelect([
        'entity.totpSecretCiphertext',
        'entity.webauthnPublicKey',
        'entity.phoneNumberCiphertext',
        'entity.backupCodesCiphertext',
      ])
      .where('entity.userId = :userId', { userId })
      .getMany()

    const locks = await manager.getRepository(SysUserLockEntity).find({ where: { userId } })

    // P2-22（2026-10-29）：oauth 绑定列无 select:false 密文，默认列集即完整快照
    const oauths = await manager.getRepository(SysUserOauthEntity).find({ where: { userId } })

    await snapshotRows(WalnutModelName.SYS_USER_IDENTITY, SysUserIdentityEntity, identities)
    await snapshotRows(WalnutModelName.SYS_USER_PREFERENCE, SysUserPreferenceEntity, preferences)
    await snapshotRows(WalnutModelName.SYS_USER_DEVICE, SysUserDeviceEntity, userDevices)
    await snapshotRows(WalnutModelName.SYS_USER_MFA, SysUserMfaEntity, mfaRows)
    await snapshotRows(WalnutModelName.SYS_USER_LOCK, SysUserLockEntity, locks)
    await snapshotRows(WalnutModelName.SYS_USER_OAUTH, SysUserOauthEntity, oauths)
  }

  /**
   * @description 软删用户：外围行快照（identity/oauth/preference/device/mfa/lock）→ 主行
   * 快照 + 硬删（FK CASCADE 带走外围行）。恢复侧由自定义 user recoverer 重放快照
   * （P2-18 / P2-22）。
   *
   * 数据权限复审（P2）：先做一次 **scoped** `readById` —— 越权删除必须在写任何
   * 外围快照之前失败，不能把安全性隐式寄托在 `@WalnutTx` 的回滚上（缺事务调用的
   * 场景会留下不属于当前用户的外围快照）。
   */
  public async deleteSoftById(id: string, userId: string, em?: EntityManager): Promise<SysUserEntity> {
    await this.readById(id, em)
    await this.snapshotPeripheralRows(id, userId, em)
    return super.deleteSoftById(id, userId, em)
  }
}
