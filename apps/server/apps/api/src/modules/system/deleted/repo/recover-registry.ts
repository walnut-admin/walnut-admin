import type { EntityManager, EntityTarget, ObjectLiteral } from 'typeorm'
import { Injectable, Logger } from '@nestjs/common'

import { WalnutModelName } from '@walnut-server/db'
import { AppDemoEntity } from '@/modules/app/demo/entity/demo.entity'
import { AppErrorEntity } from '@/modules/app/error/entity/error.entity'
import { AppKeyEntity } from '@/modules/app/key/entity/key.entity'
import { AppMonitorUserEntity } from '@/modules/app/monitor/user/entity/monitor-user.entity'
import { AppSettingEntity } from '@/modules/app/setting/entity/setting.entity'
import { AuthRefreshTokenEntity } from '@/modules/auth/modules/refresh/entity/refresh-token.entity'
import { SharedAreaEntity } from '@/modules/shared/area/entity/area.entity'
import { SysDeviceEntity } from '@/modules/system/device/entity/device.entity'
import { SysDictDataEntity } from '@/modules/system/dict/dictData/entity/dict-data.entity'
import { SysDictTypeEntity } from '@/modules/system/dict/dictType/entity/dict-type.entity'
import { SysLangEntity } from '@/modules/system/lang/entity/lang.entity'
import { SysLocaleEntity } from '@/modules/system/locale/entity/locale.entity'
import { SysLogAuthEntity } from '@/modules/system/logs/auth/entity/log-auth.entity'
import { SysLogOperateEntity } from '@/modules/system/logs/operate/entity/log-operate.entity'
import { SysMenuEntity } from '@/modules/system/menu/entity/menu.entity'
import { SysRoleEntity } from '@/modules/system/role/entity/role.entity'
import { SysUserEntity } from '@/modules/system/user/entity/user.entity'
import { SysUserDeviceEntity } from '@/modules/system/user_device/entity/user-device.entity'
import { SysUserIdentityEntity } from '@/modules/system/user_identity/entity/user-identity.entity'
import { SysUserLockEntity } from '@/modules/system/user_lock/entity/user-lock.entity'
import { SysUserMfaEntity } from '@/modules/system/user_mfa/entity/user-mfa.entity'
import { SysUserOauthEntity } from '@/modules/system/user_oauth/entity/user-oauth.entity'
import { SysUserPreferenceEntity } from '@/modules/system/user_preference/entity/user-preference.entity'
import { createWalnutUserSnapshotRecoverer } from './user.recoverer'

/**
 * PG 回收站恢复器注册表（phase2 5.3 定案的「显式注册表」，B9 装配完成）。
 *
 * Mongo 版恢复走 `db.model(modelName)` 运行时动态模型（来什么存什么）；PG 有强
 * schema，快照 jsonb → 实体的列级映射必须显式，因此恢复路由收口为
 * `modelName → IWalnutPgSnapshotRecoverer` 的注册表。恢复器本体是通用工厂的产物
 * （实体类型即注册，无需每模块手写恢复逻辑）；23 张已迁业务表在构造期统一装配，
 * 未注册 modelName 的快照在 recover 时抛受控错误，替代动态模型的「默默失败」。
 */
export interface IWalnutPgSnapshotRecoverer {
  /**
   * 把快照对象还原回原表（insert 一行）。实现约束：
   * - 快照引用列已是 uuid（v5 派生规则），无需重写；
   * - 必须接收事务内 `em`（recover 的「原表 insert + sys_deleted delete」两步写
   *   要在同一本地事务内）。
   */
  recover: (content: Record<string, unknown>, em: EntityManager) => Promise<unknown>
}

/**
 * 通用快照恢复器工厂：`entityTarget` 即注册。快照 content 是 jsonb 直存对象
 * （B0 起新形态，无 Mongo 时代 stringify 的 ObjectId 还原包袱），恢复语义就是
 * 「按目标实体把快照行原样插回」—— 含原 uuid 主键与 created_at / updated_at
 * 时间戳列（insert() 对显式赋值的列原样落库，仅 undefined 才走列默认值，故
 * uuidv7/gen_random_uuid 与 CreateDate/UpdateDate 的默认值通道都不会被触发）。
 * 引用完整性（FK / 唯一约束）由数据库在插入时把关，违反即抛错走受控恢复失败。
 */
export function createWalnutPgSnapshotRecoverer<T extends ObjectLiteral>(entityTarget: EntityTarget<T>): IWalnutPgSnapshotRecoverer {
  return {
    recover: async (content: Record<string, unknown>, em: EntityManager) => {
      await em.getRepository(entityTarget).insert(content as never)
    },
  }
}

/**
 * 恢复注册清单：modelName（`WalnutModelName`，软删快照的路由键）→ 目标实体。
 * 覆盖全部 23 张已迁业务表 —— 其中 lock/mfa/preference/user_device/refresh_token
 * 等无软删写路径的表一并注册（注册无害，兜住任何来源的历史快照）；
 * junction 表（sys_role_menu / sys_user_role）随主行 CASCADE 生灭，不进回收站，
 * 不注册。
 *
 * 导出仅供 dto-entity 漂移守卫测试消费（modelName → entity 注册的单源对账）；
 * 运行时注册面仍收口在 `SysDeletedPgRecoverRegistry`。
 */
