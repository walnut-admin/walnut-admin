import type { WalnutAdminRecoverableRegistry } from '@walnut-server/repository'
import { WalnutModelName } from '@walnut-server/db'
import { createWalnutAdminRecoverableRegistrar, createWalnutAdminSnapshotRecoverer } from '@walnut-server/repository'
import { SysLogAuthEntity } from './entity/log-auth.entity'

/**
 * sys_log_auth 的回收站恢复器登记（libs 解耦批 7）—— 通用恢复器：快照行原样插回。
 */
export function registerSysLogAuthRecoverable(registry: WalnutAdminRecoverableRegistry): void {
  registry.register({
    modelName: WalnutModelName.SYS_LOG_AUTH,
    entityTarget: SysLogAuthEntity,
    recoverer: createWalnutAdminSnapshotRecoverer(SysLogAuthEntity),
  })
}

export const sysLogAuthRecoverableProvider = createWalnutAdminRecoverableRegistrar(registerSysLogAuthRecoverable)
