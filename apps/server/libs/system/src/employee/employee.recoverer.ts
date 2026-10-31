import type { WalnutAdminRecoverableRegistry } from '@walnut-server/repository'
import { WalnutModelName } from '@walnut-server/db'
import { createWalnutAdminRecoverableRegistrar, createWalnutAdminSnapshotRecoverer } from '@walnut-server/repository'
import { SysEmployeeEntity } from './entity/employee.entity'

/**
 * sys_employee 的回收站恢复器登记（libs 解耦批 7）—— 通用恢复器：快照行原样插回。
 */
export function registerSysEmployeeRecoverable(registry: WalnutAdminRecoverableRegistry): void {
  registry.register({
    modelName: WalnutModelName.SYS_EMPLOYEE,
    entityTarget: SysEmployeeEntity,
    recoverer: createWalnutAdminSnapshotRecoverer(SysEmployeeEntity),
  })
}

export const sysEmployeeRecoverableProvider = createWalnutAdminRecoverableRegistrar(registerSysEmployeeRecoverable)
