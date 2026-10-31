import type { WalnutAdminRecoverableRegistry } from '@walnut-server/repository'
import { WalnutModelName } from '@walnut-server/db'
import { createWalnutAdminRecoverableRegistrar, createWalnutAdminSnapshotRecoverer } from '@walnut-server/repository'
import { SysDeptEntity } from './entity/dept.entity'

/**
 * sys_dept 的回收站恢复器登记（libs 解耦批 7）—— 通用恢复器：快照行原样插回。
 */
export function registerSysDeptRecoverable(registry: WalnutAdminRecoverableRegistry): void {
  registry.register({
    modelName: WalnutModelName.SYS_DEPT,
    entityTarget: SysDeptEntity,
    recoverer: createWalnutAdminSnapshotRecoverer(SysDeptEntity),
  })
}

export const sysDeptRecoverableProvider = createWalnutAdminRecoverableRegistrar(registerSysDeptRecoverable)
