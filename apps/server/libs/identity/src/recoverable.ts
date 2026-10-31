import type { Provider } from '@nestjs/common'
import { WalnutModelName } from '@walnut-server/db'
import { createWalnutAdminSnapshotRecoverer, WalnutAdminRecoverableRegistry } from '@walnut-server/repository'
import { SysUserEntity } from './user/entity/user.entity'
import { createWalnutUserSnapshotRecoverer } from './user/user.recoverer'
import { SysUserDeviceEntity } from './user_device/entity/user-device.entity'
import { SysUserIdentityEntity } from './user_identity/entity/user-identity.entity'
import { SysUserLockEntity } from './user_lock/entity/user-lock.entity'
import { SysUserMfaEntity } from './user_mfa/entity/user-mfa.entity'
import { SysUserOauthEntity } from './user_oauth/entity/user-oauth.entity'
import { SysUserPreferenceEntity } from './user_preference/entity/user-preference.entity'

/**
 * 身份内核的回收站恢复器登记（libs 解耦批 7，登记制）。
 *
 * 七个身份栈实体在 `SysIdentityModule` 装配期登记进
 * `WalnutAdminRecoverableRegistry` —— 回收站（libs/system 的 deleted）不再 import 任何
 * identity 实体去拼清单。
 *
 * - `sys_user` 用组合恢复器（外围表 FK CASCADE，需按 userId 重放 identity / preference /
 *   device / mfa / lock / oauth 快照，P2-18 / P2-22）；
 * - 其余六张外围表用通用恢复器（快照行原样插回）。
 *
 * `registerIdentityRecoverables` 同时被 dto-entity drift spec 调用（在纯注册表实例上
 * 重放运行期登记），与 Nest 装配走**同一份**登记逻辑。
 */
export function registerIdentityRecoverables(registry: WalnutAdminRecoverableRegistry): void {
  registry.register({
    modelName: WalnutModelName.SYS_USER,
    entityTarget: SysUserEntity,
    recoverer: createWalnutUserSnapshotRecoverer(),
  })
  registry.register({
    modelName: WalnutModelName.SYS_USER_OAUTH,
    entityTarget: SysUserOauthEntity,
    recoverer: createWalnutAdminSnapshotRecoverer(SysUserOauthEntity),
  })
  registry.register({
    modelName: WalnutModelName.SYS_USER_PREFERENCE,
    entityTarget: SysUserPreferenceEntity,
    recoverer: createWalnutAdminSnapshotRecoverer(SysUserPreferenceEntity),
  })
  registry.register({
    modelName: WalnutModelName.SYS_USER_LOCK,
    entityTarget: SysUserLockEntity,
    recoverer: createWalnutAdminSnapshotRecoverer(SysUserLockEntity),
  })
  registry.register({
    modelName: WalnutModelName.SYS_USER_DEVICE,
    entityTarget: SysUserDeviceEntity,
    recoverer: createWalnutAdminSnapshotRecoverer(SysUserDeviceEntity),
  })
  registry.register({
    modelName: WalnutModelName.SYS_USER_MFA,
    entityTarget: SysUserMfaEntity,
    recoverer: createWalnutAdminSnapshotRecoverer(SysUserMfaEntity),
  })
  registry.register({
    modelName: WalnutModelName.SYS_USER_IDENTITY,
    entityTarget: SysUserIdentityEntity,
    recoverer: createWalnutAdminSnapshotRecoverer(SysUserIdentityEntity),
  })
}

/** 装配期登记（factory provider；registry 是 @Global 的，见 SysDeletedRepoModule） */
export const SYS_IDENTITY_RECOVERABLE_REGISTRAR = Symbol('SYS_IDENTITY_RECOVERABLE_REGISTRAR')

export const sysIdentityRecoverableRegistrarProvider: Provider = {
  provide: SYS_IDENTITY_RECOVERABLE_REGISTRAR,
  useFactory: (registry: WalnutAdminRecoverableRegistry) => {
    registerIdentityRecoverables(registry)
    return true
  },
  inject: [WalnutAdminRecoverableRegistry],
}
