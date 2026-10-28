import type { EntityManager, EntityTarget, ObjectLiteral } from 'typeorm'
import type { IWalnutPgSnapshotRecoverer } from './recover-registry'
import { Logger } from '@nestjs/common'
import { WalnutModelName } from '@walnut-server/db'
import { SysUserEntity } from '@/modules/system/user/entity/user.entity'
import { SysUserDeviceEntity } from '@/modules/system/user_device/entity/user-device.entity'
import { SysUserIdentityEntity } from '@/modules/system/user_identity/entity/user-identity.entity'
import { SysUserLockEntity } from '@/modules/system/user_lock/entity/user-lock.entity'
import { SysUserMfaEntity } from '@/modules/system/user_mfa/entity/user-mfa.entity'
import { SysUserPreferenceEntity } from '@/modules/system/user_preference/entity/user-preference.entity'
import { SysDeletedEntity } from '../entity/deleted.entity'

/**
 * 用户恢复时的外围行重放清单（P2-18，2026-10-28）。
 *
 * 删除侧（`SysUserBasicRepository.deleteSoftById`）在主行删除前给这些表逐行落快照；
 * 恢复侧按同一顺序插回（identity/preference 先于 device/mfa/lock，均以 user 主行为 FK 锚）。
 * `optional` 的语义：FK 依赖的外部行（device 行）可能已被独立清理 —— 插入失败只告警
 * 并保留该快照在回收站，不阻断用户本体恢复。
 */
export const WALNUT_USER_PERIPHERAL_RECOVERABLES: ReadonlyArray<{
  modelName: string
  entityTarget: EntityTarget<ObjectLiteral>
  optional: boolean
}> = [
  { modelName: WalnutModelName.SYS_USER_IDENTITY, entityTarget: SysUserIdentityEntity, optional: false },
  { modelName: WalnutModelName.SYS_USER_PREFERENCE, entityTarget: SysUserPreferenceEntity, optional: false },
  { modelName: WalnutModelName.SYS_USER_DEVICE, entityTarget: SysUserDeviceEntity, optional: true },
  { modelName: WalnutModelName.SYS_USER_MFA, entityTarget: SysUserMfaEntity, optional: true },
  { modelName: WalnutModelName.SYS_USER_LOCK, entityTarget: SysUserLockEntity, optional: true },
]

/**
 * `sys_user` 的组合恢复器：先插回主行，再按 `content->>'userId'` 找回该用户的外围
 * 快照逐行重放并删除对应 sys_deleted 行。
 *
 * 为什么不能继续用通用工厂：外围表 FK 全部 CASCADE，主行删除时被静默带走且不在
 * 快照里；只恢复主行 = 用户无法登录（没有口令 identity）、前端偏好丢失。
 * 快照缺失时行为与旧版一致（只恢复主行），逐行可重入。
 */
export function createWalnutUserSnapshotRecoverer(): IWalnutPgSnapshotRecoverer {
  const logger = new Logger('WalnutUserSnapshotRecoverer')

  return {
    recover: async (content: Record<string, unknown>, em: EntityManager) => {
      await em.getRepository(SysUserEntity).insert(content)

      const userId = content.id
      const deletedRepository = em.getRepository(SysDeletedEntity)
      for (const peripheral of WALNUT_USER_PERIPHERAL_RECOVERABLES) {
        const snapshots = await deletedRepository.createQueryBuilder('deleted')
          .where('deleted.modelName = :modelName', { modelName: peripheral.modelName })
          .andWhere(`deleted.content ->> 'userId' = :userId`, { userId })
          .orderBy('deleted.deletedAt', 'DESC')
          .getMany()

        // 同一外围行若被删过多次（首次恢复跳过后又删），只重放最新快照，其余留档不再插
        const restoredDeletedIds = new Set<string>()

        for (const snapshot of snapshots) {
          if (restoredDeletedIds.has(snapshot.deletedId)) {
            continue
          }
          restoredDeletedIds.add(snapshot.deletedId)

          // savepoint 隔离单行失败：identity/preference 失败必须整体回滚（主行恢复不完整
          // 就是坏账号）；device/mfa/lock 失败只跳过该快照（外部依赖可能已被清理）
          await em.query('SAVEPOINT walnut_user_recover')

          try {
            await em.getRepository(peripheral.entityTarget).insert(snapshot.content)
            await deletedRepository.delete({ id: snapshot.id })
            await em.query('RELEASE SAVEPOINT walnut_user_recover')
          }
          catch (error) {
            await em.query('ROLLBACK TO SAVEPOINT walnut_user_recover')

            if (!peripheral.optional) {
              throw error
            }

            logger.warn(
              `user recover skipped optional ${peripheral.modelName} snapshot ${snapshot.id}: ${error instanceof Error ? error.message : String(error)}`,
            )
          }
        }
      }
    },
  }
}