export const WALNUT_PG_RECOVERABLE_COLLECTIONS: ReadonlyArray<{ modelName: string, entityTarget: EntityTarget<ObjectLiteral> }> = [
  { modelName: WalnutModelName.SYS_ROLE, entityTarget: SysRoleEntity },
  { modelName: WalnutModelName.SYS_USER, entityTarget: SysUserEntity },
  { modelName: WalnutModelName.SYS_USER_OAUTH, entityTarget: SysUserOauthEntity },
  { modelName: WalnutModelName.SYS_USER_PREFERENCE, entityTarget: SysUserPreferenceEntity },
  { modelName: WalnutModelName.SYS_USER_LOCK, entityTarget: SysUserLockEntity },
  { modelName: WalnutModelName.SYS_USER_DEVICE, entityTarget: SysUserDeviceEntity },
  { modelName: WalnutModelName.SYS_USER_MFA, entityTarget: SysUserMfaEntity },
  { modelName: WalnutModelName.SYS_USER_IDENTITY, entityTarget: SysUserIdentityEntity },
  { modelName: WalnutModelName.SYS_MENU, entityTarget: SysMenuEntity },
  { modelName: WalnutModelName.SYS_LANG, entityTarget: SysLangEntity },
  { modelName: WalnutModelName.SYS_LOCALE, entityTarget: SysLocaleEntity },
  { modelName: WalnutModelName.SYS_DEVICE, entityTarget: SysDeviceEntity },
  { modelName: WalnutModelName.SYS_LOG_AUTH, entityTarget: SysLogAuthEntity },
  { modelName: WalnutModelName.SYS_LOG_OPERATE, entityTarget: SysLogOperateEntity },
  { modelName: WalnutModelName.SYS_DICT_DATA, entityTarget: SysDictDataEntity },
  { modelName: WalnutModelName.SYS_DICT_TYPE, entityTarget: SysDictTypeEntity },
  { modelName: WalnutModelName.SHARED_AREA, entityTarget: SharedAreaEntity },
  { modelName: WalnutModelName.APP_DEMO, entityTarget: AppDemoEntity },
  { modelName: WalnutModelName.APP_MONITOR_USER, entityTarget: AppMonitorUserEntity },
  { modelName: WalnutModelName.APP_SETTING, entityTarget: AppSettingEntity },
  { modelName: WalnutModelName.APP_ERROR, entityTarget: AppErrorEntity },
  { modelName: WalnutModelName.APP_KEY, entityTarget: AppKeyEntity },
  { modelName: WalnutModelName.AUTH_REFRESH_TOKEN, entityTarget: AuthRefreshTokenEntity },
]

@Injectable()
export class SysDeletedPgRecoverRegistry {
  private readonly logger = new Logger(SysDeletedPgRecoverRegistry.name)

  private readonly recoverers = new Map<string, IWalnutPgSnapshotRecoverer>()

  constructor() {
    // 装配期统一注册（通用工厂覆盖全部已迁集合）。后续某集合需要特殊恢复逻辑时，
    // 把它从清单挪出、在此单独 `register` —— 清单与手工注册同报名字会抛重复注册错，
    // 装配期即红，不会静默走错恢复器。
    //
    // P2-18（2026-10-28）：sys_user 是首个特殊恢复器 —— 通用工厂只插回主行，而外围表
    // （identity/preference/device/mfa/lock）的 FK 是 CASCADE，删除时被静默带走；
    // 组合恢复器会把同 userId 的外围快照一并重放。清单仍保留 SYS_USER 条目
    // （dto-entity 漂移守卫按清单对账 modelName → entity）。
    for (const { modelName, entityTarget } of WALNUT_PG_RECOVERABLE_COLLECTIONS) {
      if (modelName === WalnutModelName.SYS_USER) {
        this.register(modelName, createWalnutUserSnapshotRecoverer())
        continue
      }

      this.register(modelName, createWalnutPgSnapshotRecoverer(entityTarget))
    }
  }

  /**
   * @description 模块装配期注册恢复器；同名重复注册是装配错误，直接抛错而非静默覆盖
   */
  register(modelName: string, recoverer: IWalnutPgSnapshotRecoverer): void {
    if (this.recoverers.has(modelName)) {
      throw new Error(`[SysDeletedPgRecoverRegistry] recoverer for "${modelName}" is already registered`)
    }
    this.recoverers.set(modelName, recoverer)
    this.logger.log(`recoverer registered: ${modelName}`)
  }

  get(modelName: string): IWalnutPgSnapshotRecoverer | undefined {
    return this.recoverers.get(modelName)
  }

  has(modelName: string): boolean {
    return this.recoverers.has(modelName)
  }
}
