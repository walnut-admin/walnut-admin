import type { WalnutAdminRecoverableRegistry } from '@walnut-server/repository'
import { WalnutModelName } from '@walnut-server/db'
import { createWalnutAdminRecoverableRegistrar, createWalnutAdminSnapshotRecoverer } from '@walnut-server/repository'
import { SysRoleEntity } from '../entity/role.entity'

/**
 * sys_role 的回收站恢复器登记（libs 解耦批 7）—— 通用恢复器：快照行原样插回。
 */
export function registerSysRoleRecoverable(registry: WalnutAdminRecoverableRegistry): void {
  registry.register({
    modelName: WalnutModelName.SYS_ROLE,
    entityTarget: SysRoleEntity,
    recoverer: createWalnutAdminSnapshotRecoverer(SysRoleEntity),
  })
}

export const sysRoleRecoverableProvider = createWalnutAdminRecoverableRegistrar(registerSysRoleRecoverable)
