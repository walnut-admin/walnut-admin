import type { WalnutAdminRecoverableRegistry } from '@walnut-server/repository'
import { WalnutModelName } from '@walnut-server/db'
import { createWalnutAdminRecoverableRegistrar, createWalnutAdminSnapshotRecoverer } from '@walnut-server/repository'
import { SysLocaleEntity } from './entity/locale.entity'

/**
 * sys_locale 的回收站恢复器登记（libs 解耦批 7）—— 通用恢复器：快照行原样插回。
 */
export function registerSysLocaleRecoverable(registry: WalnutAdminRecoverableRegistry): void {
  registry.register({
    modelName: WalnutModelName.SYS_LOCALE,
    entityTarget: SysLocaleEntity,
    recoverer: createWalnutAdminSnapshotRecoverer(SysLocaleEntity),
  })
}

export const sysLocaleRecoverableProvider = createWalnutAdminRecoverableRegistrar(registerSysLocaleRecoverable)
