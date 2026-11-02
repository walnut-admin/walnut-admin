import type { WalnutAdminRecoverableRegistry } from '@walnut-server/repository'
import { WalnutModelName } from '@walnut-server/db'
import { createWalnutAdminRecoverableRegistrar, createWalnutAdminSnapshotRecoverer } from '@walnut-server/repository'
import { SysLogOperateEntity } from './entity/log-operate.entity'

/**
 * sys_log_operate 的回收站恢复器登记（libs 解耦批 7）—— 通用恢复器：快照行原样插回。
 */
export function registerSysLogOperateRecoverable(registry: WalnutAdminRecoverableRegistry): void {
  registry.register({
    modelName: WalnutModelName.SYS_LOG_OPERATE,
    entityTarget: SysLogOperateEntity,
    recoverer: createWalnutAdminSnapshotRecoverer(SysLogOperateEntity),
  })
}

export const sysLogOperateRecoverableProvider = createWalnutAdminRecoverableRegistrar(registerSysLogOperateRecoverable)
