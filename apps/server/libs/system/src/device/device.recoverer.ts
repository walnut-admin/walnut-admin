import type { WalnutAdminRecoverableRegistry } from '@walnut-server/repository'
import { WalnutModelName } from '@walnut-server/db'
import { createWalnutAdminRecoverableRegistrar, createWalnutAdminSnapshotRecoverer } from '@walnut-server/repository'
import { SysDeviceEntity } from './entity/device.entity'

/**
 * sys_device 的回收站恢复器登记（libs 解耦批 7）—— 通用恢复器：快照行原样插回。
 */
export function registerSysDeviceRecoverable(registry: WalnutAdminRecoverableRegistry): void {
  registry.register({
    modelName: WalnutModelName.SYS_DEVICE,
    entityTarget: SysDeviceEntity,
    recoverer: createWalnutAdminSnapshotRecoverer(SysDeviceEntity),
  })
}

export const sysDeviceRecoverableProvider = createWalnutAdminRecoverableRegistrar(registerSysDeviceRecoverable)
